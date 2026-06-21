import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "../db/client.js";
import {
  adminAuditLogs,
  authSessions,
  matchPlayers,
  matches,
  tournamentEntries,
  tournaments,
  transactions,
  users,
  type User,
} from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { avatarOptions, validPresetAvatars } from "../lib/avatars.js";
import { toPublicUser } from "../lib/public-user.js";
import { getSettings } from "./settings.service.js";

export { avatarOptions };

const profileSocialKeys = [
  "social.telegram_url",
  "social.whatsapp_url",
  "social.facebook_url",
] as const;

interface ProfileUpdate {
  name?: string;
  email?: string | null;
  avatar?: string;
  phone?: string;
}

interface ProfileAudit {
  actorId: string;
  ipAddress: string;
  fields: string[];
}

async function assertUniqueContact(
  input: { phone?: string; email?: string },
  exceptUserId: string,
): Promise<void> {
  if (input.phone) {
    const duplicate = await db.query.users.findFirst({
      where: and(
        eq(users.phone, input.phone),
        sql`${users.id} <> ${exceptUserId}`,
      ),
      columns: { id: true },
    });
    if (duplicate) {
      throw new AppError(
        409,
        "PHONE_EXISTS",
        "এই ফোন নম্বরটি অন্য অ্যাকাউন্টে ব্যবহার হচ্ছে।",
      );
    }
  }

  if (input.email) {
    const duplicate = await db.query.users.findFirst({
      where: and(
        eq(users.email, input.email),
        sql`${users.id} <> ${exceptUserId}`,
      ),
      columns: { id: true },
    });
    if (duplicate) {
      throw new AppError(
        409,
        "EMAIL_EXISTS",
        "এই ইমেইলটি অন্য অ্যাকাউন্টে ব্যবহার হচ্ছে।",
      );
    }
  }
}

export async function getProfileOverview(userId: string) {
  const [user, social] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, userId) }),
    getSettings(profileSocialKeys),
  ]);
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User পাওয়া যায়নি।");
  }

  return {
    user: toPublicUser(user),
    hasPassword: Boolean(user.passwordHash),
    avatarOptions,
    social: {
      telegram: social["social.telegram_url"],
      whatsapp: social["social.whatsapp_url"],
      facebook: social["social.facebook_url"],
    },
  };
}

export async function updateUserProfile(
  userId: string,
  input: ProfileUpdate,
  audit?: ProfileAudit,
): Promise<User> {
  if (input.avatar && !validPresetAvatars.includes(input.avatar)) {
    throw new AppError(
      400,
      "INVALID_AVATAR",
      "নির্ধারিত avatar থেকে একটি নির্বাচন করুন।",
    );
  }
  await assertUniqueContact(
    {
      ...(input.phone ? { phone: input.phone } : {}),
      ...(input.email ? { email: input.email } : {}),
    },
    userId,
  );

  return db.transaction(async (transaction) => {
    const [user] = await transaction
      .update(users)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.avatar !== undefined ? { avatar: input.avatar } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning();

    if (!user) {
      throw new AppError(404, "USER_NOT_FOUND", "User পাওয়া যায়নি।");
    }
    if (audit) {
      await transaction.insert(adminAuditLogs).values({
        actorId: audit.actorId,
        action: "user.profile.update",
        targetType: "user",
        targetId: userId,
        ipAddress: audit.ipAddress,
        details: { fields: audit.fields },
      });
    }
    return user;
  });
}

