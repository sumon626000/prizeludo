import bcrypt from "bcryptjs";
import {
  and,
  desc,
  eq,
  ilike,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { db } from "../db/client.js";
import {
  adminAuditLogs,
  authSessions,
  bannedDevices,
  bannedIps,
  notifications,
  supportTickets,
  tournamentEntries,
  tournaments,
  transactions,
  users,
} from "../db/schema.js";
import {
  encryptSecret,
  generateGameId,
  generateReferCode,
} from "../lib/crypto.js";
import { AppError } from "../lib/errors.js";
import {
  getThemePreset,
  presetToSettingValues,
  THEME_PRESET_IDS,
} from "../constants/theme-presets.js";
import { toPublicUser } from "../lib/public-user.js";
import { emitBalanceUpdate, emitNotification } from "./realtime.service.js";
import {
  getSettings,
  updateSettingsWithAudit,
} from "./settings.service.js";
import type { Server } from "socket.io";
import { configureGoogleAuthFromSettings } from "../auth/google.js";

export const adminPermissionValues = [
  "users",
  "financial",
  "tournaments",
  "support",
] as const;

export type AdminPermissionValue =
  (typeof adminPermissionValues)[number];

type ReportPeriod = "daily" | "weekly" | "monthly";

function numberValue(value: unknown): number {
  return Number(value ?? 0);
}

function csvCell(value: unknown): string {
  const text =
    value instanceof Date
      ? value.toISOString()
      : value === null || value === undefined
        ? ""
        : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function makeCsv(headers: string[], rows: unknown[][]): string {
  return [
    headers.map(csvCell).join(","),
    ...rows.map((row) => row.map(csvCell).join(",")),
  ].join("\r\n");
}

export async function getAdminDashboard(activePlayers: number) {
  const [summaryResult, breakdownResult] = await Promise.all([
    db.execute<{
      today_deposit_count: number;
      today_deposit_amount: string;
      today_withdraw_count: number;
      today_withdraw_amount: string;
      month_deposit_amount: string;
      active_tournaments: number;
      total_users: number;
      all_time_revenue: string;
    }>(sql`
      with bounds as (
        select
          date_trunc('day', now() at time zone 'Asia/Dhaka') at time zone 'Asia/Dhaka' as day_start,
          date_trunc('month', now() at time zone 'Asia/Dhaka') at time zone 'Asia/Dhaka' as month_start
      )
      select
        count(*) filter (
          where ${transactions.type} = 'deposit'
            and ${transactions.status} in ('success', 'approved', 'paid')
            and ${transactions.createdAt} >= bounds.day_start
        )::int as today_deposit_count,
        coalesce(sum(${transactions.amount} + ${transactions.bonusAmount}) filter (
          where ${transactions.type} = 'deposit'
            and ${transactions.status} in ('success', 'approved', 'paid')
            and ${transactions.createdAt} >= bounds.day_start
        ), 0)::text as today_deposit_amount,
        count(*) filter (
          where ${transactions.type} = 'withdraw'
            and ${transactions.status} in ('success', 'approved', 'paid')
            and ${transactions.createdAt} >= bounds.day_start
        )::int as today_withdraw_count,
        coalesce(sum(${transactions.amount}) filter (
          where ${transactions.type} = 'withdraw'
            and ${transactions.status} in ('success', 'approved', 'paid')
            and ${transactions.createdAt} >= bounds.day_start
        ), 0)::text as today_withdraw_amount,
        coalesce(sum(${transactions.amount} + ${transactions.bonusAmount}) filter (
          where ${transactions.type} = 'deposit'
            and ${transactions.status} in ('success', 'approved', 'paid')
            and ${transactions.createdAt} >= bounds.month_start
        ), 0)::text as month_deposit_amount,
        (select count(*)::int from ${tournaments}
          where ${tournaments.status} in ('waiting', 'active')) as active_tournaments,
        (select count(*)::int from ${users}
          where ${users.isBot} = false) as total_users,
        coalesce(sum(
          case
            when ${transactions.type} = 'tournament_fee'
              and ${transactions.status} in ('success', 'approved', 'paid')
              then ${transactions.amount}
            when ${transactions.type} = 'transfer'
              and ${transactions.status} in ('success', 'approved', 'paid')
              then ${transactions.commissionAmount}
            else 0
          end
        ), 0)::text as all_time_revenue
      from ${transactions}, bounds
    `),
    db.execute<{
      tournament_fees: string;
      transfer_commissions: string;
      referral_paid: string;
      prize_paid: string;
      withdrawals_paid: string;
    }>(sql`
      select
        coalesce(sum(${transactions.amount}) filter (
          where ${transactions.type} = 'tournament_fee'
            and ${transactions.status} in ('success', 'approved', 'paid')
        ), 0)::text as tournament_fees,
        coalesce(sum(${transactions.commissionAmount}) filter (
          where ${transactions.type} = 'transfer'
            and ${transactions.status} in ('success', 'approved', 'paid')
        ), 0)::text as transfer_commissions,
        coalesce(sum(${transactions.amount}) filter (
          where ${transactions.type} = 'refer'
            and ${transactions.status} in ('success', 'approved', 'paid')
        ), 0)::text as referral_paid,
        coalesce(sum(${transactions.amount}) filter (
          where ${transactions.type} = 'prize'
            and ${transactions.status} in ('success', 'approved', 'paid')
        ), 0)::text as prize_paid,
        coalesce(sum(${transactions.amount}) filter (
          where ${transactions.type} = 'withdraw'
            and ${transactions.status} in ('success', 'approved', 'paid')
        ), 0)::text as withdrawals_paid
      from ${transactions}
    `),
  ]);

  const row = summaryResult.rows[0];
  const breakdown = breakdownResult.rows[0];
  return {
    stats: {
      todayDeposits: {
        count: numberValue(row?.today_deposit_count),
        amount: row?.today_deposit_amount ?? "0",
      },
      todayWithdrawals: {
        count: numberValue(row?.today_withdraw_count),
        amount: row?.today_withdraw_amount ?? "0",
      },
      monthDeposits: row?.month_deposit_amount ?? "0",
      activePlayers,
      activeTournaments: numberValue(row?.active_tournaments),
      totalUsers: numberValue(row?.total_users),
      allTimeRevenue: row?.all_time_revenue ?? "0",
    },
    revenue: {
      tournamentFees: breakdown?.tournament_fees ?? "0",
      transferCommissions: breakdown?.transfer_commissions ?? "0",
      referralPaid: breakdown?.referral_paid ?? "0",
      prizePaid: breakdown?.prize_paid ?? "0",
      withdrawalsPaid: breakdown?.withdrawals_paid ?? "0",
    },
  };
}

export async function getFinancialReport(period: ReportPeriod) {
  const bucket =
    period === "daily"
      ? sql`date_trunc('day', ${transactions.createdAt} at time zone 'Asia/Dhaka')`
      : period === "weekly"
        ? sql`date_trunc('week', ${transactions.createdAt} at time zone 'Asia/Dhaka')`
        : sql`date_trunc('month', ${transactions.createdAt} at time zone 'Asia/Dhaka')`;
  const since =
    period === "daily"
      ? sql`now() - interval '30 days'`
      : period === "weekly"
        ? sql`now() - interval '12 weeks'`
        : sql`now() - interval '12 months'`;

  const result = await db.execute<{
    bucket: Date;
    deposits: string;
    withdrawals: string;
    prizes: string;
    collected: string;
    revenue: string;
  }>(sql`
    select
      ${bucket} as bucket,
      coalesce(sum(${transactions.amount} + ${transactions.bonusAmount}) filter (
        where ${transactions.type} = 'deposit'
      ), 0)::text as deposits,
      coalesce(sum(${transactions.amount}) filter (
        where ${transactions.type} = 'withdraw'
      ), 0)::text as withdrawals,
      coalesce(sum(${transactions.amount}) filter (
        where ${transactions.type} = 'prize'
      ), 0)::text as prizes,
      coalesce(sum(${transactions.amount}) filter (
        where ${transactions.type} = 'tournament_fee'
      ), 0)::text as collected,
      coalesce(sum(
        case
          when ${transactions.type} = 'tournament_fee' then ${transactions.amount}
          when ${transactions.type} = 'transfer' then ${transactions.commissionAmount}
          else 0
        end
      ), 0)::text as revenue
    from ${transactions}
    where ${transactions.createdAt} >= ${since}
      and ${transactions.status} in ('success', 'approved', 'paid')
    group by 1
    order by 1
  `);

  return {
    period,
    points: result.rows.map((row) => ({
      ...row,
      bucket: new Date(row.bucket).toISOString(),
    })),
  };
}

export async function exportAdminCsv(
  report: "users" | "transactions" | "tournaments",
): Promise<string> {
  if (report === "users") {
    const rows = await db
      .select({
        gameId: users.gameId,
        name: users.name,
        phone: users.phone,
        email: users.email,
        mainBalance: users.mainBalance,
        winnerBalance: users.winnerBalance,
        banned: users.isBanned,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.isBot, false))
      .orderBy(desc(users.createdAt));
    return makeCsv(
      [
        "game_id",
        "name",
        "phone",
        "email",
        "main_balance",
        "winner_balance",
        "banned",
        "created_at",
      ],
      rows.map((row) => Object.values(row)),
    );
  }

  if (report === "transactions") {
    const rows = await db
      .select({
        id: transactions.id,
        gameId: users.gameId,
        type: transactions.type,
        amount: transactions.amount,
        status: transactions.status,
        method: transactions.method,
        commission: transactions.commissionAmount,
        createdAt: transactions.createdAt,
      })
      .from(transactions)
      .innerJoin(users, eq(transactions.userId, users.id))
      .orderBy(desc(transactions.createdAt));
    return makeCsv(
      [
        "id",
        "game_id",
        "type",
        "amount",
        "status",
        "method",
        "commission",
        "created_at",
      ],
      rows.map((row) => Object.values(row)),
    );
  }

  const rows = await db
    .select({
      id: tournaments.id,
      title: tournaments.title,
      status: tournaments.status,
      playerCount: tournaments.playerCount,
      joinFee: tournaments.joinFee,
      prizePool: tournaments.prizePool,
      commission: tournaments.adminCommission,
      startsAt: tournaments.startsAt,
      createdAt: tournaments.createdAt,
    })
    .from(tournaments)
    .orderBy(desc(tournaments.createdAt));
  return makeCsv(
    [
      "id",
      "title",
      "status",
      "player_count",
      "join_fee",
      "prize_pool",
      "admin_commission",
      "starts_at",
      "created_at",
    ],
    rows.map((row) => Object.values(row)),
  );
}

export async function listAdminUsers(input: {
  search?: string | undefined;
  status?: "all" | "active" | "banned";
  limit?: number;
  offset?: number;
}) {
  const filters = [eq(users.isBot, false)];
  if (input.search) {
    const query = `%${input.search}%`;
    filters.push(
      or(
        ilike(users.name, query),
        ilike(users.phone, query),
        ilike(users.gameId, query),
      )!,
    );
  }
  if (input.status === "active") filters.push(eq(users.isBanned, false));
  if (input.status === "banned") filters.push(eq(users.isBanned, true));

  const where = and(...filters);
  const [rows, countRows] = await Promise.all([
    db
      .select({
        id: users.id,
        gameId: users.gameId,
        name: users.name,
        phone: users.phone,
        email: users.email,
        avatar: users.avatar,
        mainBalance: users.mainBalance,
        winnerBalance: users.winnerBalance,
        isBanned: users.isBanned,
        ipAddress: users.ipAddress,
        deviceId: users.deviceId,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(input.limit ?? 30)
      .offset(input.offset ?? 0),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(where),
  ]);
  return { users: rows, total: countRows[0]?.count ?? 0 };
}

export async function getAdminUserDetail(userId: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });
  if (!user || user.isBot) {
    throw new AppError(404, "USER_NOT_FOUND", "User was not found.");
  }
  const [history, entries, sessions] = await Promise.all([
    db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, userId))
      .orderBy(desc(transactions.createdAt))
      .limit(100),
    db
      .select({
        id: tournamentEntries.id,
        status: tournamentEntries.status,
        joinedAt: tournamentEntries.joinedAt,
        tournamentId: tournaments.id,
        title: tournaments.title,
        tournamentStatus: tournaments.status,
      })
      .from(tournamentEntries)
      .innerJoin(
        tournaments,
        eq(tournamentEntries.tournamentId, tournaments.id),
      )
      .where(eq(tournamentEntries.userId, userId))
      .orderBy(desc(tournamentEntries.joinedAt))
      .limit(50),
    db
      .select({
        id: authSessions.id,
        ipAddress: authSessions.ipAddress,
        deviceId: authSessions.deviceId,
        createdAt: authSessions.createdAt,
        expiresAt: authSessions.expiresAt,
        revokedAt: authSessions.revokedAt,
      })
      .from(authSessions)
      .where(eq(authSessions.userId, userId))
      .orderBy(desc(authSessions.createdAt))
      .limit(20),
  ]);
  return {
    user: toPublicUser(user),
    security: {
      ipAddress: user.ipAddress,
      deviceId: user.deviceId,
      sessions,
    },
    transactions: history,
    tournaments: entries,
  };
}

