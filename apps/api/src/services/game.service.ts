import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Server } from "socket.io";
import { db } from "../db/client.js";
import {
  gameMessages,
  gameStates,
  matchPlayers,
  matches,
  tournamentEntries,
  tournaments,
  users,
} from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { withPostgresAdvisoryLock } from "../lib/distributed-lock.js";
import {
  applyDiceRoll,
  applyTokenMove,
  createInitialGame,
  eliminatePlayer,
  getGameModeRules,
  type EliminationReason,
  type GameBoardState,
  type TokenPositions,
} from "./game-engine.js";
import {
  AUTO_HUMAN_MOVE_DELAY_MS,
  AUTO_HUMAN_ROLL_DELAY_MS,
  buildAutoMoveContext,
  pickSmartAutoToken,
} from "./auto-move.service.js";
import { createServerDiceRoll } from "./game-security.service.js";
import {
  emitBalanceUpdate,
  emitTournamentRealtime,
} from "./realtime.service.js";
import { getSettings, updateSettingsWithAudit } from "./settings.service.js";
import { completeMatch } from "./tournament.service.js";

type DatabaseTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

const GAME_SETTING_KEYS = [
  "game.dice_speed",
  "game.token_speed",
  "game.voice_enabled",
  "game.voice_provider",
] as const;

function engineError(error: unknown): never {
  const code = error instanceof Error ? error.message : "GAME_ACTION_FAILED";
  const status = code === "NOT_YOUR_TURN" ? 409 : 400;
  throw new AppError(status, code, code.replaceAll("_", " ").toLowerCase());
}

function parseState(value: unknown): GameBoardState | null {
  if (
    value &&
    typeof value === "object" &&
    "schemaVersion" in value &&
    value.schemaVersion === 1
  ) {
    return value as GameBoardState;
  }
  return null;
}

function parsePositions(value: unknown): TokenPositions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number[]] =>
        Array.isArray(entry[1]) &&
        entry[1].every((position) => Number.isInteger(position)),
    ),
  );
}

