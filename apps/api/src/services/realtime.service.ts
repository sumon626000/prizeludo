import { randomUUID } from "node:crypto";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { Server } from "socket.io";
import { db } from "../db/client.js";
import {
  matchPlayers,
  matches,
  notifications,
  tournamentEntries,
  tournaments,
  users,
} from "../db/schema.js";
import {
  getSettings,
  updateSettingsWithAudit,
} from "./settings.service.js";

const realtimeSettingKeys = [
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
] as const;

export function realtimeEnvelope<T>(type: string, payload: T) {
  return {
    eventId: randomUUID(),
    type,
    at: new Date().toISOString(),
    payload,
  };
}

export async function getTournamentRealtimeState(tournamentId: string) {
  const [row] = await db
    .select({
      id: tournaments.id,
      title: tournaments.title,
      playerCount: tournaments.playerCount,
      status: tournaments.status,
      currentRound: tournaments.currentRound,
      totalRounds: tournaments.totalRounds,
      countdownEndsAt: tournaments.countdownEndsAt,
      nextRoundAt: tournaments.nextRoundAt,
      updatedAt: tournaments.updatedAt,
      joinedCount: sql<number>`count(${tournamentEntries.id}) filter (where ${tournamentEntries.status} = 'joined')::int`,
      waitingCount: sql<number>`count(${tournamentEntries.id}) filter (where ${tournamentEntries.status} = 'pre_registered')::int`,
    })
    .from(tournaments)
    .leftJoin(
      tournamentEntries,
      eq(tournamentEntries.tournamentId, tournaments.id),
    )
    .where(eq(tournaments.id, tournamentId))
    .groupBy(tournaments.id);
  return row ?? null;
}

export async function getRealtimeState(userId?: string) {
  const settingValues = await getSettings(realtimeSettingKeys);
  const base = {
    serverTime: new Date().toISOString(),
    maintenance: {
      enabled: settingValues["site.maintenance_enabled"] === "true",
      message:
        settingValues["site.maintenance_message"] ||
        "PrizeJito.com is temporarily under maintenance.",
    },
    theme: {
      siteName: settingValues["site.name"],
      logoUrl: settingValues["site.logo_url"],
      themePreset: settingValues["site.theme_preset"] || "forest",
      primaryColor: settingValues["site.primary_color"] || "#22c55e",
      secondaryColor: settingValues["site.secondary_color"] || "#0b5a31",
      buttonColor: settingValues["site.button_color"] || "#16a34a",
      cardColor: settingValues["site.card_color"] || "#073b22",
      backgroundColor: settingValues["site.background_color"] || "#07100c",
      accentColor: settingValues["site.accent_color"] || "#77f7a8",
    },
  };
  if (!userId) return { ...base, user: null };

  const [user, unreadRows, activeEntries, activeMatches] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: {
        id: true,
        mainBalance: true,
        winnerBalance: true,
      },
    }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.isRead, false),
          or(
            eq(notifications.userId, userId),
            sql`${notifications.userId} is null`,
          ),
        ),
      ),
    db
      .select({ tournamentId: tournamentEntries.tournamentId })
      .from(tournamentEntries)
      .innerJoin(
        tournaments,
        eq(tournamentEntries.tournamentId, tournaments.id),
      )
      .where(
        and(
          eq(tournamentEntries.userId, userId),
          eq(tournamentEntries.status, "joined"),
          inArray(tournaments.status, ["waiting", "active"]),
        ),
      )
      .limit(1),
    db
      .select({ matchId: matchPlayers.matchId })
      .from(matchPlayers)
      .innerJoin(matches, eq(matchPlayers.matchId, matches.id))
      .where(
        and(
          eq(matchPlayers.userId, userId),
          eq(matchPlayers.isEliminated, false),
          eq(matchPlayers.hasLeft, false),
          inArray(matches.status, ["waiting", "active"]),
        ),
      ),
  ]);

  return {
    ...base,
    user: user
      ? {
          id: user.id,
          mainBalance: user.mainBalance,
          winnerBalance: user.winnerBalance,
          unreadNotifications: unreadRows[0]?.count ?? 0,
          activeTournamentId: activeEntries[0]?.tournamentId ?? null,
          activeMatchIds: activeMatches.map((row) => row.matchId),
        }
      : null,
  };
}