export async function adjustUserBalance(input: {
  userId: string;
  balance: "main" | "winner";
  operation: "add" | "subtract";
  amount: number;
  reason: string;
  actorId: string;
  ipAddress: string;
  io?: Server | undefined;
}) {
  const result = await db.transaction(async (transaction) => {
    const [user] = await transaction
      .select()
      .from(users)
      .where(eq(users.id, input.userId))
      .for("update");
    if (!user || user.isBot) {
      throw new AppError(404, "USER_NOT_FOUND", "User was not found.");
    }
    const current = numberValue(
      input.balance === "main" ? user.mainBalance : user.winnerBalance,
    );
    const next =
      input.operation === "add"
        ? current + input.amount
        : current - input.amount;
    if (next < 0) {
      throw new AppError(
        409,
        "INSUFFICIENT_BALANCE",
        "Adjustment would make the balance negative.",
      );
    }

    const [updated] = await transaction
      .update(users)
      .set({
        ...(input.balance === "main"
          ? { mainBalance: next.toFixed(2) }
          : { winnerBalance: next.toFixed(2) }),
        updatedAt: new Date(),
      })
      .where(eq(users.id, input.userId))
      .returning();
    await transaction.insert(transactions).values({
      userId: input.userId,
      type: "bonus",
      amount: input.amount.toFixed(2),
      status: "success",
      direction: input.operation === "add" ? "incoming" : "outgoing",
      balanceSource: input.balance,
      reviewedBy: input.actorId,
      reviewedAt: new Date(),
      balanceAppliedAt: new Date(),
      reference: `ADMIN-${Date.now()}`,
      metadata: {
        kind: "admin_adjustment",
        reason: input.reason,
        operation: input.operation,
      },
    });
    await transaction.insert(adminAuditLogs).values({
      actorId: input.actorId,
      action: "user.balance.adjust",
      targetType: "user",
      targetId: input.userId,
      ipAddress: input.ipAddress,
      details: {
        balance: input.balance,
        operation: input.operation,
        amount: input.amount,
        reason: input.reason,
      },
    });
    return updated;
  });
  if (!result) {
    throw new AppError(500, "BALANCE_UPDATE_FAILED", "Balance was not updated.");
  }
  emitBalanceUpdate(input.io, input.userId, {
    mainBalance: result.mainBalance,
    winnerBalance: result.winnerBalance,
    reason: "admin_adjustment",
  });
  return toPublicUser(result);
}

