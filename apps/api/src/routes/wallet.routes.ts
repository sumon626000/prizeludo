import express, { Router } from "express";
import type { Server } from "socket.io";
import { z } from "zod";
import { config } from "../config.js";
import { asyncHandler } from "../lib/async-handler.js";
import { toPublicUser } from "../lib/public-user.js";
import {
  requireAdminPermission,
  requireAuth,
  requireMainAdmin,
} from "../middleware/auth.js";
import { walletRateLimit } from "../middleware/security.js";
import { emitBalanceUpdate } from "../services/realtime.service.js";
import {
  cancelWithdrawal,
  completeUddoktaDeposit,
  completeZiniPayDeposit,
  createAutoDeposit,
  createManualDeposit,
  createWithdrawal,
  deleteDepositOffer,
  getAdminWalletQueue,
  getAdminWithdrawalDetails,
  getAdminAllTransactions,
  clearAdminTransactionHistory,
  getWalletAdminSettings,
  getWalletDocument,
  getWalletHistory,
  getWalletOverview,
  listDepositOffers,
  normalizeMoneyInput,
  resolveTransferReceiver,
  reviewManualDeposit,
  reviewWithdrawal,
  saveDepositOffer,
  storeWalletDocument,
  transferMainBalance,
  updateWalletSettings,
} from "../services/wallet.service.js";

const router = Router();
const amountSchema = z.union([
  z.number().positive().max(100_000_000),
  z
    .string()
    .transform((value) => normalizeMoneyInput(value))
    .pipe(z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/)),
]);
const uuidSchema = z.uuid();

function emitWalletUpdate(
  io: Server | undefined,
  userId: string,
  reason: string,
): void {
  emitBalanceUpdate(io, userId, { reason });
}

function emitWalletNotification(
  io: Server | undefined,
  userId: string,
  title: string,
): void {
  io?.to(`user:${userId}`).emit("notification:new", { title });
}

function parseReturnInvoiceId(query: unknown): string {
  const parsed = z
    .object({
      invoice_id: z.string().min(1).max(160).optional(),
      invoiceId: z.string().min(1).max(160).optional(),
      invoice: z.string().min(1).max(160).optional(),
    })
    .passthrough()
    .parse(query);
  const invoiceId = parsed.invoice_id ?? parsed.invoiceId ?? parsed.invoice;
  if (!invoiceId) throw new Error("Missing invoice ID.");
  return invoiceId;
}

router.post(
  "/uddoktapay/webhook",
  asyncHandler(async (request, response) => {
    const { invoice_id: invoiceId } = z
      .object({ invoice_id: z.string().min(1).max(160) })
      .parse(request.body);
    const result = await completeUddoktaDeposit({
      invoiceId,
      webhookApiKey: request.header("RT-UDDOKTAPAY-API-KEY") ?? "",
    });
    const io = request.app.get("io") as Server | undefined;
    io?.to(`user:${result.user.id}`).emit(
      "profile:update",
      toPublicUser(result.user),
    );
    emitWalletUpdate(io, result.user.id, "deposit_paid");
    io?.to(`user:${result.user.id}`).emit("notification:new", {
      title: "ডিপোজিট সফল",
    });
    if (result.referral) {
      emitWalletUpdate(io, result.referral.referrerId, "referral_commission");
      io?.to(`user:${result.referral.referrerId}`).emit("notification:new", {
        title: "রেফার কমিশন পেয়েছেন",
      });
    }
    response.json({
      received: true,
      alreadyApplied: result.alreadyApplied,
    });
  }),
);

router.get(
  "/uddoktapay/return",
  asyncHandler(async (request, response) => {
    try {
      const invoiceId = parseReturnInvoiceId(request.query);
      const result = await completeUddoktaDeposit({ invoiceId });
      const io = request.app.get("io") as Server | undefined;
      io?.to(`user:${result.user.id}`).emit(
        "profile:update",
        toPublicUser(result.user),
      );
      emitWalletUpdate(io, result.user.id, "deposit_paid");
      response.redirect(303, `${config.WEB_ORIGIN}/wallet?payment=success`);
    } catch {
      response.redirect(303, `${config.WEB_ORIGIN}/wallet?payment=failed`);
    }
  }),
);

