import { Router } from "express";
import type { Server } from "socket.io";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { requireAuth } from "../middleware/auth.js";
import { walletRateLimit } from "../middleware/security.js";
import {
  getTradeJitoBalance,
  openTradeJito,
  settleTradeJito,
} from "../services/trade-jito.service.js";
import { normalizeMoneyInput } from "../services/wallet.service.js";

const router = Router();

const stakeSchema = z.union([
  z.number().positive().max(10_000),
  z
    .string()
    .transform((value) => normalizeMoneyInput(value))
    .pipe(z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/)),
]);

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
