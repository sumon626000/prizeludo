import { Router } from "express";
import type { Server } from "socket.io";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import {
  requireMainAdmin,
  requireAuth,
} from "../middleware/auth.js";
import {
  createBot,
  deleteBot,
  fillTournamentBots,
  getBotAdminSnapshot,
  updateBot,
  updateBotSettings,
} from "../services/bot.service.js";
import { emitTournamentMutation } from "../services/tournament.service.js";

const router = Router();
const uuidSchema = z.uuid();
const botInputSchema = z
  .object({
    name: z.string().min(3).max(80),
    avatar: z.string().min(1).max(500).default("/avatar-leaf.svg"),
    winRate: z.number().int().min(1).max(100).default(70),
    useGlobalWinRate: z.boolean().default(true),
    actionDelayMinMs: z.number().int().min(500).max(5_000).default(900),
    actionDelayMaxMs: z.number().int().min(500).max(10_000).default(2_200),
    isActive: z.boolean().default(true),
  })
  .refine(
    (value) => value.actionDelayMaxMs >= value.actionDelayMinMs,
    {
      message: "Maximum action delay must be at least the minimum delay.",
      path: ["actionDelayMaxMs"],
    },
  );

router.use(requireAuth, requireMainAdmin);

router.get(
  "/admin",
  asyncHandler(async (_request, response) => {
    response.json(await getBotAdminSnapshot());
  }),
);

router.put(
  "/admin/settings",
  asyncHandler(async (request, response) => {
    const input = z
      .object({
        enabled: z.boolean(),
        globalWinRate: z.number().int().min(1).max(100),
        actionDelayMinMs: z.number().int().min(500).max(5_000),
        actionDelayMaxMs: z.number().int().min(500).max(10_000),
      })
      .refine(
        (value) => value.actionDelayMaxMs >= value.actionDelayMinMs,
        {
          message: "Maximum action delay must be at least the minimum delay.",
          path: ["actionDelayMaxMs"],
        },
      )
      .parse(request.body);
    const io = request.app.get("io") as Server | undefined;
    response.json(
      await updateBotSettings({
        ...input,
        actorId: request.authUser!.id,
        ipAddress: request.clientIp,
        ...(io ? { io } : {}),
      }),
    );
  }),
);

router.post(
  "/admin",
  asyncHandler(async (request, response) => {
    const io = request.app.get("io") as Server | undefined;
    const bot = await createBot({
      bot: botInputSchema.parse(request.body),
      actorId: request.authUser!.id,
      ipAddress: request.clientIp,
      ...(io ? { io } : {}),
    });
    response.status(201).json({ bot });
  }),
);

router.patch(
  "/admin/:botId",
  asyncHandler(async (request, response) => {
    const { botId } = z
      .object({ botId: uuidSchema })
      .parse(request.params);
    const io = request.app.get("io") as Server | undefined;
    const bot = await updateBot({
      botId,
      bot: botInputSchema.parse(request.body),
      actorId: request.authUser!.id,
      ipAddress: request.clientIp,
      ...(io ? { io } : {}),
    });
    response.json({ bot });
  }),
);

router.delete(
  "/admin/:botId",
  asyncHandler(async (request, response) => {
    const { botId } = z
      .object({ botId: uuidSchema })
      .parse(request.params);
    const io = request.app.get("io") as Server | undefined;
    response.json(
      await deleteBot({
        botId,
        actorId: request.authUser!.id,
        ipAddress: request.clientIp,
        ...(io ? { io } : {}),
      }),
    );
  }),
);

router.post(
  "/admin/tournaments/:tournamentId/fill",
  asyncHandler(async (request, response) => {
    const { tournamentId } = z
      .object({ tournamentId: uuidSchema })
      .parse(request.params);
    const { slots } = z
      .object({
        slots: z.number().int().min(1).max(64).optional(),
      })
      .parse(request.body);
    const result = await fillTournamentBots({
      tournamentId,
      ...(slots === undefined ? {} : { requestedSlots: slots }),
      actorId: request.authUser!.id,
      ipAddress: request.clientIp,
    });
    const io = request.app.get("io") as Server | undefined;
    emitTournamentMutation(
      io,
      tournamentId,
      result.addedUserIds,
      "bot_fill",
    );
    io?.emit("bot:update", {
      reason: "tournament_filled",
      tournamentId,
      added: result.addedUserIds.length,
      at: new Date().toISOString(),
    });
    response.json(result);
  }),
);

export const botRouter = router;