router.post(
  "/zinipay/webhook",
  asyncHandler(async (request, response) => {
    const { invoice_id: invoiceId } = z
      .object({ invoice_id: z.string().min(1).max(160) })
      .parse(request.body);
    const result = await completeZiniPayDeposit({
      invoiceId,
      webhookApiKey: request.header("zini-api-key") ?? "",
    });
    const io = request.app.get("io") as Server | undefined;
    io?.to(`user:${result.user.id}`).emit(
      "profile:update",
      toPublicUser(result.user),
    );
    emitWalletUpdate(io, result.user.id, "deposit_paid");
    io?.to(`user:${result.user.id}`).emit("notification:new", {
      title: "ডিপোজিট সফল",
    });
    if (result.referral) {
      emitWalletUpdate(io, result.referral.referrerId, "referral_commission");
      io?.to(`user:${result.referral.referrerId}`).emit("notification:new", {
        title: "রেফার কমিশন পেয়েছেন",
      });
    }
    response.json({
      received: true,
      alreadyApplied: result.alreadyApplied,
    });
  }),
);

router.get(
  "/zinipay/return",
  asyncHandler(async (request, response) => {
    try {
      const invoiceId = parseReturnInvoiceId(request.query);
      const result = await completeZiniPayDeposit({ invoiceId });
      const io = request.app.get("io") as Server | undefined;
      io?.to(`user:${result.user.id}`).emit(
        "profile:update",
        toPublicUser(result.user),
      );
      emitWalletUpdate(io, result.user.id, "deposit_paid");
      response.redirect(303, `${config.WEB_ORIGIN}/wallet?payment=success`);
    } catch {
      response.redirect(303, `${config.WEB_ORIGIN}/wallet?payment=failed`);
    }
  }),
);

router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (request, response) => {
    response.json(await getWalletOverview(request.authUser!.id));
  }),
);

router.get(
  "/history",
  asyncHandler(async (request, response) => {
    const query = z
      .object({
        type: z
          .enum([
            "deposit",
            "withdraw",
            "transfer",
            "prize",
            "refer",
            "bonus",
            "tournament_fee",
            "tournament_refund",
          ])
          .optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        page: z.coerce.number().int().min(0).default(0),
        pageSize: z.coerce.number().int().min(1).max(20).default(8),
      })
      .parse(request.query);
    response.json(
      await getWalletHistory({
        userId: request.authUser!.id,
        ...(query.type ? { type: query.type } : {}),
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
        page: query.page,
        pageSize: query.pageSize,
      }),
    );
  }),
);

router.post(
  "/documents/:kind",
  walletRateLimit,
  express.raw({
    type: ["image/png", "image/jpeg", "image/webp"],
    limit: "5mb",
  }),
  asyncHandler(async (request, response) => {
    const { kind } = z
      .object({
        kind: z.literal("manual_deposit_proof"),
      })
      .parse(request.params);
    if (!Buffer.isBuffer(request.body)) {
      throw new z.ZodError([
        {
          code: "custom",
          path: ["body"],
          message: "An image body is required.",
        },
      ]);
    }
    response.status(201).json({
      document: await storeWalletDocument({
        userId: request.authUser!.id,
        kind,
        content: request.body,
      }),
    });
  }),
);

router.get(
  "/documents/:documentId",
  asyncHandler(async (request, response) => {
    const { documentId } = z
      .object({ documentId: uuidSchema })
      .parse(request.params);
    const document = await getWalletDocument(
      documentId,
      request.authUser!,
    );
    response.set({
      "content-type": document.mimeType,
      "content-length": String(document.byteSize),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    });
    response.send(document.content);
  }),
);

const depositSchema = z
  .object({
    amount: amountSchema,
    offerId: uuidSchema.optional(),
    provider: z.enum(["uddoktapay", "zinipay"]).optional(),
  })
  .strict();

router.post(
  "/deposit/auto",
  walletRateLimit,
  asyncHandler(async (request, response) => {
    const input = depositSchema.parse(request.body);
    const result = await createAutoDeposit({
      user: request.authUser!,
      amount: input.amount,
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.offerId ? { offerId: input.offerId } : {}),
    });
    const io = request.app.get("io") as Server | undefined;
    emitWalletUpdate(io, request.authUser!.id, "deposit_pending");
    emitWalletNotification(io, request.authUser!.id, "ডিপোজিট pending");
    response.status(201).json(result);
  }),
);

router.post(
  "/deposit/manual",
  walletRateLimit,
  asyncHandler(async (request, response) => {
    const input = depositSchema
      .extend({
        method: z.string().min(2).max(80),
        documentId: uuidSchema,
      })
      .parse(request.body);
    const transaction = await createManualDeposit({
      userId: request.authUser!.id,
      amount: input.amount,
      method: input.method,
      documentId: input.documentId,
      ...(input.offerId ? { offerId: input.offerId } : {}),
    });
    const io = request.app.get("io") as Server | undefined;
    emitWalletUpdate(io, request.authUser!.id, "deposit_pending");
    emitWalletNotification(io, request.authUser!.id, "ডিপোজিট pending");
    response.status(201).json({ transaction });
  }),
);