export async function updateUserAvatar(
  userId: string,
  avatar: string,
): Promise<User> {
  if (!/^data:image\/(?:png|jpeg|webp);base64,/.test(avatar)) {
    throw new AppError(
      400,
      "INVALID_AVATAR_IMAGE",
      "PNG, JPEG, or WebP profile image is required.",
    );
  }
  const [user] = await db
    .update(users)
    .set({ avatar, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User was not found.");
  }
  return user;
}

export async function changeUserPassword(
  userId: string,
  input: { currentPassword?: string; newPassword: string },
) {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User was not found.");
  }
  if (user.isGuest || user.isBot || user.isAdmin || user.isSubAdmin) {
    throw new AppError(
      403,
      "PASSWORD_CHANGE_FORBIDDEN",
      "This account cannot change its password here.",
    );
  }

  if (user.passwordHash) {
    if (!input.currentPassword) {
      throw new AppError(
        400,
        "CURRENT_PASSWORD_REQUIRED",
        "Current password is required.",
      );
    }
    const valid = await bcrypt.compare(
      input.currentPassword,
      user.passwordHash,
    );
    if (!valid) {
      throw new AppError(
        401,
        "INVALID_PASSWORD",
        "Current password is incorrect.",
      );
    }
  }

  const passwordHash = await bcrypt.hash(input.newPassword, 12);
  const [updated] = await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ id: users.id });
  if (!updated) {
    throw new AppError(404, "USER_NOT_FOUND", "User was not found.");
  }
}

function calculateHighestWinStreak(
  rows: Array<{ winnerId: string | null }>,
  userId: string,
): number {
  let current = 0;
  let highest = 0;
  for (const row of rows) {
    if (row.winnerId === userId) {
      current += 1;
      highest = Math.max(highest, current);
    } else {
      current = 0;
    }
  }
  return highest;
}