export async function emitTournamentRealtime(
  io: Server | undefined,
  input: {
    tournamentId: string;
    reason: string;
    userId?: string;
    player?: {
      id: string;
      name: string;
      avatar: string;
      gameId: string;
    };
  },
) {
  if (!io) return null;
  const snapshot = await getTournamentRealtimeState(input.tournamentId);
  if (!snapshot) return null;
  const payload = realtimeEnvelope("tournament:state", {
    ...snapshot,
    reason: input.reason,
  });
  io.emit("tournament:update", payload.payload);
  io.emit("home:tournament-update", {
    tournamentId: input.tournamentId,
    reason: input.reason,
    at: payload.at,
  });
  io.to(`tournament:${input.tournamentId}`).emit("tournament:state", payload);

  if (
    input.reason === "joined" ||
    input.reason === "auto_joined" ||
    input.reason === "left" ||
    input.reason === "deleted" ||
    input.reason === "registration_opened"
  ) {
    io.emit("tournament:slot-update", payload);
  }
  if (input.reason === "joined" || input.reason === "auto_joined") {
    const joined = realtimeEnvelope("tournament:join", {
      ...snapshot,
      userId: input.userId ?? null,
      player: input.player ?? null,
    });
    io.emit("tournament:join", joined);
    io.to(`tournament:${input.tournamentId}`).emit(
      "lobby:player-waiting",
      joined,
    );
  }
  if (input.reason === "tournament_started") {
    io.emit("tournament:start", payload);
    io.to(`tournament:${input.tournamentId}`).emit(
      "tournament:bracket-update",
      payload,
    );
    io.to(`tournament:${input.tournamentId}`).emit(
      "lobby:round-start",
      payload,
    );
  }
  if (
    input.reason === "match_completed" ||
    input.reason === "game_completed" ||
    input.reason === "no_show_resolved" ||
    input.reason === "round_started"
  ) {
    io.to(`tournament:${input.tournamentId}`).emit(
      "tournament:bracket-update",
      payload,
    );
  }
  if (input.reason === "next_round_countdown") {
    io.to(`tournament:${input.tournamentId}`).emit(
      "tournament:round-start",
      payload,
    );
    io.to(`tournament:${input.tournamentId}`).emit(
      "lobby:next-round-countdown",
      payload,
    );
  }
  if (input.reason === "round_started") {
    io.to(`tournament:${input.tournamentId}`).emit(
      "lobby:round-start",
      payload,
    );
  }
  return payload;
}

export function emitBalanceUpdate(
  io: Server | undefined,
  userId: string,
  payload: Record<string, unknown>,
) {
  if (!io) return;
  const event = realtimeEnvelope("balance:update", payload);
  io.to(`user:${userId}`).emit("balance:update", event);
  io.to(`user:${userId}`).emit("wallet:update", {
    ...payload,
    at: event.at,
  });
}

export function emitNotification(
  io: Server | undefined,
  userId: string,
  payload: Record<string, unknown>,
) {
  if (!io) return;
  io.to(`user:${userId}`).emit(
    "notification:new",
    realtimeEnvelope("notification:new", payload),
  );
}

export async function broadcastAdminNotice(input: {
  io: Server | undefined;
  title: string;
  message: string;
}) {
  const recipients = await db.select({ id: users.id }).from(users);
  if (recipients.length > 0) {
    await db.insert(notifications).values(
      recipients.map((user) => ({
        userId: user.id,
        title: input.title,
        message: input.message,
      })),
    );
  }
  const event = realtimeEnvelope("admin:notice", {
    title: input.title,
    message: input.message,
  });
  input.io?.emit("admin:notice", event);
  input.io?.emit("notification:new", event);
  return { delivered: recipients.length, event };
}

export async function updateMaintenanceMode(input: {
  io: Server | undefined;
  enabled: boolean;
  message: string;
  actorId: string;
  ipAddress: string;
}) {
  await updateSettingsWithAudit({
    values: {
      "site.maintenance_enabled": String(input.enabled),
      "site.maintenance_message": input.message,
    },
    actorId: input.actorId,
    ipAddress: input.ipAddress,
    action: "site.maintenance.update",
    targetType: "site_settings",
  });
  const event = realtimeEnvelope("admin:maintenance", {
    enabled: input.enabled,
    message: input.message,
  });
  input.io?.emit("admin:maintenance", event);
  return event;
}