async function lockGame(
  transaction: DatabaseTransaction,
  matchId: string,
) {
  const [match] = await transaction
    .select()
    .from(matches)
    .where(eq(matches.id, matchId))
    .for("update");
  if (!match) throw new AppError(404, "MATCH_NOT_FOUND", "Match not found.");
  const [tournament] = await transaction
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, match.tournamentId))
    .for("update");
  if (!tournament) {
    throw new AppError(404, "TOURNAMENT_NOT_FOUND", "Tournament not found.");
  }
  const players = await transaction
    .select()
    .from(matchPlayers)
    .where(eq(matchPlayers.matchId, matchId))
    .orderBy(asc(matchPlayers.seat))
    .for("update");
  let [stateRow] = await transaction
    .select()
    .from(gameStates)
    .where(eq(gameStates.matchId, matchId))
    .for("update");
  if (!stateRow) {
    [stateRow] = await transaction
      .insert(gameStates)
      .values({ matchId, boardState: {}, tokenPositions: {} })
      .returning();
  }
  let state = parseState(stateRow!.boardState);
  let tokenPositions = parsePositions(stateRow!.tokenPositions);
  if (!state) {
    const activeIds = players
      .filter((player) => !player.isEliminated && !player.hasLeft)
      .map((player) => player.userId);
    const initial = createInitialGame(
      activeIds,
      tournament.boardType,
      tournament.gameMode,
      match.startedAt ?? new Date(),
    );
    state =
      match.status === "active"
        ? initial.state
        : {
            ...initial.state,
            phase: "ready",
          };
    tokenPositions = initial.tokenPositions;
    [stateRow] = await transaction
      .update(gameStates)
      .set({
        boardState: state,
        tokenPositions,
        currentTurn: match.status === "active" ? activeIds[0] ?? null : null,
        diceValue: null,
        stateVersion: sql`${gameStates.stateVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(gameStates.id, stateRow!.id))
      .returning();
  }
  return {
    match,
    tournament,
    players,
    stateRow: stateRow!,
    state,
    tokenPositions,
  };
}

async function writeGameState(
  transaction: DatabaseTransaction,
  stateId: string,
  state: GameBoardState,
  positions: TokenPositions,
  currentTurn: string | null,
  diceValue: number | null,
  now: Date,
) {
  await transaction
    .update(gameStates)
    .set({
      boardState: state,
      tokenPositions: positions,
      currentTurn,
      diceValue,
      stateVersion: sql`${gameStates.stateVersion} + 1`,
      updatedAt: now,
    })
    .where(eq(gameStates.id, stateId));
}

async function finalizeGame(
  matchId: string,
  state: GameBoardState,
): Promise<void> {
  if (state.phase !== "completed" || state.placements.length === 0) return;
  const context = await db
    .select({
      match: matches,
      tournament: tournaments,
      participantCount: sql<number>`count(${matchPlayers.userId})::int`,
    })
    .from(matches)
    .innerJoin(tournaments, eq(matches.tournamentId, tournaments.id))
    .leftJoin(matchPlayers, eq(matchPlayers.matchId, matches.id))
    .where(eq(matches.id, matchId))
    .groupBy(matches.id, tournaments.id)
    .then((rows) => rows[0]);
  const allowPartialPlacements = !(
    context &&
    context.tournament.boardType === "4p" &&
    Number(context.participantCount) >= 4
  );
  try {
    await completeMatch({
      matchId,
      placements: state.placements,
      allowPartialPlacements,
    });
  } catch (error) {
    if (
      error instanceof AppError &&
      (error.code === "MATCH_ALREADY_COMPLETED" ||
        error.code === "TOURNAMENT_NOT_ACTIVE")
    ) {
      return;
    }
    throw error;
  }
}

export async function getGameSettings() {
  const values = await getSettings(GAME_SETTING_KEYS);
  return {
    diceSpeed: values["game.dice_speed"] ?? "normal",
    tokenSpeed: values["game.token_speed"] ?? "normal",
    voiceEnabled: values["game.voice_enabled"] === "true",
    voiceProvider: values["game.voice_provider"] ?? "jitsi",
  };
}

export async function updateGameSettings(input: {
  diceSpeed: "fast" | "normal" | "slow";
  tokenSpeed: "fast" | "normal" | "slow";
  voiceEnabled: boolean;
  voiceProvider: "jitsi";
  actorId: string;
  ipAddress: string;
}) {
  await updateSettingsWithAudit({
    values: {
      "game.dice_speed": input.diceSpeed,
      "game.token_speed": input.tokenSpeed,
      "game.voice_enabled": String(input.voiceEnabled),
      "game.voice_provider": input.voiceProvider,
    },
    actorId: input.actorId,
    ipAddress: input.ipAddress,
    action: "game.settings.update",
    targetType: "game_settings",
  });
  return getGameSettings();
}

export async function getGameRoom(matchId: string, userId?: string) {
  await db.transaction(async (transaction) => {
    await lockGame(transaction, matchId);
  });
  const [matchRow, players, stateRow, messages, settings] = await Promise.all([
    db
      .select({ match: matches, tournament: tournaments })
      .from(matches)
      .innerJoin(tournaments, eq(matches.tournamentId, tournaments.id))
      .where(eq(matches.id, matchId))
      .then((rows) => rows[0]),
    db
      .select({
        participant: matchPlayers,
        user: {
          id: users.id,
          gameId: users.gameId,
          name: users.name,
          avatar: users.avatar,
          isBot: users.isBot,
        },
      })
      .from(matchPlayers)
      .innerJoin(users, eq(matchPlayers.userId, users.id))
      .where(eq(matchPlayers.matchId, matchId))
      .orderBy(asc(matchPlayers.seat)),
    db.query.gameStates.findFirst({ where: eq(gameStates.matchId, matchId) }),
    db
      .select({
        id: gameMessages.id,
        kind: gameMessages.kind,
        content: gameMessages.content,
        createdAt: gameMessages.createdAt,
        user: {
          id: users.id,
          name: users.name,
          avatar: users.avatar,
        },
      })
      .from(gameMessages)
      .leftJoin(users, eq(gameMessages.userId, users.id))
      .where(eq(gameMessages.matchId, matchId))
      .orderBy(asc(gameMessages.createdAt))
      .limit(50),
    getGameSettings(),
  ]);
  if (!matchRow || !stateRow) {
    throw new AppError(404, "MATCH_NOT_FOUND", "Match not found.");
  }
  const ownPlayer = players.find((player) => player.user.id === userId);
  const state = parseState(stateRow.boardState);
  const role =
    ownPlayer &&
    !ownPlayer.participant.hasLeft &&
    (matchRow.match.status === "completed" ||
      (matchRow.match.status === "active" &&
        !ownPlayer.participant.isEliminated))
      ? "player"
      : "spectator";
  return {
    match: matchRow.match,
    tournament: matchRow.tournament,
    players,
    state: {
      ...stateRow,
      boardState: state ?? stateRow.boardState,
      tokenPositions: parsePositions(stateRow.tokenPositions),
    },
    messages,
    role,
    rules: getGameModeRules(matchRow.tournament.gameMode),
    settings,
    voice:
      settings.voiceEnabled && settings.voiceProvider === "jitsi"
        ? {
            enabled: true,
            provider: "jitsi",
            url: `https://meet.jit.si/prizejito-${matchId.replaceAll("-", "")}`,
          }
        : { enabled: false, provider: settings.voiceProvider, url: null },
    serverTime: new Date(),
  };
}