router.post(
  "/withdraw",
  walletRateLimit,
  asyncHandler(async (request, response) => {
    const input = z
      .object({
        amount: amountSchema,
        method: z.string().min(2).max(80),
        accountNumber: z.string().min(6).max(80),
      })
      .strict()
      .parse(request.body);
    const result = await createWithdrawal({
      userId: request.authUser!.id,
      ...input,
    });
    const io = request.app.get("io") as Server | undefined;
    io?.to(`user:${result.user.id}`).emit(
      "profile:update",
      toPublicUser(result.user),
    );
    emitWalletUpdate(io, result.user.id, "withdraw_pending");
    emitWalletNotification(io, result.user.id, "Withdrawal pending");
    response.status(201).json({
      transaction: result.transaction,
      user: toPublicUser(result.user),
    });
  }),
);

router.post(
  "/withdraw/:withdrawalId/cancel",
  walletRateLimit,
  asyncHandler(async (request, response) => {
    const { withdrawalId } = z
      .object({ withdrawalId: uuidSchema })
      .parse(request.params);
    const result = await cancelWithdrawal({
      userId: request.authUser!.id,
      withdrawalId,
    });
    const io = request.app.get("io") as Server | undefined;
    io?.to(`user:${result.user.id}`).emit(
      "profile:update",
      toPublicUser(result.user),
    );
    emitWalletUpdate(io, result.user.id, "withdraw_cancelled");
    emitWalletNotification(io, result.user.id, "Withdrawal cancelled");
    response.json({
      transaction: result.transaction,
      user: toPublicUser(result.user),
    });
  }),
);

router.get(
  "/transfer/receiver/:gameId",
  asyncHandler(async (request, response) => {
    const { gameId } = z
      .object({ gameId: z.string().regex(/^\d{5}$/) })
      .parse(request.params);
    response.json({
      receiver: await resolveTransferReceiver(
        request.authUser!.id,
        gameId,
      ),
    });
  }),
);

router.post(
  "/transfer",
  walletRateLimit,
  asyncHandler(async (request, response) => {
    const input = z
      .object({
        gameId: z.string().regex(/^\d{5}$/),
        amount: amountSchema,
      })
      .strict()
      .parse(request.body);
    const result = await transferMainBalance({
      senderId: request.authUser!.id,
      receiverGameId: input.gameId,
      amount: input.amount,
    });
    const io = request.app.get("io") as Server | undefined;
    io?.to(`user:${result.sender.id}`).emit(
      "profile:update",
      toPublicUser(result.sender),
    );
    io?.to(`user:${result.receiver.id}`).emit(
      "profile:update",
      toPublicUser(result.receiver),
    );
    emitWalletUpdate(io, result.sender.id, "transfer_sent");
    emitWalletUpdate(io, result.receiver.id, "transfer_received");
    io?.to(`user:${result.sender.id}`).emit("notification:new", {
      title: "Balance transfer সফল",
    });
    io?.to(`user:${result.receiver.id}`).emit("notification:new", {
      title: "Balance পেয়েছেন",
    });
    response.status(201).json({
      sender: toPublicUser(result.sender),
      receiver: {
        id: result.receiver.id,
        gameId: result.receiver.gameId,
        name: result.receiver.name,
        avatar: result.receiver.avatar,
      },
      commission: result.commission,
      totalDebit: result.totalDebit,
    });
  }),
);

router.get(
  "/admin/settings",
  requireMainAdmin,
  asyncHandler(async (_request, response) => {
    response.json({ settings: await getWalletAdminSettings() });
  }),
);