export async function getPlayerStats(userId: string) {
  const [gameRows, earningsRows, rankingRows, finishRows] = await Promise.all([
    db
      .select({
        winnerId: matches.winnerId,
        endedAt: matches.endedAt,
        createdAt: matches.createdAt,
      })
      .from(matchPlayers)
      .innerJoin(matches, eq(matchPlayers.matchId, matches.id))
      .where(
        and(
          eq(matchPlayers.userId, userId),
          eq(matches.status, "completed"),
        ),
      )
      .orderBy(asc(matches.endedAt), asc(matches.createdAt)),
    db
      .select({
        total: sql<string>`coalesce(sum(${transactions.amount}), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.type, "prize"),
          inArray(transactions.status, ["success", "paid"]),
        ),
      ),
    db.execute<{ id: string; rank: number }>(sql`
      select ranked.id, ranked.rank::int
      from (
        select
          ${users.id} as id,
          rank() over (
            order by coalesce(
              sum(${transactions.amount}) filter (
                where ${transactions.type} = 'prize'
                  and ${transactions.status} in ('success', 'paid')
              ),
              0
            ) desc,
            ${users.createdAt} asc
          ) as rank
        from ${users}
        left join ${transactions} on ${transactions.userId} = ${users.id}
        group by ${users.id}
      ) ranked
      where ranked.id = ${userId}
    `),
    db
      .select({
        best: sql<number | null>`min(${tournamentEntries.finishPosition})::int`,
      })
      .from(tournamentEntries)
      .where(
        and(
          eq(tournamentEntries.userId, userId),
          isNotNull(tournamentEntries.finishPosition),
        ),
      ),
  ]);

  const totalGames = gameRows.length;
  const totalWins = gameRows.filter((row) => row.winnerId === userId).length;
  const totalLosses = totalGames - totalWins;
  return {
    totalGames,
    totalWins,
    totalLosses,
    winRate:
      totalGames === 0
        ? 0
        : Number(((totalWins / totalGames) * 100).toFixed(1)),
    totalEarnings: earningsRows[0]?.total ?? "0",
    currentRank: rankingRows.rows[0]?.rank ?? 0,
    highestWinStreak: calculateHighestWinStreak(gameRows, userId),
    bestTournamentFinish: finishRows[0]?.best ?? null,
  };
}

export async function getTournamentHistory(userId: string) {
  return db
    .select({
      id: tournamentEntries.id,
      tournamentId: tournaments.id,
      title: tournaments.title,
      gameMode: tournaments.gameMode,
      joinFee: tournaments.joinFee,
      finishPosition: tournamentEntries.finishPosition,
      prizeEarned: tournamentEntries.prizeEarned,
      date: tournamentEntries.updatedAt,
    })
    .from(tournamentEntries)
    .innerJoin(
      tournaments,
      eq(tournamentEntries.tournamentId, tournaments.id),
    )
    .where(
      and(
        eq(tournamentEntries.userId, userId),
        isNotNull(tournamentEntries.finishPosition),
      ),
    )
    .orderBy(desc(tournamentEntries.updatedAt))
    .limit(50)
    .then((rows) =>
      rows.map((row) => ({
        ...row,
        result: row.finishPosition === 1 ? "win" : "loss",
      })),
    );
}

export async function getTransactionHistory(
  userId: string,
  type: "deposit" | "withdraw",
) {
  return db.query.transactions.findMany({
    where: and(eq(transactions.userId, userId), eq(transactions.type, type)),
    orderBy: [desc(transactions.createdAt)],
    limit: 50,
    columns: {
      id: true,
      amount: true,
      status: true,
      method: true,
      bonusAmount: true,
      reference: true,
      createdAt: true,
    },
  });
}

export async function getReferralHistory(userId: string) {
  const referredUsers = await db.query.users.findMany({
    where: eq(users.referredBy, userId),
    orderBy: [desc(users.createdAt)],
    columns: { id: true, name: true, gameId: true, createdAt: true },
  });
  const referredIds = referredUsers.map((user) => user.id);
  if (referredIds.length === 0) {
    return { totalReferCount: 0, totalReferIncome: "0", items: [] };
  }

  const [depositRows, commissionRows] = await Promise.all([
    db
      .select({
        userId: transactions.userId,
        total: sql<string>`coalesce(sum(${transactions.amount}), 0)`,
      })
      .from(transactions)
      .where(
        and(
          inArray(transactions.userId, referredIds),
          eq(transactions.type, "deposit"),
          inArray(transactions.status, ["success", "paid"]),
        ),
      )
      .groupBy(transactions.userId),
    db
      .select({
        relatedUserId: transactions.relatedUserId,
        total: sql<string>`coalesce(sum(${transactions.amount}), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          eq(transactions.type, "refer"),
          inArray(transactions.status, ["success", "paid"]),
        ),
      )
      .groupBy(transactions.relatedUserId),
  ]);
  const deposits = new Map(
    depositRows.map((row) => [row.userId, row.total]),
  );
  const commissions = new Map(
    commissionRows.map((row) => [row.relatedUserId, row.total]),
  );
  const items = referredUsers.map((user) => ({
    id: user.id,
    name: user.name,
    gameId: user.gameId,
    joinedAt: user.createdAt,
    depositAmount: deposits.get(user.id) ?? "0",
    commissionEarned: commissions.get(user.id) ?? "0",
  }));
  const totalReferIncome = items
    .reduce((total, item) => total + Number(item.commissionEarned), 0)
    .toFixed(2);

  return {
    totalReferCount: items.length,
    totalReferIncome,
    items,
  };
}

export async function getTransferHistory(userId: string) {
  const rows = await db.query.transactions.findMany({
    where: and(
      eq(transactions.userId, userId),
      eq(transactions.type, "transfer"),
    ),
    orderBy: [desc(transactions.createdAt)],
    limit: 50,
    columns: {
      id: true,
      amount: true,
      status: true,
      direction: true,
      commissionAmount: true,
      relatedUserId: true,
      createdAt: true,
    },
  });
  const relatedIds = [
    ...new Set(
      rows
        .map((row) => row.relatedUserId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const relatedUsers =
    relatedIds.length > 0
      ? await db.query.users.findMany({
          where: inArray(users.id, relatedIds),
          columns: { id: true, name: true, gameId: true },
        })
      : [];
  const relatedMap = new Map(relatedUsers.map((user) => [user.id, user]));

  return rows.map((row) => ({
    ...row,
    otherParty: row.relatedUserId
      ? (relatedMap.get(row.relatedUserId) ?? null)
      : null,
  }));
}

export async function revokeOtherSessions(
  userId: string,
  currentSessionId?: string,
): Promise<void> {
  await db
    .update(authSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(authSessions.userId, userId),
        isNull(authSessions.revokedAt),
        currentSessionId
          ? sql`${authSessions.id} <> ${currentSessionId}`
          : sql`true`,
      ),
    );
}
