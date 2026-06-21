import { Router } from "express";
import type { Server } from "socket.io";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { toPublicUser } from "../lib/public-user.js";
import {
  optionalAuth,
  requireAdminPermission,
  requireAuth,
  requireMainAdmin,
} from "../middleware/auth.js";
import { walletRateLimit } from "../middleware/security.js";
import { preRegisterTournament } from "../services/home.service.js";
import { emitTournamentRealtime } from "../services/realtime.service.js";
import {
  completeMatch,
  connectToMatch,
  createTournament,
  deleteTournament,
  emitTournamentMutation,
  getShowcaseSettings,
  getMixedAutoSettings,
  getActiveTournament,
  getMatchSnapshot,
  getTournamentDetails,
  joinTournament,
  leaveTournament,
  listTournaments,
  updateShowcaseSettings,
  updateMixedAutoSettings,
  updateTournament,
} from "../services/tournament.service.js";

const router = Router();
const uuidSchema = z.uuid();
const amountSchema = z.union([
  z.number().min(0).max(100_000_000),
  z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/),
]);
const playerCountSchema = z.union([
  z.literal(2),
  z.literal(4),
  z.literal(8),
  z.literal(16),
  z.literal(32),
  z.literal(64),
]);
const tournamentInputSchema = z
  .object({
    title: z.string().min(3).max(160),
    playerCount: playerCountSchema,
    boardType: z.enum(["2p", "4p"]),
    gameMode: z.enum(["classic", "quick", "master"]),
    type: z.enum(["free", "paid"]).default("paid"),
    joinFee: amountSchema.default(0),
    prizePool: amountSchema,
    adminCommission: z.number().min(0).max(100).default(10),
    prizeFirst: z.number().min(0).max(100).default(70),
    prizeSecond: z.number().min(0).max(100).default(30),
    playerType: z.enum(["real", "bot", "mixed"]).default("real"),
    countdownDuration: z.number().int().min(10).max(86_400),
    betweenRoundSeconds: z.number().int().min(30).max(60).default(60),
    status: z.enum(["upcoming", "waiting"]).default("waiting"),
    startsAt: z.coerce.date().nullable().optional(),
  })
  .strict();

router.get(
  "/",
  optionalAuth,
  asyncHandler(async (request, response) => {
    const query = z
      .object({
        type: z.enum(["free", "paid"]).optional(),
        boardType: z.enum(["2p", "4p"]).optional(),
        gameMode: z.enum(["classic", "quick", "master"]).optional(),
        status: z
          .enum(["upcoming", "waiting", "active", "completed"])
          .optional(),
        includeCompleted: z
          .enum(["true", "false"])
          .transform((value) => value === "true")
          .optional(),
      })
      .parse(request.query);
    response.json({
      tournaments: await listTournaments({
        ...(request.authUser?.id ? { userId: request.authUser.id } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.boardType ? { boardType: query.boardType } : {}),
        ...(query.gameMode ? { gameMode: query.gameMode } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.includeCompleted !== undefined
          ? { includeCompleted: query.includeCompleted }
          : {}),
      }),
      serverTime: new Date(),
    });
  }),
);

router.get(
  "/active",
  requireAuth,
  asyncHandler(async (request, response) => {
    response.json({
      active: await getActiveTournament(request.authUser!.id),
    });
  }),
);

router.get(
  "/matches/:matchId",
  optionalAuth,
  asyncHandler(async (request, response) => {
    const { matchId } = z
      .object({ matchId: uuidSchema })
      .parse(request.params);
    response.json(await getMatchSnapshot(matchId));
  }),
);