export async function setUserBan(input: {
  userId: string;
  banned: boolean;
  reason: string;
  actorId: string;
  ipAddress: string;
}) {
  const [updated] = await db
    .update(users)
    .set({ isBanned: input.banned, updatedAt: new Date() })
    .where(
      and(
        eq(users.id, input.userId),
        eq(users.isAdmin, false),
        eq(users.isSubAdmin, false),
      ),
    )
    .returning();
  if (!updated) {
    throw new AppError(
      404,
      "USER_NOT_FOUND",
      "User was not found or is an administrator.",
    );
  }
  if (input.banned) {
    await db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(authSessions.userId, input.userId),
          isNull(authSessions.revokedAt),
        ),
      );
  }
  await db.insert(adminAuditLogs).values({
    actorId: input.actorId,
    action: input.banned ? "user.ban" : "user.unban",
    targetType: "user",
    targetId: input.userId,
    ipAddress: input.ipAddress,
    details: { reason: input.reason },
  });
  return toPublicUser(updated);
}

export async function forceLogoutUser(input: {
  userId: string;
  actorId: string;
  ipAddress: string;
}) {
  await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(authSessions.userId, input.userId),
        isNull(authSessions.revokedAt),
      ),
    );
  await db.insert(adminAuditLogs).values({
    actorId: input.actorId,
    action: "user.force_logout",
    targetType: "user",
    targetId: input.userId,
    ipAddress: input.ipAddress,
    details: {},
  });
}