router.patch(
  "/admin/settings",
  requireMainAdmin,
  asyncHandler(async (request, response) => {
    const input = z
      .object({
        depositMin: z.number().positive().max(100_000_000).optional(),
        depositMax: z.number().positive().max(100_000_000).optional(),
        withdrawMin: z.number().positive().max(100_000_000).optional(),
        transferMin: z.number().positive().max(100_000_000).optional(),
        transferCommissionPercent: z.number().min(0).max(100).optional(),
        referralCommissionPercent: z.number().min(0).max(100).optional(),
        uddoktaPayEnabled: z.boolean().optional(),
        uddoktaPayBaseUrl: z
          .url()
          .max(500)
          .refine((value) => {
            const protocol = new URL(value).protocol;
            return protocol === "https:" || protocol === "http:";
          }, "Must be an HTTP(S) URL.")
          .optional(),
        uddoktaPayApiKey: z.string().max(500).optional(),
        ziniPayEnabled: z.boolean().optional(),
        ziniPayBaseUrl: z
          .url()
          .max(500)
          .refine((value) => {
            const protocol = new URL(value).protocol;
            return protocol === "https:" || protocol === "http:";
          }, "Must be an HTTP(S) URL.")
          .optional(),
        ziniPayApiKey: z.string().max(500).optional(),
        manualDepositEnabled: z.boolean().optional(),
        manualMethods: z
          .array(
            z.object({
              name: z.string().min(2).max(80),
              account: z.string().min(3).max(120),
              instructions: z.string().max(500).optional(),
            }),
          )
          .max(10)
          .optional(),
        withdrawMethods: z.array(z.string().min(2).max(80)).max(12).optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0)
      .parse(request.body);
    const settings = await updateWalletSettings({
      actorId: request.authUser!.id,
      ipAddress: request.clientIp,
      ...(input.depositMin !== undefined
        ? { depositMin: input.depositMin }
        : {}),
      ...(input.depositMax !== undefined
        ? { depositMax: input.depositMax }
        : {}),
      ...(input.withdrawMin !== undefined
        ? { withdrawMin: input.withdrawMin }
        : {}),
      ...(input.transferMin !== undefined
        ? { transferMin: input.transferMin }
        : {}),
      ...(input.transferCommissionPercent !== undefined
        ? { transferCommissionPercent: input.transferCommissionPercent }
        : {}),
      ...(input.referralCommissionPercent !== undefined
        ? { referralCommissionPercent: input.referralCommissionPercent }
        : {}),
      ...(input.uddoktaPayEnabled !== undefined
        ? { uddoktaPayEnabled: input.uddoktaPayEnabled }
        : {}),
      ...(input.uddoktaPayBaseUrl !== undefined
        ? { uddoktaPayBaseUrl: input.uddoktaPayBaseUrl }
        : {}),
      ...(input.uddoktaPayApiKey !== undefined
        ? { uddoktaPayApiKey: input.uddoktaPayApiKey }
        : {}),
      ...(input.ziniPayEnabled !== undefined
        ? { ziniPayEnabled: input.ziniPayEnabled }
        : {}),
      ...(input.ziniPayBaseUrl !== undefined
        ? { ziniPayBaseUrl: input.ziniPayBaseUrl }
        : {}),
      ...(input.ziniPayApiKey !== undefined
        ? { ziniPayApiKey: input.ziniPayApiKey }
        : {}),
      ...(input.manualDepositEnabled !== undefined
        ? { manualDepositEnabled: input.manualDepositEnabled }
        : {}),
      ...(input.manualMethods !== undefined
        ? {
            manualMethods: input.manualMethods.map((method) => ({
              name: method.name,
              account: method.account,
              ...(method.instructions !== undefined
                ? { instructions: method.instructions }
                : {}),
            })),
          }
        : {}),
      ...(input.withdrawMethods !== undefined
        ? { withdrawMethods: input.withdrawMethods }
        : {}),
    });
    const io = request.app.get("io") as Server | undefined;
    io?.emit("wallet:settings", settings);
    response.json({ settings });
  }),
);

const offerSchema = z
  .object({
    amount: amountSchema,
    bonusPercent: z.number().min(0).max(100),
    isActive: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(1000).default(0),
  })
  .strict();

router.post(
  "/admin/offers",
  requireMainAdmin,
  asyncHandler(async (request, response) => {
    const input = offerSchema.parse(request.body);
    const offer = await saveDepositOffer({
      ...input,
      actorId: request.authUser!.id,
      ipAddress: request.clientIp,
    });
    const io = request.app.get("io") as Server | undefined;
    io?.emit("wallet:settings", { reason: "offers_updated" });
    response.status(201).json({ offer });
  }),
);

router.get(
  "/admin/offers",
  requireMainAdmin,
  asyncHandler(async (_request, response) => {
    response.json({ offers: await listDepositOffers() });
  }),
);

router.patch(
  "/admin/offers/:offerId",
  requireMainAdmin,
  asyncHandler(async (request, response) => {
    const { offerId } = z.object({ offerId: uuidSchema }).parse(request.params);
    const input = offerSchema.parse(request.body);
    const offer = await saveDepositOffer({
      id: offerId,
      ...input,
      actorId: request.authUser!.id,
      ipAddress: request.clientIp,
    });
    const io = request.app.get("io") as Server | undefined;
    io?.emit("wallet:settings", { reason: "offers_updated" });
    response.json({ offer });
  }),
);

router.delete(
  "/admin/offers/:offerId",
  requireMainAdmin,
  asyncHandler(async (request, response) => {
    const { offerId } = z.object({ offerId: uuidSchema }).parse(request.params);
    await deleteDepositOffer({
      offerId,
      actorId: request.authUser!.id,
      ipAddress: request.clientIp,
    });
    const io = request.app.get("io") as Server | undefined;
    io?.emit("wallet:settings", { reason: "offers_updated" });
    response.status(204).send();
  }),
);

router.get(
  "/admin/transactions",
  requireAdminPermission("financial"),
  asyncHandler(async (request, response) => {
    const query = z
      .object({
        type: z.enum(["deposit", "withdraw", "transfer"]).optional(),
        page: z.coerce.number().int().min(0).default(0),
        pageSize: z.coerce.number().int().min(1).max(100).default(30),
      })
      .parse(request.query);
    response.json(
      await getAdminAllTransactions({
        page: query.page,
        pageSize: query.pageSize,
        ...(query.type ? { type: query.type } : {}),
      }),
    );
  }),
);

router.delete(
  "/admin/transactions/history",
  requireMainAdmin,
  asyncHandler(async (request, response) => {
    const result = await clearAdminTransactionHistory({
      actorId: request.authUser!.id,
      ipAddress: request.clientIp,
    });
    response.status(200).json(result);
  }),
);

router.get(
  "/admin/queue/:type",
  requireAdminPermission("financial"),
  asyncHandler(async (request, response) => {
    const { type } = z
      .object({ type: z.enum(["deposit", "withdraw"]) })
      .parse(request.params);
    response.json({ items: await getAdminWalletQueue(type) });
  }),
);

router.post(
  "/admin/deposits/:depositId/review",
  requireAdminPermission("financial"),
  asyncHandler(async (request, response) => {
    const { depositId } = z
      .object({ depositId: uuidSchema })
      .parse(request.params);
    const input = z
      .object({
        approve: z.boolean(),
        reason: z.string().min(2).max(500).optional(),
      })
      .strict()
      .parse(request.body);
    const result = await reviewManualDeposit({
      depositId,
      approve: input.approve,
      actorId: request.authUser!.id,
      ipAddress: request.clientIp,
      ...(input.reason ? { reason: input.reason } : {}),
    });
    const io = request.app.get("io") as Server | undefined;
    const userId = "user" in result ? result.user.id : result.userId;
    if ("user" in result) {
      io?.to(`user:${result.user.id}`).emit(
        "profile:update",
        toPublicUser(result.user),
      );
    }
    emitWalletUpdate(io, userId, input.approve ? "deposit_paid" : "deposit_rejected");
    emitWalletNotification(
      io,
      userId,
      input.approve ? "ডিপোজিট paid" : "ডিপোজিট rejected",
    );
    response.json(result);
  }),
);

router.get(
  "/admin/withdrawals/:withdrawalId",
  requireAdminPermission("financial"),
  asyncHandler(async (request, response) => {
    const { withdrawalId } = z
      .object({ withdrawalId: uuidSchema })
      .parse(request.params);
    response.json({
      withdrawal: await getAdminWithdrawalDetails(withdrawalId),
    });
  }),
);

router.post(
  "/admin/withdrawals/:withdrawalId/review",
  requireAdminPermission("financial"),
  asyncHandler(async (request, response) => {
    const { withdrawalId } = z
      .object({ withdrawalId: uuidSchema })
      .parse(request.params);
    const input = z
      .object({
        status: z.enum(["approved", "rejected", "paid"]),
        reason: z.string().min(2).max(500).optional(),
      })
      .strict()
      .parse(request.body);
    const result = await reviewWithdrawal({
      withdrawalId,
      status: input.status,
      actorId: request.authUser!.id,
      ipAddress: request.clientIp,
      ...(input.reason ? { reason: input.reason } : {}),
    });
    const io = request.app.get("io") as Server | undefined;
    if (result.user) {
      io?.to(`user:${result.user.id}`).emit(
        "profile:update",
        toPublicUser(result.user),
      );
    }
    emitWalletUpdate(io, result.userId, `withdraw_${input.status}`);
    emitWalletNotification(
      io,
      result.userId,
      input.status === "paid"
        ? "Withdrawal paid"
        : input.status === "rejected"
          ? "Withdrawal rejected"
          : `Withdrawal ${input.status}`,
    );
    response.json({
      transaction: result.transaction,
      ...(result.user ? { user: toPublicUser(result.user) } : {}),
    });
  }),
);

export const walletRouter = router;