router.post(
  "/matches/:matchId/connect",
  requireAuth,
  walletRateLimit,
  asyncHandler(async (request, response) => {
    const { matchId } = z
      .object({ matchId: uuidSchema })
      .parse(request.params);
    const result = await connectToMatch(matchId, request.authUser!.id);
    const io = request.app.get("io") as Server | undefined;
    io?.to(`match:${matchId}`).emit("match:update", {
      matchId,
      reason: result.started ? "started" : "player_connected",
      at: new Date().toISOString(),
    });
    if (result.started) {
      const snapshot = await getMatchSnapshot(matchId);
      await emitTournamentRealtime(io, {
        tournamentId: result.match.tournamentId,
        reason: "round_started",
      });
      io?.to(`match:${matchId}`).emit("game:turn-change", {
        matchId,
        userId: snapshot.state?.currentTurn ?? null,
        turnDeadline:
          snapshot.state &&
          typeof snapshot.state.boardState === "object" &&
          snapshot.state.boardState &&
          "turnDeadline" in snapshot.state.boardState
            ? snapshot.state.boardState.turnDeadline
            : null,
        turnStartedAt:
          snapshot.state &&
          typeof snapshot.state.boardState === "object" &&
          snapshot.state.boardState &&
          "turnStartedAt" in snapshot.state.boardState
            ? snapshot.state.boardState.turnStartedAt
            : null,
        serverTime: new Date().toISOString(),
        at: new Date().toISOString(),
      });
    } else {
      io?.to(`match:${matchId}`).emit("lobby:player-waiting", {
        matchId,
        userId: request.authUser!.id,
        at: new Date().toISOString(),
      });
    }
    response.json(result);
  }),
);

router.post(
  "/admin/matches/:matchId/complete",
  requireAuth,
  requireAdminPermission("tournaments"),
  asyncHandler(async (request, response) => {
    const { matchId } = z
      .object({ matchId: uuidSchema })
      .parse(request.params);
    const input = z
      .object({
        placements: z.array(uuidSchema).min(1).max(4),
      })
      .strict()
      .parse(request.body);
    const result = await completeMatch({
      matchId,
      placements: input.placements,
      actorId: request.authUser!.id,
      ipAddress: request.clientIp,
    });
    const io = request.app.get("io") as Server | undefined;
    emitTournamentMutation(
      io,
      result.tournamentId,
      result.participantIds,
      result.tournamentCompleted ? "tournament_completed" : "match_completed",
    );
    if (!result.tournamentCompleted) {
      await emitTournamentRealtime(io, {
        tournamentId: result.tournamentId,
        reason: "next_round_countdown",
      });
    }
    io?.to(`match:${matchId}`).emit("match:update", {
      matchId,
      reason: "completed",
      at: new Date().toISOString(),
    });
    for (const user of result.rewardedUsers) {
      io?.to(`user:${user.id}`).emit("profile:update", toPublicUser(user));
      io?.to(`user:${user.id}`).emit("winner:celebration", {
        tournamentId: result.tournamentId,
      });
    }
    response.json(result);
  }),
);

router.post(
  "/admin",
  requireAuth,
  requireAdminPermission("tournaments"),
  asyncHandler(async (request, response) => {
    const input = tournamentInputSchema.parse(request.body);
    const tournament = await createTournament({
      tournament: input,
      actorId: request.authUser!.id,
      ipAddress: request.clientIp,
    });
    emitTournamentMutation(
      request.app.get("io") as Server | undefined,
      tournament.id,
      [],
      "created",
    );
    response.status(201).json({ tournament });
  }),
);

router.get(
  "/admin/showcase/settings",
  requireAuth,
  requireMainAdmin,
  asyncHandler(async (_request, response) => {
    response.json({ settings: await getShowcaseSettings() });
  }),
);

router.put(
  "/admin/showcase/settings",
  requireAuth,
  requireMainAdmin,
  asyncHandler(async (request, response) => {
    const settings = z
      .object({
        enabled: z.boolean(),
        count: z.number().int().min(3).max(5),
        sizes: z
          .array(z.enum(["4", "8", "16", "32", "64"]).transform(Number))
          .min(1)
          .max(5),
      })
      .strict()
      .parse(request.body);
    const io = request.app.get("io") as Server | undefined;
    response.json({
      settings: await updateShowcaseSettings({
        settings: {
          enabled: settings.enabled,
          count: settings.count,
          sizes: settings.sizes as Array<4 | 8 | 16 | 32 | 64>,
        },
        actorId: request.authUser!.id,
        ipAddress: request.clientIp,
        ...(io ? { io } : {}),
      }),
    });
  }),
);

router.get(
  "/admin/mixed-auto/settings",
  requireAuth,
  requireMainAdmin,
  asyncHandler(async (_request, response) => {
    response.json({ settings: await getMixedAutoSettings() });
  }),
);