export async function rollGameDice(matchId: string, userId: string) {
  const result = await db.transaction(async (transaction) => {
    const locked = await lockGame(transaction, matchId);
    if (
      locked.match.status !== "active" ||
      !locked.state ||
      !locked.stateRow.currentTurn
    ) {
      throw new AppError(409, "GAME_NOT_ACTIVE", "Game is not active.");
    }
    const player = locked.players.find((item) => item.userId === userId);
    if (!player || player.isEliminated || player.hasLeft) {
      throw new AppError(403, "ACTIVE_PLAYER_REQUIRED", "You are spectating.");
    }
    if (player.reconnectDeadline) {
      throw new AppError(409, "PLAYER_DISCONNECTED", "Reconnect first.");
    }
    const dice = createServerDiceRoll();
    try {
      const rolled = applyDiceRoll(
        locked.state,
        locked.tokenPositions,
        locked.stateRow.currentTurn,
        userId,
        dice,
      );
      await writeGameState(
        transaction,
        locked.stateRow.id,
        rolled.state,
        locked.tokenPositions,
        rolled.currentTurn,
        dice,
        new Date(),
      );
      await transaction
        .update(matchPlayers)
        .set({ lastSeenAt: new Date(), missCount: 0 })
        .where(
          and(
            eq(matchPlayers.matchId, matchId),
            eq(matchPlayers.userId, userId),
          ),
        );
      return { dice, tokenPositions: locked.tokenPositions, ...rolled };
    } catch (error) {
      engineError(error);
    }
  });
  return result;
}

export async function moveGameToken(
  matchId: string,
  userId: string,
  tokenIndex: number,
) {
  const result = await db.transaction(async (transaction) => {
    const locked = await lockGame(transaction, matchId);
    if (
      locked.match.status !== "active" ||
      !locked.state ||
      !locked.stateRow.currentTurn
    ) {
      throw new AppError(409, "GAME_NOT_ACTIVE", "Game is not active.");
    }
    const player = locked.players.find((item) => item.userId === userId);
    if (!player || player.isEliminated || player.hasLeft) {
      throw new AppError(403, "ACTIVE_PLAYER_REQUIRED", "You are spectating.");
    }
    if (player.reconnectDeadline) {
      throw new AppError(409, "PLAYER_DISCONNECTED", "Reconnect first.");
    }
    try {
      const moved = applyTokenMove(
        locked.state,
        locked.tokenPositions,
        locked.stateRow.currentTurn,
        userId,
        tokenIndex,
      );
      await writeGameState(
        transaction,
        locked.stateRow.id,
        moved.state,
        moved.tokenPositions,
        moved.currentTurn,
        null,
        new Date(),
      );
      await transaction
        .update(matchPlayers)
        .set({ lastSeenAt: new Date(), missCount: 0 })
        .where(
          and(
            eq(matchPlayers.matchId, matchId),
            eq(matchPlayers.userId, userId),
          ),
        );
      return moved;
    } catch (error) {
      engineError(error);
    }
  });
  await finalizeGame(matchId, result.state);
  return result;
}

export async function resumeManualGamePlay(matchId: string, userId: string) {
  return db.transaction(async (transaction) => {
    const locked = await lockGame(transaction, matchId);
    const player = locked.players.find((item) => item.userId === userId);
    if (!player || player.isEliminated || player.hasLeft) {
      throw new AppError(403, "ACTIVE_PLAYER_REQUIRED", "You are spectating.");
    }
    if (player.missCount <= 0) {
      return { missCount: 0, resumed: false };
    }
    await transaction
      .update(matchPlayers)
      .set({ missCount: 0, lastSeenAt: new Date() })
      .where(
        and(
          eq(matchPlayers.matchId, matchId),
          eq(matchPlayers.userId, userId),
        ),
      );
    return { missCount: 0, resumed: true };
  });
}

