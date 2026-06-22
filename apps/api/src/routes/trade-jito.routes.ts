import { Router } from "express";
import type { Server } from "socket.io";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { requireAuth, requireMainAdmin } from "../middleware/auth.js";
import { walletRateLimit } from "../middleware/security.js";
import {
  adminPatchSchema,
  getTradeJitoSettings,
  toPublicTradeJitoSettings,
  updateTradeJitoSettings,
} from "../services/trade-jito-settings.service.js";
import {
  getTradeJitoBalance,
  openTradeJito,
  settleTradeJito,
} from "../services/trade-jito.service.js";
import { normalizeMoneyInput } from "../services/wallet.service.js";

const router = Router();

const stakeSchema = z.union([
  z.number().positive().max(1_000_000),
  z
    .string()
    .transform((value) => normalizeMoneyInput(value))
    .pipe(z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/)),
]);

router.get(
  "/settings",
  asyncHandler(async (_request, response) => {
    const settings = await getTradeJitoSettings();
    response.json({ settings: toPublicTradeJitoSettings(settings) });
  }),
);

router.get(
  "/admin/settings",
  requireAuth,
  requireMainAdmin,
  asyncHandler(async (_request, response) => {
    response.json({ settings: await getTradeJitoSettings() });
  }),
);

router.patch(
  "/admin/settings",
  requireAuth,
  requireMainAdmin,
  asyncHandler(async (request, response) => {
    const patch = adminPatchSchema.parse(request.body);
    const settings = await updateTradeJitoSettings({
      patch,
      actorId: request.authUser!.id,
      ipAddress: request.clientIp,
    });
    (request.app.get("io") as Server | undefined)?.emit(
      "trade-jito:settings",
      toPublicTradeJitoSettings(settings),
    );
    response.json({ settings });
  }),
);

router.get(
  "/balance",
  requireAuth,
  asyncHandler(async (request, response) => {
    response.json({
      balance: getTradeJitoBalance(request.authUser!),
    });
  }),
);

router.post(
  "/open",
  requireAuth,
  walletRateLimit,
  asyncHandler(async (request, response) => {
    const body = z
      .object({
        stake: stakeSchema,
        direction: z.enum(["BUY", "SELL"]),
        trend: z.enum(["UPTREND", "DOWNTREND"]),
      })
      .parse(request.body);
    const io = request.app.get("io") as Server | undefined;
    const result = await openTradeJito({
      userId: request.authUser!.id,
      stake: body.stake,
      direction: body.direction,
      trend: body.trend,
      ...(io ? { io } : {}),
    });
    response.status(201).json(result);
  }),
);

router.post(
  "/settle",
  requireAuth,
  walletRateLimit,
  asyncHandler(async (request, response) => {
    const body = z
      .object({
        tradeId: z.uuid(),
      })
      .parse(request.body);
    const io = request.app.get("io") as Server | undefined;
    const result = await settleTradeJito({
      userId: request.authUser!.id,
      tradeId: body.tradeId,
      ...(io ? { io } : {}),
    });
    response.json(result);
  }),
);

export const tradeJitoRouter = router;
