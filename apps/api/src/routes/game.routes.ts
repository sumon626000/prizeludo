import { Router } from "express";
import type { Server } from "socket.io";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import {
  optionalAuth,
  requireMainAdmin,
  requireAuth,
} from "../middleware/auth.js";
import { gameRateLimit } from "../middleware/security.js";
import {
  addGameMessage,
  emitGameState,
  getGameRoom,
  getGameSettings,
  heartbeatGame,
  leaveGame,
  moveGameToken,
  resumeManualGamePlay,
  rollGameDice,
  updateGameSettings,
} from "../services/game.service.js";
import {
  emitBalanceUpdate,
  emitTournamentRealtime,
} from "../services/realtime.service.js";

const router = Router();
const uuidSchema = z.uuid();
const emojiValues = [
  "😀",
  "😄",
  "😂",
  "🤣",
  "😍",
  "😎",
  "🤩",
  "🥳",
  "😮",
  "😢",
  "😡",
  "🤔",
  "🙏",
  "👏",
  "👍",
  "👎",
  "💪",
  "🔥",
  "💚",
  "🎲",
  "🏆",
  "👑",
  "⚡",
  "🎉",
] as const;

router.get(
  "/settings",
  asyncHandler(async (_request, response) => {
    response.json({ settings: await getGameSettings() });
  }),
);

router.patch(
  "/admin/settings",
  requireAuth,
  requireMainAdmin,
  asyncHandler(async (request, response) => {
    const input = z
      .object({
        diceSpeed: z.enum(["fast", "normal", "slow"]),
        tokenSpeed: z.enum(["fast", "normal", "slow"]),
        voiceEnabled: z.boolean(),
        voiceProvider: z.literal("jitsi"),
      })
      .strict()
      .parse(request.body);
    const settings = await updateGameSettings({
      ...input,
      actorId: request.authUser!.id,
      ipAddress: request.clientIp,
    });
    (request.app.get("io") as Server | undefined)?.emit(
      "admin:game-settings",
      settings,
    );
    response.json({ settings });
  }),
);

router.get(
  "/:matchId",
  optionalAuth,
  asyncHandler(async (request, response) => {
    const { matchId } = z
      .object({ matchId: uuidSchema })
      .parse(request.params);
    response.json(await getGameRoom(matchId, request.authUser?.id));
  }),
);

router.post(
  "/:matchId/roll",
  requireAuth,
  gameRateLimit,
  asyncHandler(async (request, response) => {
    const { matchId } = z
      .object({ matchId: uuidSchema })
      .parse(request.params);
    const result = await rollGameDice(matchId, request.authUser!.id);
    const io = request.app.get("io") as Server | undefined;
    const now = new Date();
    io?.to(`match:${matchId}`).emit("game:dice-roll", {
      matchId,
      userId: request.authUser!.id,
      dice: result.dice,
      autoPassed: result.autoPassed,
      state: result.state,
      currentTurn: result.currentTurn,
      tokenPositions: result.tokenPositions,
      serverTime: now.toISOString(),
      at: now.toISOString(),
    });
    io?.to(`match:${matchId}`).emit("game:turn-change", {
      matchId,
      userId: result.currentTurn,
      turnDeadline: result.state.turnDeadline,
      turnStartedAt: result.state.turnStartedAt,
      autoPassed: result.autoPassed,
      serverTime: now.toISOString(),
      at: now.toISOString(),
    });
    emitGameState(io, matchId);
    response.json(result);
  }),
);