async function eliminateGamePlayer(
  matchId: string,
  userId: string,
  reason: EliminationReason,
  reconnectDeadlineAtOrBefore?: Date,
) {
  const result = await db.transaction(async (transaction) => {
    const locked = await lockGame(transaction, matchId);
    if (!locked.state) {
      throw new AppError(409, "GAME_NOT_ACTIVE", "Game is not active.");
    }
    const player = locked.players.find((item) => item.userId === userId);
    if (!player) {
      throw new AppError(403, "MATCH_PLAYER_REQUIRED", "Not a match player.");
    }
    if (
      player.isEliminated ||
      player.hasLeft ||
      locked.state.finishOrder.includes(userId)
    ) {
      throw new AppError(
        409,
        "PLAYER_ALREADY_INACTIVE",
        "This player is no longer active in the match.",
      );
    }
    if (
      reason === "reconnect" &&
      reconnectDeadlineAtOrBefore &&
      (!player.reconnectDeadline ||
        player.reconnectDeadline > reconnectDeadlineAtOrBefore)
    ) {
      throw new AppError(
        409,
        "RECONNECT_RECOVERED",
        "The player reconnected before elimination.",
      );
    }
    const eliminated = eliminatePlayer(
      locked.state,
      locked.tokenPositions,
      locked.stateRow.currentTurn,
      userId,
      reason,
    );
    await transaction
      .update(matchPlayers)
      .set({
        isEliminated: true,
        hasLeft: reason === "leave" ? true : player.hasLeft,
        reconnectDeadline: null,
        disconnectedAt: reason === "reconnect" ? player.disconnectedAt : null,
      })
      .where(
        and(
          eq(matchPlayers.matchId, matchId),
          eq(matchPlayers.userId, userId),
        ),
      );
    await transaction
      .update(tournamentEntries)
      .set({ status: "eliminated", updatedAt: new Date() })
      .where(
        and(
          eq(tournamentEntries.tournamentId, locked.tournament.id),
          eq(tournamentEntries.userId, userId),
          eq(tournamentEntries.status, "joined"),
        ),
      );
    await writeGameState(
      transaction,
      locked.stateRow.id,
      eliminated.state,
      eliminated.tokenPositions,
      eliminated.currentTurn,
      null,
      new Date(),
    );
    await transaction.insert(gameMessages).values({
      matchId,
      kind: "system",
      content: `${userId}:${reason}`,
    });
    return eliminated;
  });
  await finalizeGame(matchId, result.state);
  return result;
}

export async function leaveGame(matchId: string, userId: string) {
  await db.transaction(async (transaction) => {
    const locked = await lockGame(transaction, matchId);
    if (
      locked.tournament.status === "waiting" &&
      locked.tournament.countdownEndsAt
    ) {
      throw new AppError(
        409,
        "GAME_LEAVE_LOCKED",
        "কাউন্টডাউন চলাকালীন গেম ছাড়া যাবে না।",
      );
    }
    if (
      locked.tournament.status === "active" &&
      locked.match.status !== "completed" &&
      locked.match.status !== "cancelled"
    ) {
      throw new AppError(
        409,
        "GAME_LEAVE_LOCKED",
        "টুর্নামেন্ট ম্যাচ চলাকালীন গেম ছাড়া যাবে না।",
      );
    }
  });
  return eliminateGamePlayer(matchId, userId, "leave");
}

