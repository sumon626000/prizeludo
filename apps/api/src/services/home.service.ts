import { randomInt } from "node:crypto";
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import type { Server } from "socket.io";
import { withPostgresAdvisoryLock } from "../lib/distributed-lock.js";
import { db } from "../db/client.js";
import {
  botPlayers,
  notifications,
  promotionalWins,
  tournamentEntries,
  tournaments,
  transactions,
  users,
} from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import {
  getSetting,
  getSettings,
  homeSettingDefaults,
} from "./settings.service.js";

const publicSettingKeys = Object.keys(homeSettingDefaults);

export interface HomeWinner {
  id: string;
  name: string;
  avatar: string;
  amount: string;
  isPromotional: boolean;
  createdAt: Date;
}

export interface HomeTournament {
  id: string;
  title: string;
  playerCount: number;
  boardType: "2p" | "4p";
  gameMode: "classic" | "quick" | "master";
  type: "free" | "paid";
  joinFee: string;
  prizePool: string;
  status: "upcoming" | "waiting" | "active" | "completed";
  countdownEndsAt: Date | null;
  startsAt: Date | null;
  joinedCount: number;
  isPreRegistered: boolean;
}

function parseCustomWinners(value: string): HomeWinner[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is { name: string; amount: string | number } =>
          Boolean(
            item &&
              typeof item === "object" &&
              "name" in item &&
              typeof item.name === "string" &&
              "amount" in item &&
              (typeof item.amount === "string" ||
                typeof item.amount === "number"),
          ),
      )
      .slice(0, 12)
      .map((item, index) => ({
        id: `custom-${index}`,
        name: item.name,
        avatar: "/avatar-leaf.svg",
        amount: String(item.amount),
        isPromotional: true,
        createdAt: new Date(0),
      }));
  } catch {
    return [];
  }
}

async function getWinners(settingsValues: Record<string, string>) {
  const [realRows, promotionalRows] = await Promise.all([
    db
      .select({
        id: transactions.id,
        name: users.name,
        avatar: users.avatar,
        amount: transactions.amount,
        createdAt: transactions.createdAt,
      })
      .from(transactions)
      .innerJoin(users, eq(transactions.userId, users.id))
      .where(
        and(
          eq(transactions.type, "prize"),
          eq(transactions.status, "success"),
        ),
      )
      .orderBy(desc(transactions.createdAt))
      .limit(16),
    db
      .select({
        id: promotionalWins.id,
        name: botPlayers.name,
        avatar: botPlayers.avatar,
        amount: promotionalWins.amount,
        isDisclosed: promotionalWins.isDisclosed,
        createdAt: promotionalWins.createdAt,
      })
      .from(promotionalWins)
      .innerJoin(botPlayers, eq(promotionalWins.botPlayerId, botPlayers.id))
      .where(eq(botPlayers.isActive, true))
      .orderBy(desc(promotionalWins.createdAt))
      .limit(12),
  ]);

  const real: HomeWinner[] = realRows.map((row) => ({
    ...row,
    isPromotional: false,
  }));
  const promotional: HomeWinner[] = promotionalRows.map((row) => ({
    id: row.id,
    name: row.name,
    avatar: row.avatar,
    amount: row.amount,
    isPromotional: row.isDisclosed,
    createdAt: row.createdAt,
  }));

  const custom = parseCustomWinners(
    settingsValues["home.marquee_custom_items"] ?? "[]",
  );
  const recorded = [...real, ...promotional].sort(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
  );
  return [...custom, ...recorded].slice(0, 20);
}