export async function resetUserPassword(input: {
  userId: string;
  password: string;
  actorId: string;
  ipAddress: string;
}) {
  const passwordHash = await bcrypt.hash(input.password, 12);
  await db.transaction(async (transaction) => {
    const [updated] = await transaction
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(
        and(
          eq(users.id, input.userId),
          eq(users.isBot, false),
          eq(users.isAdmin, false),
          eq(users.isSubAdmin, false),
        ),
      )
      .returning({ id: users.id });
    if (!updated) {
      throw new AppError(
        404,
        "USER_NOT_FOUND",
        "Player was not found or is an administrator.",
      );
    }
    await transaction
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(authSessions.userId, input.userId),
          isNull(authSessions.revokedAt),
        ),
      );
    await transaction.insert(adminAuditLogs).values({
      actorId: input.actorId,
      action: "user.password.reset",
      targetType: "user",
      targetId: input.userId,
      ipAddress: input.ipAddress,
      details: { sessionsRevoked: true },
    });
  });
}

export async function banUserEndpoint(input: {
  kind: "ip" | "device";
  value: string;
  reason: string;
  actorId: string;
  ipAddress: string;
}) {
  if (input.kind === "ip") {
    await db
      .insert(bannedIps)
      .values({
        ipAddress: input.value,
        reason: input.reason,
        bannedBy: input.actorId,
      })
      .onConflictDoUpdate({
        target: bannedIps.ipAddress,
        set: { reason: input.reason, bannedBy: input.actorId },
      });
  } else {
    await db
      .insert(bannedDevices)
      .values({
        deviceId: input.value,
        reason: input.reason,
        bannedBy: input.actorId,
      })
      .onConflictDoUpdate({
        target: bannedDevices.deviceId,
        set: { reason: input.reason, bannedBy: input.actorId },
      });
  }
  await db.insert(adminAuditLogs).values({
    actorId: input.actorId,
    action: `security.${input.kind}_ban`,
    targetType: input.kind,
    targetId: input.value,
    ipAddress: input.ipAddress,
    details: { reason: input.reason },
  });
}