export async function markGameDisconnected(matchId: string, userId: string) {
  const result = await db.transaction(async (transaction) => {
    const locked = await lockGame(transaction, matchId);
    const player = locked.players.find((item) => item.userId === userId);
    if (
      !player ||
      player.isEliminated ||
      player.hasLeft
    ) {
      return null;
    }
    if (locked.match.status === "waiting") {
      await transaction
        .update(matchPlayers)
        .set({ connectedAt: null, disconnectedAt: new Date(), lastSeenAt: new Date() })
        .where(
          and(
            eq(matchPlayers.matchId, matchId),
            eq(matchPlayers.userId, userId),
          ),
        );
      return { automaticLoss: false, reconnectDeadline: null };
    }
    if (
      locked.match.status !== "active" ||
      !locked.state ||
      player.reconnectDeadline
    ) {
      return null;
    }
    const now = new Date();
    const reconnectCount = player.reconnectCount + 1;
    const reconnectDeadline = new Date(now.getTime() + 60_000);
    await transaction
      .update(matchPlayers)
      .set({
        reconnectCount,
        disconnectedAt: now,
        reconnectDeadline,
        lastSeenAt: now,
      })
      .where(
        and(
          eq(matchPlayers.matchId, matchId),
          eq(matchPlayers.userId, userId),
        ),
      );
    return {
      automaticLoss: false,
      reconnectCount,
      reconnectDeadline,
    };
  });
  return result;
}

export async function markGameConnected(matchId: string, userId: string) {
  const now = new Date();
  return db.transaction(async (transaction) => {
    const [match] = await transaction
      .select({ status: matches.status })
      .from(matches)
      .where(eq(matches.id, matchId))
      .for("update");
    if (!match || (match.status !== "waiting" && match.status !== "active")) {
      return null;
    }
    const [existing] = await transaction
      .select({
        reconnectDeadline: matchPlayers.reconnectDeadline,
        disconnectedAt: matchPlayers.disconnectedAt,
      })
      .from(matchPlayers)
      .where(
        and(
          eq(matchPlayers.matchId, matchId),
          eq(matchPlayers.userId, userId),
          eq(matchPlayers.isEliminated, false),
          eq(matchPlayers.hasLeft, false),
        ),
      );
    const reconnected = Boolean(
      existing?.reconnectDeadline || existing?.disconnectedAt,
    );
    const [player] = await transaction
      .update(matchPlayers)
      .set({
        connectedAt: now,
        lastSeenAt: now,
        disconnectedAt: null,
        reconnectDeadline: null,
      })
      .where(
        and(
          eq(matchPlayers.matchId, matchId),
          eq(matchPlayers.userId, userId),
          eq(matchPlayers.isEliminated, false),
          eq(matchPlayers.hasLeft, false),
        ),
      )
      .returning();
    if (!player) return null;
    return { player, reconnected };
  });
}

export async function heartbeatGame(matchId: string, userId: string) {
  await db
    .update(matchPlayers)
    .set({ lastSeenAt: new Date() })
    .where(
      and(
        eq(matchPlayers.matchId, matchId),
        eq(matchPlayers.userId, userId),
      ),
    );
}

export async function addGameMessage(input: {
  matchId: string;
  userId: string;
  kind: "chat" | "emoji";
  content: string;
}) {
  const player = await db.query.matchPlayers.findFirst({
    where: and(
      eq(matchPlayers.matchId, input.matchId),
      eq(matchPlayers.userId, input.userId),
      eq(matchPlayers.isEliminated, false),
      eq(matchPlayers.hasLeft, false),
    ),
  });
  if (!player) {
    throw new AppError(403, "ACTIVE_PLAYER_REQUIRED", "Spectators cannot chat.");
  }
  const [message] = await db
    .insert(gameMessages)
    .values({
      matchId: input.matchId,
      userId: input.userId,
      kind: input.kind,
      content: input.content,
    })
    .returning();
  const user = await db.query.users.findFirst({
    where: eq(users.id, input.userId),
    columns: { id: true, name: true, avatar: true },
  });
  return { ...message!, user: user ?? null };
}

