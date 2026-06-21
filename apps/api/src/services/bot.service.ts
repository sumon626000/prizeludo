import { randomInt } from "node:crypto";
import {
  and,
  asc,
  count,
  eq,
  inArray,
  ne,
  sql,
} from "drizzle-orm";
import type { Server } from "socket.io";
import { db } from "../db/client.js";
import {
  adminAuditLogs,
  botPlayers,
  settings,
  tournamentEntries,
  tournaments,
  users,
} from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { PRESET_AVATAR_COUNT, presetAvatarPath } from "../lib/avatars.js";
import {
  getSettings,
  updateSettingsWithAudit,
} from "./settings.service.js";

type DatabaseTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

const BOT_SETTING_KEYS = [
  "bots.enabled",
  "bots.global_win_rate",
  "bots.action_delay_min_ms",
  "bots.action_delay_max_ms",
] as const;

const SHOWCASE_FIRST_NAMES = [
  "Arafat", "Arif", "Asif", "Fahim", "Hasan", "Imran", "Jahid", "Mahin",
  "Nabil", "Nayeem", "Rakib", "Rifat", "Sabbir", "Sakib", "Shuvo", "Tanvir",
  "Tuhin", "Adiba", "Anika", "Farzana",
] as const;
const SHOWCASE_LAST_NAMES = [
  "Ahmed", "Akter", "Chowdhury", "Haque", "Hossain", "Islam", "Khan", "Mia",
  "Rahman", "Sarker", "Sheikh", "Sultana", "Talukder", "Uddin", "Karim", "Noor",
] as const;

export interface BotInput {
  name: string;
  avatar: string;
  winRate: number;
  useGlobalWinRate: boolean;
  actionDelayMinMs: number;
  actionDelayMaxMs: number;
  isActive: boolean;
}

async function createBotUser(
  transaction: DatabaseTransaction,
  name: string,
  avatar: string,
) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const gameId = String(randomInt(10_000, 100_000));
    const referCode = `BOT${gameId}`;
    const [existing] = await transaction
      .select({ id: users.id })
      .from(users)
      .where(eq(users.gameId, gameId))
      .limit(1);
    if (existing) continue;
    const [user] = await transaction
      .insert(users)
      .values({
        gameId,
        referCode,
        name,
        avatar,
        isBot: true,
      })
      .returning();
    return user!;
  }
  throw new AppError(
    503,
    "BOT_ID_UNAVAILABLE",
    "Could not allocate a bot Game ID.",
  );
}

export async function ensureBotIdentities(): Promise<void> {
  const orphaned = await db.query.botPlayers.findMany({
    where: sql`${botPlayers.userId} is null`,
    orderBy: [asc(botPlayers.createdAt)],
  });
  for (const bot of orphaned) {
    await db.transaction(async (transaction) => {
      const [current] = await transaction
        .select()
        .from(botPlayers)
        .where(eq(botPlayers.id, bot.id))
        .for("update");
      if (!current || current.userId) return;
      const user = await createBotUser(
        transaction,
        current.name,
        current.avatar,
      );
      await transaction
        .update(botPlayers)
        .set({ userId: user.id, updatedAt: new Date() })
        .where(eq(botPlayers.id, current.id));
    });
  }
}