async function uniqueAdminIdentity() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const gameId = generateGameId();
    const referCode = generateReferCode();
    const exists = await db.query.users.findFirst({
      where: or(eq(users.gameId, gameId), eq(users.referCode, referCode)),
      columns: { id: true },
    });
    if (!exists) return { gameId, referCode };
  }
  throw new AppError(
    503,
    "IDENTITY_ALLOCATION_FAILED",
    "Could not allocate a sub-admin identity.",
  );
}

export async function listSubAdmins() {
  return db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      permissions: users.adminPermissions,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.isSubAdmin, true))
    .orderBy(desc(users.createdAt));
}

export async function createSubAdmin(input: {
  username: string;
  name: string;
  password: string;
  permissions: AdminPermissionValue[];
  actorId: string;
  ipAddress: string;
}) {
  const identity = await uniqueAdminIdentity();
  const passwordHash = await bcrypt.hash(input.password, 12);
  try {
    const [created] = await db
      .insert(users)
      .values({
        ...identity,
        username: input.username.toLowerCase(),
        name: input.name,
        passwordHash,
        isSubAdmin: true,
        adminPermissions: input.permissions,
      })
      .returning();
    if (!created) throw new Error("No sub-admin returned.");
    await db.insert(adminAuditLogs).values({
      actorId: input.actorId,
      action: "subadmin.create",
      targetType: "user",
      targetId: created.id,
      ipAddress: input.ipAddress,
      details: {
        username: created.username,
        permissions: input.permissions,
      },
    });
    return toPublicUser(created);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("users_username_unique")
    ) {
      throw new AppError(
        409,
        "USERNAME_EXISTS",
        "This username is already in use.",
      );
    }
    throw error;
  }
}