async function processTurnTimeout(matchId: string, now: Date) {
  const result = await db.transaction(async (transaction) => {
    const locked = await lockGame(transaction, matchId);
    if (
      !locked.state ||
      locked.match.status !== "active" ||
      !locked.stateRow.currentTurn ||
      new Date(locked.state.turnDeadline) > now
    ) {
      return null;
    }
    const player = locked.players.find(
      (item) => item.userId === locked.stateRow.currentTurn,
    );
    if (!player || player.isEliminated || player.hasLeft) return null;
    const isReconnecting = Boolean(player.reconnectDeadline);
    const autoPlayEnabled = player.missCount > 0 || !isReconnecting;
    const nextMissCount =
      player.missCount > 0 || isReconnecting ? player.missCount : 1;

    let state = locked.state;
    let positions = locked.tokenPositions;
    let currentTurn: string | null = locked.stateRow.currentTurn;
    let autoDice: number | null = null;
    let autoTokenIndex: number | null = null;

    if (!state.roll) {
      autoDice = createServerDiceRoll();
      const rolled = applyDiceRoll(
        state,
        positions,
        currentTurn!,
        player.userId,
        autoDice,
        now,
      );
      state = rolled.state;
      currentTurn = rolled.currentTurn;
    }

    if (currentTurn === player.userId && state.roll) {
      const context = buildAutoMoveContext(
        locked.tournament.boardType,
        state,
        positions,
        player.userId,
      );
      autoTokenIndex =
        context !== null
          ? pickSmartAutoToken(context)
          : state.roll.legalTokenIndexes[0] ?? null;
      if (autoTokenIndex !== null) {
        const moved = applyTokenMove(
          state,
          positions,
          currentTurn,
          player.userId,
          autoTokenIndex,
          now,
        );
        state = moved.state;
        positions = moved.tokenPositions;
        currentTurn = moved.currentTurn;
      }
    }

    const timedOut = {
      state,
      tokenPositions: positions,
      currentTurn,
      missCount: nextMissCount,
      eliminated: false,
      autoPlayEnabled,
    };
    await transaction
      .update(matchPlayers)
      .set({
        missCount: timedOut.missCount,
        isEliminated: timedOut.eliminated,
      })
      .where(
        and(
          eq(matchPlayers.matchId, matchId),
          eq(matchPlayers.userId, player.userId),
        ),
      );
    await writeGameState(
      transaction,
      locked.stateRow.id,
      timedOut.state,
      timedOut.tokenPositions,
      timedOut.currentTurn,
      null,
      now,
    );
    return {
      ...timedOut,
      userId: player.userId,
      autoDice,
      autoTokenIndex,
    };
  });
  if (result) await finalizeGame(matchId, result.state);
  return result;
}

async function processProactiveAutoPlay(matchId: string, now: Date) {
  const result = await db.transaction(async (transaction) => {
    const locked = await lockGame(transaction, matchId);
    if (
      !locked.state ||
      locked.match.status !== "active" ||
      locked.state.phase !== "active" ||
      !locked.stateRow.currentTurn
    ) {
      return null;
    }
    const player = locked.players.find(
      (item) => item.userId === locked.stateRow.currentTurn,
    );
    if (
      !player ||
      player.isEliminated ||
      player.hasLeft ||
      player.missCount <= 0 ||
      player.reconnectDeadline
    ) {
      return null;
    }
    const [userRow] = await transaction
      .select({ isBot: users.isBot })
      .from(users)
      .where(eq(users.id, player.userId));
    if (userRow?.isBot) return null;

    const turnStartedAt = new Date(
      locked.state.turnStartedAt ?? locked.state.lastAction.at,
    ).getTime();
    const rollActionAt =
      locked.state.roll?.dice && locked.state.lastAction.type === "roll"
        ? new Date(locked.state.lastAction.at).getTime()
        : null;
    const readyAt = locked.state.roll
      ? (rollActionAt ?? turnStartedAt) + AUTO_HUMAN_MOVE_DELAY_MS
      : turnStartedAt + AUTO_HUMAN_ROLL_DELAY_MS;
    if (now.getTime() < readyAt) return null;
    if (new Date(locked.state.turnDeadline) <= now) return null;

    let state = locked.state;
    let positions = locked.tokenPositions;
    let currentTurn: string | null = locked.stateRow.currentTurn;
    let autoDice: number | null = null;
    let autoTokenIndex: number | null = null;

    if (!state.roll) {
      autoDice = createServerDiceRoll();
      const rolled = applyDiceRoll(
        state,
        positions,
        currentTurn!,
        player.userId,
        autoDice,
        now,
      );
      state = rolled.state;
      currentTurn = rolled.currentTurn;
    }

    if (currentTurn === player.userId && state.roll) {
      const context = buildAutoMoveContext(
        locked.tournament.boardType,
        state,
        positions,
        player.userId,
      );
      autoTokenIndex =
        context !== null
          ? pickSmartAutoToken(context)
          : state.roll.legalTokenIndexes[0] ?? null;
      if (autoTokenIndex !== null) {
        const moved = applyTokenMove(
          state,
          positions,
          currentTurn,
          player.userId,
          autoTokenIndex,
          now,
        );
        state = moved.state;
        positions = moved.tokenPositions;
        currentTurn = moved.currentTurn;
      }
    }

    await writeGameState(
      transaction,
      locked.stateRow.id,
      state,
      positions,
      currentTurn,
      null,
      now,
    );
    return {
      userId: player.userId,
      state,
      currentTurn,
      tokenPositions: positions,
      autoDice,
      autoTokenIndex,
      missCount: player.missCount,
      autoPlayEnabled: true,
      eliminated: false,
    };
  });
  if (result) await finalizeGame(matchId, result.state);
  return result;
}