async function getLeaderboard() {
  const real = await db
    .select({
      id: users.id,
      name: users.name,
      avatar: users.avatar,
      earnings: sql<string>`coalesce(sum(${transactions.amount}), 0)`,
      wins: sql<number>`count(${transactions.id})::int`,
    })
    .from(users)
    .innerJoin(
      transactions,
      and(
        eq(transactions.userId, users.id),
        eq(transactions.type, "prize"),
        eq(transactions.status, "success"),
      ),
    )
    .groupBy(users.id)
    .orderBy(desc(sql`sum(${transactions.amount})`))
    .limit(5);

  const promotional = await db.query.botPlayers.findMany({
    where: eq(botPlayers.isActive, true),
    orderBy: [desc(botPlayers.totalEarnings)],
    limit: 5,
  });

  const realPlayers = real.map((player) => ({
    ...player,
    isPromotional: false,
  }));
  const promotionalPlayers = promotional.map((player) => ({
      id: player.id,
      name: player.name,
      avatar: player.avatar,
      earnings: player.totalEarnings,
      wins: player.wins,
      isPromotional: true,
    }));
  const selected = [
    ...realPlayers.slice(0, 3),
    ...promotionalPlayers.slice(0, Math.max(0, 5 - realPlayers.slice(0, 3).length)),
  ];
  if (selected.length < 5) {
    const selectedIds = new Set(selected.map((player) => player.id));
    selected.push(
      ...[...realPlayers, ...promotionalPlayers]
        .filter((player) => !selectedIds.has(player.id))
        .slice(0, 5 - selected.length),
    );
  }

  return selected
    .sort((left, right) => Number(right.earnings) - Number(left.earnings))
    .slice(0, 5);
}

async function getTournaments(userId?: string): Promise<{
  live: HomeTournament[];
  upcoming: HomeTournament[];
}> {
  const rows = await db
    .select({
      tournament: tournaments,
      joinedCount: sql<number>`count(${tournamentEntries.id}) filter (where ${tournamentEntries.status} = 'joined')::int`,
      isPreRegistered: userId
        ? sql<boolean>`bool_or(${tournamentEntries.userId} = ${userId} and ${tournamentEntries.status} = 'pre_registered')`
        : sql<boolean>`false`,
    })
    .from(tournaments)
    .leftJoin(tournamentEntries, eq(tournamentEntries.tournamentId, tournaments.id))
    .where(inArray(tournaments.status, ["upcoming", "waiting", "active"]))
    .groupBy(tournaments.id)
    .orderBy(tournaments.startsAt, tournaments.createdAt)
    .limit(12);

  const mapped = rows.map(
    ({ tournament, joinedCount, isPreRegistered }): HomeTournament => ({
      id: tournament.id,
      title: tournament.title,
      playerCount: tournament.playerCount,
      boardType: tournament.boardType,
      gameMode: tournament.gameMode,
      type: tournament.type,
      joinFee: tournament.joinFee,
      prizePool: tournament.prizePool,
      status: tournament.status,
      countdownEndsAt: tournament.countdownEndsAt,
      startsAt: tournament.startsAt,
      joinedCount,
      isPreRegistered: Boolean(isPreRegistered),
    }),
  );

  return {
    live: mapped
      .filter((tournament) =>
        ["waiting", "active"].includes(tournament.status),
      )
      .slice(0, 4),
    upcoming: mapped
      .filter((tournament) => tournament.status === "upcoming")
      .slice(0, 3),
  };
}

export async function getHomeSnapshot(userId?: string) {
  const [settingValues, winners, leaderboard, tournamentGroups, unreadRows] =
    await Promise.all([
      getSettings(publicSettingKeys),
      getSettings(publicSettingKeys).then(getWinners),
      getLeaderboard(),
      getTournaments(userId),
      userId
        ? db
            .select({
              count: sql<number>`count(*)::int`,
            })
            .from(notifications)
            .where(
              and(
                eq(notifications.isRead, false),
                or(eq(notifications.userId, userId), isNull(notifications.userId)),
              ),
            )
        : Promise.resolve([{ count: 0 }]),
    ]);

  return {
    settings: {
      siteName: settingValues["site.name"],
      logoUrl: settingValues["site.logo_url"],
      maxWinAmount: Number(settingValues["home.max_win_amount"] || 0),
      marqueeSpeedSeconds: Number(
        settingValues["home.marquee_speed_seconds"] || 28,
      ),
      social: {
        telegram: settingValues["social.telegram_url"],
        whatsapp: settingValues["social.whatsapp_url"],
        facebook: settingValues["social.facebook_url"],
      },
    },
    winners,
    leaderboard,
    tournaments: tournamentGroups.live,
    upcomingTournaments: tournamentGroups.upcoming,
    unreadNotifications: unreadRows[0]?.count ?? 0,
    serverTime: new Date(),
  };
}

