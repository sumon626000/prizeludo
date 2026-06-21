import express, { Router } from "express";
import type { Server } from "socket.io";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { normalizeBangladeshPhone } from "../lib/phone.js";
import { toPublicUser } from "../lib/public-user.js";
import {
  requireAdminPermission,
  requireAuth,
} from "../middleware/auth.js";
import {
  getPlayerStats,
  getProfileOverview,
  getReferralHistory,
  getTournamentHistory,
  getTransactionHistory,
  getTransferHistory,
  changeUserPassword,
  updateUserAvatar,
  updateUserProfile,
} from "../services/profile.service.js";

const router = Router();

const emailSchema = z
  .union([
    z.literal(""),
    z.email().max(254).transform((value) => value.toLowerCase()),
  ])
  .transform((value) => value || null);
const updateSchema = z
  .object({
    name: z.string().min(2).max(80).optional(),
    email: emailSchema.optional(),
    avatar: z.string().max(160).optional(),
    phone: z
      .string()
      .min(10)
      .max(18)
      .transform(normalizeBangladeshPhone)
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one profile field is required.",
  });
const passwordSchema = z
  .string()
  .min(8)
  .max(72)
  .regex(/[A-Za-z]/, "Password must include a letter.")
  .regex(/\d/, "Password must include a number.");
const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(72).optional(),
    newPassword: passwordSchema,
  })
  .strict();
const adminUpdateSchema = updateSchema.safeExtend({
  phone: z
    .string()
    .min(10)
    .max(18)
    .transform(normalizeBangladeshPhone)
    .optional(),
});
router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (request, response) => {
    response.json(await getProfileOverview(request.authUser!.id));
  }),
);

router.patch(
  "/",
  asyncHandler(async (request, response) => {
    const input = updateSchema.parse(request.body);
    const user = await updateUserProfile(request.authUser!.id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.avatar !== undefined ? { avatar: input.avatar } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
    });
    const payload = toPublicUser(user);
    const io = request.app.get("io") as Server | undefined;
    io?.to(`user:${user.id}`).emit("profile:update", payload);
    response.json({ user: payload });
  }),
);

router.post(
  "/avatar",
  express.raw({
    type: ["image/png", "image/jpeg", "image/webp"],
    limit: "768kb",
  }),
  asyncHandler(async (request, response) => {
    const body = request.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new Error("Profile image upload body is empty.");
    }
    const mimeType = request.header("content-type") || "image/png";
    const user = await updateUserAvatar(
      request.authUser!.id,
      `data:${mimeType};base64,${body.toString("base64")}`,
    );
    const payload = toPublicUser(user);
    const io = request.app.get("io") as Server | undefined;
    io?.to(`user:${user.id}`).emit("profile:update", payload);
    response.json({ user: payload });
  }),
);

router.post(
  "/password",
  asyncHandler(async (request, response) => {
    const input = changePasswordSchema.parse(request.body);
    await changeUserPassword(request.authUser!.id, {
      newPassword: input.newPassword,
      ...(input.currentPassword !== undefined
        ? { currentPassword: input.currentPassword }
        : {}),
    });
    response.status(204).send();
  }),
);

router.get(
  "/stats",
  asyncHandler(async (request, response) => {
    response.json({ stats: await getPlayerStats(request.authUser!.id) });
  }),
);

router.get(
  "/history/:type",
  asyncHandler(async (request, response) => {
    const { type } = z
      .object({
        type: z.enum([
          "tournament",
          "deposit",
          "withdraw",
          "refer",
          "transfer",
        ]),
      })
      .parse(request.params);
    const userId = request.authUser!.id;
    if (type === "tournament") {
      response.json({ items: await getTournamentHistory(userId) });
      return;
    }
    if (type === "deposit" || type === "withdraw") {
      response.json({
        items: await getTransactionHistory(userId, type),
      });
      return;
    }
    if (type === "refer") {
      response.json(await getReferralHistory(userId));
      return;
    }
    response.json({ items: await getTransferHistory(userId) });
  }),
);

router.patch(
  "/admin/:userId",
  requireAdminPermission("users"),
  asyncHandler(async (request, response) => {
    const { userId } = z.object({ userId: z.uuid() }).parse(request.params);
    const input = adminUpdateSchema.parse(request.body);
    const user = await updateUserProfile(
      userId,
      {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.avatar !== undefined ? { avatar: input.avatar } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
      },
      {
        actorId: request.authUser!.id,
        ipAddress: request.clientIp,
        fields: Object.keys(input),
      },
    );
    const payload = toPublicUser(user);
    const io = request.app.get("io") as Server | undefined;
    io?.to(`user:${userId}`).emit("profile:update", payload);
    response.json({ user: payload });
  }),
);

export const profileRouter = router;