export async function updateSubAdmin(input: {
  subAdminId: string;
  name?: string | undefined;
  password?: string | undefined;
  permissions?: AdminPermissionValue[] | undefined;
  actorId: string;
  ipAddress: string;
}) {
  const passwordHash = input.password
    ? await bcrypt.hash(input.password, 12)
    : undefined;
  const [updated] = await db
    .update(users)
    .set({
      ...(input.name ? { name: input.name } : {}),
      ...(passwordHash ? { passwordHash } : {}),
      ...(input.permissions
        ? { adminPermissions: input.permissions }
        : {}),
      updatedAt: new Date(),
    })
    .where(
      and(eq(users.id, input.subAdminId), eq(users.isSubAdmin, true)),
    )
    .returning();
  if (!updated) {
    throw new AppError(404, "SUBADMIN_NOT_FOUND", "Sub-admin was not found.");
  }
  if (passwordHash) {
    await db
      .update(authSessions)
      .set({ revokedAt: new Date() })
      .where(eq(authSessions.userId, input.subAdminId));
  }
  await db.insert(adminAuditLogs).values({
    actorId: input.actorId,
    action: "subadmin.update",
    targetType: "user",
    targetId: input.subAdminId,
    ipAddress: input.ipAddress,
    details: {
      nameChanged: Boolean(input.name),
      passwordChanged: Boolean(input.password),
      permissions: input.permissions,
    },
  });
  return toPublicUser(updated);
}

export async function archiveSubAdmin(input: {
  subAdminId: string;
  actorId: string;
  ipAddress: string;
}) {
  const [updated] = await db
    .update(users)
    .set({
      username: null,
      passwordHash: null,
      isSubAdmin: false,
      adminPermissions: [],
      updatedAt: new Date(),
    })
    .where(
      and(eq(users.id, input.subAdminId), eq(users.isSubAdmin, true)),
    )
    .returning({ id: users.id });
  if (!updated) {
    throw new AppError(404, "SUBADMIN_NOT_FOUND", "Sub-admin was not found.");
  }
  await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(eq(authSessions.userId, input.subAdminId));
  await db.insert(adminAuditLogs).values({
    actorId: input.actorId,
    action: "subadmin.archive",
    targetType: "user",
    targetId: input.subAdminId,
    ipAddress: input.ipAddress,
    details: {},
  });
}

export async function createSupportTicket(input: {
  userId: string;
  subject: string;
  message: string;
}) {
  const [ticket] = await db
    .insert(supportTickets)
    .values(input)
    .returning();
  return ticket;
}

export async function listUserSupportTickets(userId: string) {
  return db
    .select()
    .from(supportTickets)
    .where(eq(supportTickets.userId, userId))
    .orderBy(desc(supportTickets.updatedAt));
}