function emitTurnTimeoutEvents(
  io: Server | undefined,
  matchId: string,
  result: {
    userId: string;
    state: GameBoardState;
    currentTurn: string | null;
    tokenPositions: TokenPositions;
    autoDice: number | null;
    autoTokenIndex: number | null;
    missCount: number;
    eliminated: boolean;
    autoPlayEnabled?: boolean;
  },
  now: Date,
) {
  if (!io) return;
  if (result.autoDice !== null) {
    io.to(`match:${matchId}`).emit("game:dice-roll", {
      matchId,
      userId: result.userId,
      dice: result.autoDice,
      autoPassed: result.autoTokenIndex === null,
      state: result.state,
      currentTurn: result.currentTurn,
      tokenPositions: result.tokenPositions,
      timedOut: true,
      at: now.toISOString(),
    });
  }
  if (result.autoTokenIndex !== null) {
    const action = result.state.lastAction;
    io.to(`match:${matchId}`).emit("game:token-move", {
      matchId,
      userId: result.userId,
      tokenIndex: result.autoTokenIndex,
      killedUserIds: action.killedUserIds ?? [],
      reachedHome: action.type === "home",
      state: result.state,
      currentTurn: result.currentTurn,
      tokenPositions: result.tokenPositions,
      timedOut: true,
      at: now.toISOString(),
    });
  }
  io.to(`match:${matchId}`).emit("game:turn-change", {
    matchId,
    userId: result.currentTurn,
    turnDeadline: result.state.turnDeadline,
    turnStartedAt: result.state.turnStartedAt,
    missedUserId: result.userId,
    missCount: result.missCount,
    eliminated: result.eliminated,
    autoPlayEnabled: result.autoPlayEnabled ?? result.missCount > 0,
    autoDice: result.autoDice,
    autoTokenIndex: result.autoTokenIndex,
    serverTime: now.toISOString(),
    at: now.toISOString(),
  });
  emitGameState(io, matchId);
}

function emitAutoPlayEvents(
  io: Server | undefined,
  matchId: string,
  result: {
    userId: string;
    state: GameBoardState;
    currentTurn: string | null;
    tokenPositions: TokenPositions;
    autoDice: number | null;
    autoTokenIndex: number | null;
    missCount: number;
    autoPlayEnabled: boolean;
    eliminated: boolean;
  },
  now: Date,
) {
  if (!io) return;
  if (result.autoDice !== null) {
    io.to(`match:${matchId}`).emit("game:dice-roll", {
      matchId,
      userId: result.userId,
      dice: result.autoDice,
      autoPassed: result.autoTokenIndex === null,
      state: result.state,
      currentTurn: result.currentTurn,
      tokenPositions: result.tokenPositions,
      autoPlay: true,
      at: now.toISOString(),
    });
  }
  if (result.autoTokenIndex !== null) {
    const action = result.state.lastAction;
    io.to(`match:${matchId}`).emit("game:token-move", {
      matchId,
      userId: result.userId,
      tokenIndex: result.autoTokenIndex,
      killedUserIds: action.killedUserIds ?? [],
      reachedHome: action.type === "home",
      state: result.state,
      currentTurn: result.currentTurn,
      tokenPositions: result.tokenPositions,
      autoPlay: true,
      at: now.toISOString(),
    });
  }
  io.to(`match:${matchId}`).emit("game:turn-change", {
    matchId,
    userId: result.currentTurn,
    turnDeadline: result.state.turnDeadline,
    turnStartedAt: result.state.turnStartedAt,
    autoPlayEnabled: result.autoPlayEnabled,
    autoDice: result.autoDice,
    autoTokenIndex: result.autoTokenIndex,
    serverTime: now.toISOString(),
    at: now.toISOString(),
  });
  emitGameState(io, matchId);
}