router.post(
  "/:matchId/move",
  requireAuth,
  gameRateLimit,
  asyncHandler(async (request, response) => {
    const { matchId } = z
      .object({ matchId: uuidSchema })
      .parse(request.params);
    const { tokenIndex } = z
      .object({ tokenIndex: z.number().int().min(0).max(3) })
      .strict()
      .parse(request.body);
    const result = await moveGameToken(
      matchId,
      request.authUser!.id,
      tokenIndex,
    );
    const io = request.app.get("io") as Server | undefined;
    const now = new Date();
    io?.to(`match:${matchId}`).emit("game:token-move", {
      matchId,
      userId: request.authUser!.id,
      tokenIndex,
      from: result.state.lastAction.from,
      to: result.state.lastAction.to,
      killedUserIds: result.killedUserIds,
      reachedHome: result.reachedHome,
      state: result.state,
      currentTurn: result.currentTurn,
      tokenPositions: result.tokenPositions,
      serverTime: now.toISOString(),
      at: now.toISOString(),
    });
    io?.to(`match:${matchId}`).emit("game:turn-change", {
      matchId,
      userId: result.currentTurn,
      turnDeadline: result.state.turnDeadline,
      turnStartedAt: result.state.turnStartedAt,
      serverTime: now.toISOString(),
      at: now.toISOString(),
    });
    if (result.killedUserIds.length > 0) {
      io?.to(`match:${matchId}`).emit("game:token-kill", {
        matchId,
        killedUserIds: result.killedUserIds,
      });
    }
    if (result.state.phase === "completed") {
      const room = await getGameRoom(matchId, request.authUser!.id);
      io?.to(`match:${matchId}`).emit("game:over", {
        matchId,
        placements: result.state.placements,
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
    }
    emitGameState(io, matchId);
    response.json(result);
  }),
);

router.post(
  "/:matchId/resume-manual",
  requireAuth,
  gameRateLimit,
  asyncHandler(async (request, response) => {
    const { matchId } = z
      .object({ matchId: uuidSchema })
      .parse(request.params);
    const result = await resumeManualGamePlay(
      matchId,
      request.authUser!.id,
    );
    if (result.resumed) {
      emitGameState(request.app.get("io") as Server | undefined, matchId);
    }
    response.json(result);
  }),
);

router.post(
  "/:matchId/leave",
  requireAuth,
  gameRateLimit,
  asyncHandler(async (request, response) => {
    const { matchId } = z
      .object({ matchId: uuidSchema })
      .parse(request.params);
    const result = await leaveGame(matchId, request.authUser!.id);
    const io = request.app.get("io") as Server | undefined;
    const now = new Date();
    io?.to(`match:${matchId}`).emit("game:player-leave", {
      matchId,
      userId: request.authUser!.id,
      at: now.toISOString(),
    });
    io?.to(`match:${matchId}`).emit("game:turn-change", {
      matchId,
      userId: result.currentTurn,
      turnDeadline: result.state.turnDeadline,
      turnStartedAt: result.state.turnStartedAt,
      serverTime: now.toISOString(),
      at: now.toISOString(),
    });
    if (result.state.phase === "completed") {
      const room = await getGameRoom(matchId, request.authUser!.id);
      io?.to(`match:${matchId}`).emit("game:over", {
        matchId,
        placements: result.state.placements,
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
    }
    emitGameState(io, matchId);
    response.json(result);
  }),
);

router.post(
  "/:matchId/heartbeat",
  requireAuth,
  gameRateLimit,
  asyncHandler(async (request, response) => {
    const { matchId } = z
      .object({ matchId: uuidSchema })
      .parse(request.params);
    await heartbeatGame(matchId, request.authUser!.id);
    response.status(204).send();
  }),
);

router.post(
  "/:matchId/messages",
  requireAuth,
  gameRateLimit,
  asyncHandler(async (request, response) => {
    const { matchId } = z
      .object({ matchId: uuidSchema })
      .parse(request.params);
    const input = z
      .discriminatedUnion("kind", [
        z.object({
          kind: z.literal("chat"),
          content: z.string().trim().min(1).max(240),
        }),
        z.object({
          kind: z.literal("emoji"),
          content: z.enum(emojiValues),
        }),
      ])
      .parse(request.body);
    const message = await addGameMessage({
      matchId,
      userId: request.authUser!.id,
      ...input,
    });
    (request.app.get("io") as Server | undefined)
      ?.to(`match:${matchId}`)
      .emit("game:message", message);
    response.status(201).json({ message });
  }),
);

export const gameRouter = router;