export async function listAdminSupportTickets(input: {
  status?: "all" | "open" | "in_progress" | "resolved";
}) {
  const where =
    input.status && input.status !== "all"
      ? eq(supportTickets.status, input.status)
      : undefined;
  return db
    .select({
      ticket: supportTickets,
      user: {
        id: users.id,
        gameId: users.gameId,
        name: users.name,
        phone: users.phone,
      },
    })
    .from(supportTickets)
    .innerJoin(users, eq(supportTickets.userId, users.id))
    .where(where)
    .orderBy(desc(supportTickets.updatedAt));
}

export async function updateSupportTicket(input: {
  ticketId: string;
  status?: "open" | "in_progress" | "resolved" | undefined;
  reply?: string | undefined;
  assignedTo?: string | null | undefined;
  actorId: string;
  ipAddress: string;
  io?: Server | undefined;
}) {
  const [updated] = await db
    .update(supportTickets)
    .set({
      ...(input.status ? { status: input.status } : {}),
      ...(input.reply ? { adminReply: input.reply } : {}),
      ...(input.assignedTo !== undefined
        ? { assignedTo: input.assignedTo }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(supportTickets.id, input.ticketId))
    .returning();
  if (!updated) {
    throw new AppError(404, "TICKET_NOT_FOUND", "Ticket was not found.");
  }
  if (input.reply) {
    const [notice] = await db
      .insert(notifications)
      .values({
        userId: updated.userId,
        title: "Support reply",
        message: input.reply,
      })
      .returning();
    if (notice) emitNotification(input.io, updated.userId, notice);
  }
  await db.insert(adminAuditLogs).values({
    actorId: input.actorId,
    action: "support.ticket.update",
    targetType: "support_ticket",
    targetId: input.ticketId,
    ipAddress: input.ipAddress,
    details: {
      status: input.status,
      replied: Boolean(input.reply),
      assignedTo: input.assignedTo,
    },
  });
  return updated;
}

export async function sendAdminNotification(input: {
  userId?: string | undefined;
  title: string;
  message: string;
  actorId: string;
  ipAddress: string;
  io?: Server | undefined;
}) {
  const directRecipient = input.userId
    ? await db.query.users.findFirst({
        where: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          input.userId,
        )
          ? or(
              eq(users.id, input.userId),
              eq(users.gameId, input.userId),
            )
          : eq(users.gameId, input.userId),
        columns: { id: true },
      })
    : undefined;
  if (input.userId && !directRecipient) {
    throw new AppError(
      404,
      "RECIPIENT_NOT_FOUND",
      "No player matched that Game ID or UUID.",
    );
  }
  const recipients = directRecipient
    ? [directRecipient]
    : await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.isBot, false), eq(users.isBanned, false)));
  if (recipients.length === 0) {
    throw new AppError(404, "RECIPIENT_NOT_FOUND", "No recipient was found.");
  }
  const created = await db
    .insert(notifications)
    .values(
      recipients.map((recipient) => ({
        userId: recipient.id,
        title: input.title,
        message: input.message,
      })),
    )
    .returning();
  for (const notice of created) {
    if (notice.userId) emitNotification(input.io, notice.userId, notice);
  }
  await db.insert(adminAuditLogs).values({
    actorId: input.actorId,
    action: "notification.send",
    targetType: directRecipient ? "user" : "all_users",
    targetId: directRecipient?.id,
    ipAddress: input.ipAddress,
    details: {
      title: input.title,
      message: input.message,
      delivered: created.length,
    },
  });
  return { delivered: created.length };
}

export async function listAdminNotificationHistory(limit = 50) {
  return db
    .select({
      id: adminAuditLogs.id,
      targetId: adminAuditLogs.targetId,
      details: adminAuditLogs.details,
      createdAt: adminAuditLogs.createdAt,
      actor: {
        id: users.id,
        name: users.name,
        username: users.username,
      },
    })
    .from(adminAuditLogs)
    .innerJoin(users, eq(adminAuditLogs.actorId, users.id))
    .where(eq(adminAuditLogs.action, "notification.send"))
    .orderBy(desc(adminAuditLogs.createdAt))
    .limit(limit);
}