export async function processGameTick(io?: Server, now = new Date()) {
  const reconnectRows = await db
    .select({
      matchId: matchPlayers.matchId,
      userId: matchPlayers.userId,
    })
    .from(matchPlayers)
    .innerJoin(matches, eq(matchPlayers.matchId, matches.id))
    .where(
      and(
        eq(matches.status, "active"),
        eq(matchPlayers.isEliminated, false),
        lte(matchPlayers.reconnectDeadline, now),
      ),
    );
  const changedMatches = new Set<string>();
  for (const row of reconnectRows) {
    let result;
    try {
      result = await eliminateGamePlayer(
        row.matchId,
        row.userId,
        "reconnect",
        now,
      );
    } catch (error) {
      if (error instanceof AppError && error.code === "RECONNECT_RECOVERED") {
        continue;
      }
      throw error;
    }
    changedMatches.add(row.matchId);
    io?.to(`match:${row.matchId}`).emit("game:reconnect-fail", {
      matchId: row.matchId,
      userId: row.userId,
      at: now.toISOString(),
    });
    io?.to(`match:${row.matchId}`).emit("game:turn-change", {
      matchId: row.matchId,
      userId: result.currentTurn,
      turnDeadline: result.state.turnDeadline,
      turnStartedAt: result.state.turnStartedAt,
      serverTime: now.toISOString(),
      at: now.toISOString(),
    });
    await emitCompletedGame(io, row.matchId, result.state);
  }

  const activeStates = await db
    .select({
      matchId: matches.id,
      boardState: gameStates.boardState,
    })
    .from(matches)
    .innerJoin(gameStates, eq(matches.id, gameStates.matchId))
    .where(eq(matches.status, "active"));
  for (const row of activeStates) {
    const state = parseState(row.boardState);
    if (!state) continue;
    if (state.phase === "completed") {
      await finalizeGame(row.matchId, state);
      changedMatches.add(row.matchId);
      await emitCompletedGame(io, row.matchId, state);
      continue;
    }
    const proactive = await processProactiveAutoPlay(row.matchId, now);
    if (proactive) {
      changedMatches.add(row.matchId);
      emitAutoPlayEvents(io, row.matchId, proactive, now);
      await emitCompletedGame(io, row.matchId, proactive.state);
      continue;
    }
    if (new Date(state.turnDeadline) > now) continue;
    const result = await processTurnTimeout(row.matchId, now);
    if (result) {
      changedMatches.add(row.matchId);
      emitTurnTimeoutEvents(io, row.matchId, result, now);
      await emitCompletedGame(io, row.matchId, result.state);
    }
  }
  for (const matchId of changedMatches) {
    io?.to(`match:${matchId}`).emit("game:state", {
      matchId,
      at: now.toISOString(),
    });
  }
  return { changedMatchIds: [...changedMatches] };
}

async function emitCompletedGame(
  io: Server | undefined,
  matchId: string,
  state: GameBoardState,
) {
  if (!io || state.phase !== "completed") return;
  const room = await getGameRoom(matchId);
  io.to(`match:${matchId}`).emit("game:over", {
    matchId,
    placements: state.placements,
    tournamentId: room.tournament.id,
    prizeDistributed: room.tournament.status === "completed",
    at: new Date().toISOString(),
  });
  await emitTournamentRealtime(io, {
    tournamentId: room.tournament.id,
    reason: "game_completed",
  });
  if (room.tournament.nextRoundAt) {
    await emitTournamentRealtime(io, {
      tournamentId: room.tournament.id,
      reason: "next_round_countdown",
    });
  }
  for (const player of room.players) {
    emitBalanceUpdate(io, player.user.id, {
      reason: "game_completed",
      tournamentId: room.tournament.id,
    });
  }
}

export interface GameScheduler {
  stop: () => void;
  tick: () => Promise<void>;
}

export function startGameScheduler(io: Server): GameScheduler {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await withPostgresAdvisoryLock(1_071_001, () => processGameTick(io));
    } catch (error) {
      console.error("Game scheduler tick failed", error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 1_000);
  timer.unref();
  void tick();
  return { stop: () => clearInterval(timer), tick };
}

export function emitGameState(io: Server | undefined, matchId: string) {
  io?.to(`match:${matchId}`).emit("game:state", {
    matchId,
    at: new Date().toISOString(),
  });
}