export async function preRegisterTournament(
  tournamentId: string,
  userId: string,
) {
  const result = await db.transaction(async (transaction) => {
    const [tournament] = await transaction
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId))
      .limit(1)
      .for("update");

    if (!tournament) {
      throw new AppError(404, "TOURNAMENT_NOT_FOUND", "Tournament পাওয়া যায়নি।");
    }
    if (tournament.status !== "upcoming") {
      throw new AppError(
        409,
        "PRE_REGISTRATION_CLOSED",
        "এই tournament-এর pre-registration বন্ধ।",
      );
    }

    const existing = await transaction.query.tournamentEntries.findFirst({
      where: and(
        eq(tournamentEntries.tournamentId, tournamentId),
        eq(tournamentEntries.userId, userId),
        eq(tournamentEntries.status, "pre_registered"),
      ),
    });
    if (existing) {
      return {
        entry: existing,
        tournament,
        notification: null,
        alreadyRegistered: true,
      };
    }

    const [entry] = await transaction
      .insert(tournamentEntries)
      .values({
        tournamentId,
        userId,
        status: "pre_registered",
      })
      .onConflictDoUpdate({
        target: [tournamentEntries.tournamentId, tournamentEntries.userId],
        set: { status: "pre_registered", updatedAt: new Date() },
      })
      .returning();

    const [notification] = await transaction
      .insert(notifications)
      .values({
        userId,
        title: "Pre-registration সম্পন্ন",
        message: `${tournament.title} চালু হলে আপনাকে জানানো হবে।`,
      })
      .returning();

    return {
      entry,
      tournament,
      notification,
      alreadyRegistered: false,
    };
  });

  return result;
}

export async function generatePromotionalWin(
  io: Server,
): Promise<HomeWinner | null> {
  const enabled = await getSetting("home.promotional_wins_enabled");
  if (enabled !== "true") return null;

  const players = await db.query.botPlayers.findMany({
    where: eq(botPlayers.isActive, true),
  });
  if (players.length === 0) return null;

  const player = players[randomInt(0, players.length)];
  if (!player) return null;

  const amounts = [100, 200, 300, 500, 750, 1000];
  const amount = String(amounts[randomInt(0, amounts.length)] ?? 100);
  const [win] = await db.transaction(async (transaction) => {
    const inserted = await transaction
      .insert(promotionalWins)
      .values({
        botPlayerId: player.id,
        amount,
        isDisclosed: true,
      })
      .returning();
    await transaction
      .update(botPlayers)
      .set({
        wins: sql`${botPlayers.wins} + 1`,
        totalEarnings: sql`${botPlayers.totalEarnings} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(botPlayers.id, player.id));
    return inserted;
  });

  if (!win) return null;
  const payload: HomeWinner = {
    id: win.id,
    name: player.name,
    avatar: player.avatar,
    amount: win.amount,
    isPromotional: true,
    createdAt: win.createdAt,
  };
  io.emit("home:winner", payload);
  return payload;
}

export async function ensureInitialPromotionalWin(io: Server): Promise<void> {
  await withPostgresAdvisoryLock(1_071_004, async () => {
    const [row] = await db
      .select({ total: count() })
      .from(promotionalWins);
    if ((row?.total ?? 0) === 0) {
      await generatePromotionalWin(io);
    }
  });
}

export interface HomeRealtimeScheduler {
  reschedule: () => Promise<void>;
  stop: () => void;
}

export async function startHomeRealtimeJobs(
  io: Server,
): Promise<HomeRealtimeScheduler> {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const reschedule = async () => {
    if (timer) clearTimeout(timer);
    if (stopped) return;

    const intervalValue = await getSetting("home.marquee_interval_seconds");
    const intervalSeconds = Math.max(30, Number(intervalValue || 90));
    timer = setTimeout(async () => {
      try {
        await withPostgresAdvisoryLock(1_071_004, () =>
          generatePromotionalWin(io),
        );
      } catch (error) {
        console.error("Promotional winner job failed", error);
      } finally {
        await reschedule();
      }
    }, intervalSeconds * 1_000);
    timer.unref();
  };

  await reschedule();
  return {
    reschedule,
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