export async function ensureShowcaseBotPool(minimum: number): Promise<void> {
  const target = Math.max(0, Math.min(320, Math.floor(minimum)));
  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext('prizejito-showcase-bot-pool'))`,
    );
    const [{ total = 0 } = { total: 0 }] = await transaction
      .select({ total: count() })
      .from(botPlayers)
      .where(
        and(
          eq(botPlayers.isActive, true),
          sql`${botPlayers.userId} is not null`,
        ),
      );
    let remaining = Math.max(0, target - Number(total));
    if (remaining === 0) return;

    const existing = await transaction
      .select({ name: botPlayers.name })
      .from(botPlayers);
    const names = new Set(existing.map((row) => row.name.toLowerCase()));

    for (const firstName of SHOWCASE_FIRST_NAMES) {
      for (const lastName of SHOWCASE_LAST_NAMES) {
        if (remaining === 0) return;
        const name = `${firstName} ${lastName}`;
        if (names.has(name.toLowerCase())) continue;
        const avatarIndex = ((target - remaining) % PRESET_AVATAR_COUNT) + 1;
        const avatar = presetAvatarPath(avatarIndex);
        const user = await createBotUser(transaction, name, avatar);
        await transaction.insert(botPlayers).values({
          userId: user.id,
          name,
          avatar,
          winRate: 65 + ((target - remaining) % 11),
          useGlobalWinRate: true,
          actionDelayMinMs: 700,
          actionDelayMaxMs: 1800,
          isActive: true,
        });
        names.add(name.toLowerCase());
        remaining -= 1;
      }
    }
  });
}

export async function getBotSettings() {
  const values = await getSettings(BOT_SETTING_KEYS);
  return {
    enabled: values["bots.enabled"] === "true",
    globalWinRate: Number(values["bots.global_win_rate"] || 70),
    actionDelayMinMs: Number(values["bots.action_delay_min_ms"] || 900),
    actionDelayMaxMs: Number(values["bots.action_delay_max_ms"] || 2200),
  };
}

export async function listBots() {
  const global = await getBotSettings();
  const rows = await db
    .select({
      bot: botPlayers,
      gameId: users.gameId,
    })
    .from(botPlayers)
    .leftJoin(users, eq(botPlayers.userId, users.id))
    .orderBy(asc(botPlayers.createdAt));
  return rows.map(({ bot, gameId }) => ({
    ...bot,
    gameId,
    effectiveWinRate: bot.useGlobalWinRate
      ? global.globalWinRate
      : bot.winRate,
  }));
}

export async function getBotAdminSnapshot() {
  const [botSettings, bots] = await Promise.all([
    getBotSettings(),
    listBots(),
  ]);
  return { settings: botSettings, bots };
}

export async function updateBotSettings(input: {
  enabled: boolean;
  globalWinRate: number;
  actionDelayMinMs: number;
  actionDelayMaxMs: number;
  actorId: string;
  ipAddress: string;
  io?: Server;
}) {
  await updateSettingsWithAudit({
    values: {
      "bots.enabled": String(input.enabled),
      "bots.global_win_rate": String(input.globalWinRate),
      "bots.action_delay_min_ms": String(input.actionDelayMinMs),
      "bots.action_delay_max_ms": String(input.actionDelayMaxMs),
    },
    actorId: input.actorId,
    ipAddress: input.ipAddress,
    action: "bots.settings.update",
    targetType: "bot_settings",
  });
  const snapshot = await getBotAdminSnapshot();
  input.io?.emit("bot:update", {
    reason: "settings_updated",
    at: new Date().toISOString(),
  });
  return snapshot;
}

export async function createBot(input: {
  bot: BotInput;
  actorId: string;
  ipAddress: string;
  io?: Server;
}) {
  const bot = await db.transaction(async (transaction) => {
    const user = await createBotUser(
      transaction,
      input.bot.name,
      input.bot.avatar,
    );
    const [created] = await transaction
      .insert(botPlayers)
      .values({
        userId: user.id,
        name: input.bot.name,
        avatar: input.bot.avatar,
        winRate: input.bot.winRate,
        useGlobalWinRate: input.bot.useGlobalWinRate,
        actionDelayMinMs: input.bot.actionDelayMinMs,
        actionDelayMaxMs: input.bot.actionDelayMaxMs,
        isActive: input.bot.isActive,
      })
      .returning();
    await transaction.insert(adminAuditLogs).values({
      actorId: input.actorId,
      action: "bot.create",
      targetType: "bot_player",
      targetId: created!.id,
      ipAddress: input.ipAddress,
      details: {
        name: created!.name,
        gameId: user.gameId,
        useGlobalWinRate: created!.useGlobalWinRate,
      },
    });
    return { ...created!, gameId: user.gameId };
  });
  input.io?.emit("bot:update", {
    reason: "created",
    botId: bot.id,
    at: new Date().toISOString(),
  });
  return bot;
}

export async function updateBot(input: {
  botId: string;
  bot: BotInput;
  actorId: string;
  ipAddress: string;
  io?: Server;
}) {
  const bot = await db.transaction(async (transaction) => {
    const [current] = await transaction
      .select()
      .from(botPlayers)
      .where(eq(botPlayers.id, input.botId))
      .for("update");
    if (!current) {
      throw new AppError(404, "BOT_NOT_FOUND", "Bot player not found.");
    }
    const [updated] = await transaction
      .update(botPlayers)
      .set({
        name: input.bot.name,
        avatar: input.bot.avatar,
        winRate: input.bot.winRate,
        useGlobalWinRate: input.bot.useGlobalWinRate,
        actionDelayMinMs: input.bot.actionDelayMinMs,
        actionDelayMaxMs: input.bot.actionDelayMaxMs,
        isActive: input.bot.isActive,
        updatedAt: new Date(),
      })
      .where(eq(botPlayers.id, input.botId))
      .returning();
    if (current.userId) {
      await transaction
        .update(users)
        .set({
          name: input.bot.name,
          avatar: input.bot.avatar,
          updatedAt: new Date(),
        })
        .where(eq(users.id, current.userId));
    }
    await transaction.insert(adminAuditLogs).values({
      actorId: input.actorId,
      action: "bot.update",
      targetType: "bot_player",
      targetId: input.botId,
      ipAddress: input.ipAddress,
      details: {
        isActive: input.bot.isActive,
        useGlobalWinRate: input.bot.useGlobalWinRate,
        winRate: input.bot.winRate,
      },
    });
    return updated!;
  });
  input.io?.emit("bot:update", {
    reason: "updated",
    botId: bot.id,
    at: new Date().toISOString(),
  });
  return bot;
}

export async function deleteBot(input: {
  botId: string;
  actorId: string;
  ipAddress: string;
  io?: Server;
}) {
  const result = await db.transaction(async (transaction) => {
    const [bot] = await transaction
      .select()
      .from(botPlayers)
      .where(eq(botPlayers.id, input.botId))
      .for("update");
    if (!bot) {
      throw new AppError(404, "BOT_NOT_FOUND", "Bot player not found.");
    }
    const [usage] = bot.userId
      ? await transaction
          .select({ count: count() })
          .from(tournamentEntries)
          .where(eq(tournamentEntries.userId, bot.userId))
      : [{ count: 0 }];
    const archived = Number(usage?.count ?? 0) > 0;
    if (archived) {
      await transaction
        .update(botPlayers)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(botPlayers.id, bot.id));
    } else if (bot.userId) {
      await transaction.delete(users).where(eq(users.id, bot.userId));
    } else {
      await transaction.delete(botPlayers).where(eq(botPlayers.id, bot.id));
    }
    await transaction.insert(adminAuditLogs).values({
      actorId: input.actorId,
      action: archived ? "bot.archive" : "bot.delete",
      targetType: "bot_player",
      targetId: bot.id,
      ipAddress: input.ipAddress,
      details: { name: bot.name },
    });
    return { botId: bot.id, archived };
  });
  input.io?.emit("bot:update", {
    reason: result.archived ? "archived" : "deleted",
    botId: result.botId,
    at: new Date().toISOString(),
  });
  return result;
}

export async function fillTournamentBotsInTransaction(
  transaction: DatabaseTransaction,
  tournament: typeof tournaments.$inferSelect,
  now: Date,
  requestedSlots?: number,
) {
  if (tournament.playerType === "real") {
    return { addedUserIds: [], joinedCount: 0, full: false };
  }
  const [enabledSetting] = await transaction
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, "bots.enabled"))
    .limit(1);
  if (enabledSetting?.value === "false") {
    return { addedUserIds: [], joinedCount: 0, full: false };
  }
  const joined = await transaction
    .select({ userId: tournamentEntries.userId })
    .from(tournamentEntries)
    .where(
      and(
        eq(tournamentEntries.tournamentId, tournament.id),
        eq(tournamentEntries.status, "joined"),
      ),
    )
    .for("update");
  const capacity = Math.max(0, tournament.playerCount - joined.length);
  const slots = Math.min(capacity, requestedSlots ?? capacity);
  if (slots === 0) {
    return {
      addedUserIds: [],
      joinedCount: joined.length,
      full: joined.length === tournament.playerCount,
    };
  }
  const candidates = await transaction
    .select({ bot: botPlayers, userId: users.id })
    .from(botPlayers)
    .innerJoin(users, eq(botPlayers.userId, users.id))
    .where(
      and(
        eq(botPlayers.isActive, true),
        eq(users.isBot, true),
      ),
    )
    .orderBy(asc(botPlayers.createdAt))
    .for("update");
  const candidateIds = candidates.map((row) => row.userId);
  const occupied =
    candidateIds.length === 0
      ? []
      : await transaction
          .select({ userId: tournamentEntries.userId })
          .from(tournamentEntries)
          .innerJoin(
            tournaments,
            eq(tournamentEntries.tournamentId, tournaments.id),
          )
          .where(
            and(
              inArray(tournamentEntries.userId, candidateIds),
              eq(tournamentEntries.status, "joined"),
              inArray(tournaments.status, ["waiting", "active"]),
              ne(tournaments.id, tournament.id),
            ),
          );
  const unavailable = new Set([
    ...joined.map((entry) => entry.userId),
    ...occupied.map((entry) => entry.userId),
  ]);
  const selected = candidates
    .filter((candidate) => !unavailable.has(candidate.userId))
    .slice(0, slots);
  if (selected.length > 0) {
    await transaction
      .insert(tournamentEntries)
      .values(
        selected.map((candidate) => ({
          tournamentId: tournament.id,
          userId: candidate.userId,
          status: "joined" as const,
          joinedAt: now,
          paidAmount: "0",
        })),
      )
      .onConflictDoUpdate({
        target: [
          tournamentEntries.tournamentId,
          tournamentEntries.userId,
        ],
        set: {
          status: "joined",
          joinedAt: now,
          leftAt: null,
          paidAmount: "0",
          updatedAt: now,
        },
      });
  }
  const joinedCount = joined.length + selected.length;
  const full = joinedCount === tournament.playerCount;
  const mixedAutoLobby =
    tournament.recurringTemplateKey === "mixed-auto-16p-4p" &&
    tournament.playerType === "mixed";
  if (full && !mixedAutoLobby) {
    const accelerated = new Date(now.getTime() + 30_000);
    await transaction
      .update(tournaments)
      .set({
        countdownEndsAt:
          tournament.countdownEndsAt &&
          tournament.countdownEndsAt < accelerated
            ? tournament.countdownEndsAt
            : accelerated,
        updatedAt: now,
      })
      .where(eq(tournaments.id, tournament.id));
  }
  return {
    addedUserIds: selected.map((candidate) => candidate.userId),
    joinedCount,
    full,
  };
}

export async function fillTournamentBots(input: {
  tournamentId: string;
  requestedSlots?: number;
  actorId?: string;
  ipAddress?: string;
}) {
  return db.transaction(async (transaction) => {
    const [tournament] = await transaction
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, input.tournamentId))
      .for("update");
    if (!tournament) {
      throw new AppError(
        404,
        "TOURNAMENT_NOT_FOUND",
        "Tournament not found.",
      );
    }
    if (tournament.status !== "waiting") {
      throw new AppError(
        409,
        "TOURNAMENT_NOT_WAITING",
        "Bots can only fill a waiting tournament.",
      );
    }
    const result = await fillTournamentBotsInTransaction(
      transaction,
      tournament,
      new Date(),
      input.requestedSlots,
    );
    if (input.actorId && input.ipAddress) {
      await transaction.insert(adminAuditLogs).values({
        actorId: input.actorId,
        action: "tournament.bot_fill",
        targetType: "tournament",
        targetId: tournament.id,
        ipAddress: input.ipAddress,
        details: { added: result.addedUserIds.length },
      });
    }
    return { tournament, ...result };
  });
}