const adminSettingKeys = [
  "site.name",
  "site.logo_url",
  "site.theme_preset",
  "site.primary_color",
  "site.secondary_color",
  "site.button_color",
  "site.card_color",
  "site.background_color",
  "site.accent_color",
  "site.maintenance_enabled",
  "site.maintenance_message",
  "social.telegram_url",
  "social.whatsapp_url",
  "social.facebook_url",
  "game.dice_speed",
  "game.token_speed",
  "game.voice_enabled",
  "game.voice_provider",
  "game.voice_daily_domain",
  "game.voice_daily_api_key",
  "tournament.default_admin_commission",
  "tournament.recurring_full_countdown_seconds",
  "security.max_accounts_per_ip",
  "security.max_accounts_per_device",
  "security.auto_ban_threshold",
  "api.google_client_id",
  "api.google_client_secret",
  "api.google_callback_url",
  "api.other_keys",
  "legal.terms_text",
  "legal.privacy_text",
] as const;

const secretSettingKeys = new Set([
  "api.google_client_secret",
  "api.other_keys",
  "game.voice_daily_api_key",
]);

export async function getAdminSettings() {
  const values = await getSettings(adminSettingKeys);
  for (const key of secretSettingKeys) {
    values[key] = values[key] ? "********" : "";
  }
  return { values, googleReloadRequired: false };
}

export async function updateAdminSettings(input: {
  values: Record<string, string>;
  actorId: string;
  ipAddress: string;
}) {
  const allowed = new Set<string>(adminSettingKeys);
  const values: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(input.values)) {
    if (!allowed.has(key)) {
      throw new AppError(
        400,
        "SETTING_NOT_ALLOWED",
        `Setting "${key}" cannot be changed here.`,
      );
    }
    if (rawValue === "********") continue;
    if (key === "site.theme_preset" && !THEME_PRESET_IDS.includes(rawValue as never)) {
      throw new AppError(
        400,
        "INVALID_THEME_PRESET",
        `Theme preset "${rawValue}" is not supported.`,
      );
    }
    if (key.endsWith("_color") && !/^#[0-9a-f]{6}$/i.test(rawValue)) {
      throw new AppError(
        400,
        "INVALID_THEME_COLOR",
        `Setting "${key}" must be a six-digit hex color.`,
      );
    }
    if (key === "tournament.recurring_full_countdown_seconds") {
      const seconds = Number(rawValue);
      if (!Number.isInteger(seconds) || seconds < 10 || seconds > 86400) {
        throw new AppError(
          400,
          "INVALID_TOURNAMENT_COUNTDOWN",
          "Tournament full হওয়ার পর countdown 10 থেকে 86400 seconds হতে হবে।",
        );
      }
    }
    values[key] = secretSettingKeys.has(key) && rawValue
      ? encryptSecret(rawValue)
      : rawValue;
  }
  const selectedPreset = values["site.theme_preset"]
    ? getThemePreset(values["site.theme_preset"])
    : null;
  if (selectedPreset) {
    Object.assign(values, presetToSettingValues(selectedPreset));
  }
  await updateSettingsWithAudit({
    values,
    actorId: input.actorId,
    ipAddress: input.ipAddress,
    action: "admin.settings.update",
    targetType: "settings",
  });
  if (
    Object.keys(values).some((key) => key.startsWith("api.google_"))
  ) {
    await configureGoogleAuthFromSettings();
  }
  return getAdminSettings();
}

export async function listAdminAudit(limit = 100) {
  return db
    .select({
      id: adminAuditLogs.id,
      action: adminAuditLogs.action,
      targetType: adminAuditLogs.targetType,
      targetId: adminAuditLogs.targetId,
      details: adminAuditLogs.details,
      ipAddress: adminAuditLogs.ipAddress,
      createdAt: adminAuditLogs.createdAt,
      actor: {
        id: users.id,
        name: users.name,
        username: users.username,
      },
    })
    .from(adminAuditLogs)
    .innerJoin(users, eq(adminAuditLogs.actorId, users.id))
    .orderBy(desc(adminAuditLogs.createdAt))
    .limit(limit);
}