router.put(
  "/admin/mixed-auto/settings",
  requireAuth,
  requireMainAdmin,
  asyncHandler(async (request, response) => {
    const settings = z
      .object({
        enabled: z.boolean(),
        countdownSeconds: z.number().int().min(5).max(300),
      })
      .strict()
      .parse(request.body);
    const io = request.app.get("io") as Server | undefined;
    response.json({
      settings: await updateMixedAutoSettings({
        settings,
        actorId: request.authUser!.id,
        ipAddress: request.clientIp,
        ...(io ? { io } : {}),
      }),
    });
  }),
);

router.patch(
  "/admin/:tournamentId",
  requireAuth,
  requireAdminPermission("tournaments"),
  asyncHandler(async (request, response) => {
    const { tournamentId } = z
      .object({ tournamentId: uuidSchema })
      .parse(request.params);
    const input = tournamentInputSchema.parse(request.body);
    const tournament = await updateTournament({
      tournamentId,
      tournament: input,
      actorId: request.authUser!.id,
      ipAddress: request.clientIp,
    });
    emitTournamentMutation(
      request.app.get("io") as Server | undefined,
      tournament.id,
      [],
      "updated",
    );
    response.json({ tournament });
  }),
);

router.delete(
  "/admin/:tournamentId",
  requireAuth,
  requireAdminPermission("tournaments"),
  asyncHandler(async (request, response) => {
    const { tournamentId } = z
      .object({ tournamentId: uuidSchema })
      .parse(request.params);
    const result = await deleteTournament({
      tournamentId,
      actorId: request.authUser!.id,
      ipAddress: request.clientIp,
    });
    emitTournamentMutation(
      request.app.get("io") as Server | undefined,
      tournamentId,
      result.refundedUserIds,
      "deleted",
    );
    response.status(204).send();
  }),
);

router.get(
  "/:tournamentId",
  optionalAuth,
  asyncHandler(async (request, response) => {
    const { tournamentId } = z
      .object({ tournamentId: uuidSchema })
      .parse(request.params);
    response.json(
      await getTournamentDetails(tournamentId, request.authUser?.id),
    );
  }),
);

router.post(
  "/:tournamentId/pre-register",
  requireAuth,
  walletRateLimit,
  asyncHandler(async (request, response) => {
    const { tournamentId } = z
      .object({ tournamentId: uuidSchema })
      .parse(request.params);
    const result = await preRegisterTournament(
      tournamentId,
      request.authUser!.id,
    );
    const io = request.app.get("io") as Server | undefined;
    if (result.notification) {
      io?.to(`user:${request.authUser!.id}`).emit(
        "notification:new",
        result.notification,
      );
    }
    emitTournamentMutation(io, tournamentId, [], "pre_registered");
    response.status(201).json(result);
  }),
);

router.post(
  "/:tournamentId/join",
  requireAuth,
  walletRateLimit,
  asyncHandler(async (request, response) => {
    const { tournamentId } = z
      .object({ tournamentId: uuidSchema })
      .parse(request.params);
    const result = await joinTournament(tournamentId, request.authUser!.id);
    const io = request.app.get("io") as Server | undefined;
    io?.to(`user:${result.user.id}`).emit(
      "profile:update",
      toPublicUser(result.user),
    );
    if (result.notification) {
      io?.to(`user:${result.user.id}`).emit(
        "notification:new",
        result.notification,
      );
    }
    emitTournamentMutation(io, tournamentId, [result.user.id], "joined", {
      userId: result.user.id,
      player: {
        id: result.user.id,
        name: result.user.name,
        avatar: result.user.avatar,
        gameId: result.user.gameId,
      },
    });
    response.status(result.alreadyJoined ? 200 : 201).json({
      entry: result.entry,
      user: toPublicUser(result.user),
      alreadyJoined: result.alreadyJoined,
    });
  }),
);

router.post(
  "/:tournamentId/leave",
  requireAuth,
  walletRateLimit,
  asyncHandler(async (request, response) => {
    const { tournamentId } = z
      .object({ tournamentId: uuidSchema })
      .parse(request.params);
    const result = await leaveTournament(tournamentId, request.authUser!.id);
    const io = request.app.get("io") as Server | undefined;
    io?.to(`user:${result.user.id}`).emit(
      "profile:update",
      toPublicUser(result.user),
    );
    io?.to(`user:${result.user.id}`).emit(
      "notification:new",
      result.notification,
    );
    emitTournamentMutation(io, tournamentId, [result.user.id], "left");
    response.json({
      entry: result.entry,
      user: toPublicUser(result.user),
    });
  }),
);

export const tournamentRouter = router;
