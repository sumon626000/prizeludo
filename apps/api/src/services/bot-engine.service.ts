import { randomInt } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Server } from "socket.io";
import { config } from "../config.js";
import { db } from "../db/client.js";
import {
  botPlayers,
  gameStates,
  matches,
} from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { withPostgresAdvisoryLock } from "../lib/distributed-lock.js";
import {
  emitGameState,
  getGameRoom,
  moveGameToken,
  rollGameDice,
} from "./game.service.js";
import {
  emitBalanceUpdate,
  emitTournamentRealtime,
} from "./realtime.service.js";
import { getBotSettings } from "./bot.service.js";
import type {
  GameBoardState,
  TokenPositions,
} from "./game-engine.js";

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

function deterministicDelay(
  botId: string,
  stateVersion: number,
  minimum: number,
  maximum: number,
) {
  const span = Math.max(0, maximum - minimum);
  let hash = stateVersion * 31;
  for (const character of botId) {
    hash = (hash * 33 + character.charCodeAt(0)) >>> 0;
  }
  return minimum + (span === 0 ? 0 : hash % (span + 1));
}

function selectToken(
  state: GameBoardState,
  positions: TokenPositions,
  userId: string,
  skillRate: number,
) {
  const legal = state.roll?.legalTokenIndexes ?? [];
  if (legal.length === 0) return null;
  if (legal.length === 1 || randomInt(1, 101) > skillRate) {
    return legal[randomInt(0, legal.length)] ?? legal[0]!;
  }
  const dice = state.roll?.dice ?? 0;
  return [...legal].sort((left, right) => {
    const leftPosition = positions[userId]?.[left] ?? -1;
    const rightPosition = positions[userId]?.[right] ?? -1;
    const leftScore = (leftPosition < 0 ? 20 : leftPosition) + dice;
    const rightScore = (rightPosition < 0 ? 20 : rightPosition) + dice;
    return rightScore - leftScore;
  })[0]!;
}

async function emitCompletedGame(
  io: Server,
  matchId: string,
  placements: string[],
) {
  const room = await getGameRoom(matchId);
  io.to(`match:${matchId}`).emit("game:over", {
    matchId,
    placements,
    tournamentId: room.tournament.id,
    prizeDistributed: room.tournament.status === "completed",
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
  io.emit("leaderboard:update", {
    reason: "game_completed",
    tournamentId: room.tournament.id,
    at: new Date().toISOString(),
  });
}

export async function processBotTick(io: Server, now = new Date()) {
  const global = await getBotSettings();
  if (!global.enabled) return 0;
  const turns = await db
    .select({
      bot: botPlayers,
      matchId: gameStates.matchId,
      stateVersion: gameStates.stateVersion,
      boardState: gameStates.boardState,
      tokenPositions: gameStates.tokenPositions,
      updatedAt: gameStates.updatedAt,
    })
    .from(gameStates)
    .innerJoin(matches, eq(gameStates.matchId, matches.id))
    .innerJoin(botPlayers, eq(gameStates.currentTurn, botPlayers.userId))
    .where(
      and(
        eq(matches.status, "active"),
        eq(botPlayers.isActive, true),
      ),
    );
  let actions = 0;
  for (const turn of turns) {
    const userId = turn.bot.userId;
    const state = parseState(turn.boardState);
    if (!userId || !state || state.phase !== "active") continue;
    const minimum = turn.bot.actionDelayMinMs || global.actionDelayMinMs;
    const maximum = Math.max(
      minimum,
      turn.bot.actionDelayMaxMs || global.actionDelayMaxMs,
    );
    const delay = deterministicDelay(
      turn.bot.id,
      turn.stateVersion,
      minimum,
      maximum,
    );
    if (now.getTime() - turn.updatedAt.getTime() < delay) continue;
    try {
      if (!state.roll) {
        const result = await rollGameDice(turn.matchId, userId);
        const actionAt = new Date();
        io.to(`match:${turn.matchId}`).emit("game:dice-roll", {
          matchId: turn.matchId,
          userId,
          dice: result.dice,
          autoPassed: result.autoPassed,
          state: result.state,
          currentTurn: result.currentTurn,
          tokenPositions: result.tokenPositions,
          stateVersion: result.stateVersion,
          serverTime: actionAt.toISOString(),
          at: actionAt.toISOString(),
        });
        io.to(`match:${turn.matchId}`).emit("game:turn-change", {
          matchId: turn.matchId,
          userId: result.currentTurn,
          turnDeadline: result.state.turnDeadline,
          turnStartedAt: result.state.turnStartedAt,
          autoPassed: result.autoPassed,
          stateVersion: result.stateVersion,
          serverTime: actionAt.toISOString(),
          at: actionAt.toISOString(),
        });
        actions += 1;
        continue;
      }
      const tokenIndex = selectToken(
        state,
        parsePositions(turn.tokenPositions),
        userId,
        turn.bot.useGlobalWinRate
          ? global.globalWinRate
          : turn.bot.winRate,
      );
      if (tokenIndex === null) continue;
      const result = await moveGameToken(turn.matchId, userId, tokenIndex);
      const actionAt = new Date();
      io.to(`match:${turn.matchId}`).emit("game:token-move", {
        matchId: turn.matchId,
        userId,
        tokenIndex,
        from: result.state.lastAction.from,
        to: result.state.lastAction.to,
        killedUserIds: result.killedUserIds,
        reachedHome: result.reachedHome,
        state: result.state,
        currentTurn: result.currentTurn,
        tokenPositions: result.tokenPositions,
        stateVersion: result.stateVersion,
        serverTime: actionAt.toISOString(),
        at: actionAt.toISOString(),
      });
      io.to(`match:${turn.matchId}`).emit("game:turn-change", {
        matchId: turn.matchId,
        userId: result.currentTurn,
        turnDeadline: result.state.turnDeadline,
        turnStartedAt: result.state.turnStartedAt,
        stateVersion: result.stateVersion,
        serverTime: actionAt.toISOString(),
        at: actionAt.toISOString(),
      });
      if (result.killedUserIds.length > 0) {
        io.to(`match:${turn.matchId}`).emit("game:token-kill", {
          matchId: turn.matchId,
          killedUserIds: result.killedUserIds,
        });
      }
      emitGameState(io, turn.matchId);
      if (result.state.phase === "completed") {
        await emitCompletedGame(
          io,
          turn.matchId,
          result.state.placements,
        );
      }
      actions += 1;
    } catch (error) {
      if (
        error instanceof AppError &&
        [
          "NOT_YOUR_TURN",
          "DICE_ALREADY_ROLLED",
          "ROLL_REQUIRED",
          "ILLEGAL_MOVE",
          "TOKEN_NOT_FOUND",
          "GAME_NOT_ACTIVE",
        ].includes(error.code)
      ) {
        continue;
      }
      throw error;
    }
  }
  return actions;
}

export interface BotScheduler {
  stop: () => void;
  tick: () => Promise<void>;
}

export function startBotScheduler(io: Server): BotScheduler {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await withPostgresAdvisoryLock(1_071_003, () => processBotTick(io));
    } catch (error) {
      console.error("Bot scheduler tick failed", error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(
    () => void tick(),
    config.NODE_ENV === "production" ? 350 : 1_000,
  );
  timer.unref();
  return {
    stop: () => clearInterval(timer),
    tick,
  };
}
