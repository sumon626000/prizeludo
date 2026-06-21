import express, { Router, type Response } from "express";
import type { Server } from "socket.io";
import { z } from "zod";
import { config, isProduction } from "../config.js";
import { asyncHandler } from "../lib/async-handler.js";
import { toPublicUser } from "../lib/public-user.js";
import {
  requireAdmin,
  requireAdminPermission,
  requireAuth,
  requireMainAdmin,
} from "../middleware/auth.js";
import { authRateLimit } from "../middleware/security.js";
import {
  adjustUserBalance,
  adminPermissionValues,
  archiveSubAdmin,
  banUserEndpoint,
  createSubAdmin,
  exportAdminCsv,
  forceLogoutUser,
  getAdminDashboard,
  getAdminSettings,
  getAdminUserDetail,
  getFinancialReport,
  listAdminAudit,
  listAdminSupportTickets,
  listAdminUsers,
  listAdminNotificationHistory,
  listSubAdmins,
  resetUserPassword,
  sendAdminNotification,
  setUserBan,
  updateAdminSettings,
  updateSubAdmin,
  updateSupportTicket,
} from "../services/admin.service.js";
import {
  authenticateAdminPassword,
  issueSession,
} from "../services/auth.service.js";
import { updateSettingsWithAudit } from "../services/settings.service.js";

const router = Router();
const uuidSchema = z.uuid();
const passwordSchema = z
  .string()
  .min(8)
  .max(72)
  .regex(/[A-Za-z]/)
  .regex(/\d/);
const permissionSchema = z.enum(adminPermissionValues);

function setSessionCookie(response: Response, token: string): void {
  response.cookie(config.COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: config.JWT_EXPIRES_IN_SECONDS * 1_000,
    path: "/",
  });
}

router.post(
  "/login",
  authRateLimit,
  asyncHandler(async (request, response) => {
    const input = z
      .object({
        identifier: z.string().trim().min(3).max(40),
        password: z.string().min(1).max(72),
      })
      .strict()
      .parse(request.body);
    const user = await authenticateAdminPassword(
      input.identifier,
      input.password,
    );
    const session = await issueSession({
      user,
      ipAddress: request.clientIp,
      deviceId: request.deviceId,
    });
    setSessionCookie(response, session.token);
    response.json({ user: toPublicUser(user) });
  }),
);

router.use(requireAuth, requireAdmin);

router.get("/me", (request, response) => {
  response.json({ user: toPublicUser(request.authUser!) });
});

router.get(
  "/dashboard",
  asyncHandler(async (request, response) => {
    const io = request.app.get("io") as Server | undefined;
    response.json(
      await getAdminDashboard(io?.sockets.sockets.size ?? 0),
    );
  }),
);

router.get(
  "/reports/financial",
  requireMainAdmin,
  asyncHandler(async (request, response) => {
    const { period } = z
      .object({
        period: z.enum(["daily", "weekly", "monthly"]).default("daily"),
      })
      .parse(request.query);
    response.json(await getFinancialReport(period));
  }),
);

router.get(
  "/reports/:report.csv",
  requireMainAdmin,
  asyncHandler(async (request, response) => {
    const { report } = z
      .object({
        report: z.enum(["users", "transactions", "tournaments"]),
      })
      .parse(request.params);
    const csv = await exportAdminCsv(report);
    response
      .status(200)
      .type("text/csv")
      .setHeader(
        "content-disposition",
        `attachment; filename="prizejito-${report}.csv"`,
      )
      .send(csv);
  }),
);

router.get(
  "/users",
  requireAdminPermission("users"),
  asyncHandler(async (request, response) => {
    const input = z
      .object({
        search: z.string().trim().max(80).optional(),
        status: z.enum(["all", "active", "banned"]).default("all"),
        limit: z.coerce.number().int().min(1).max(100).default(30),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(request.query);
    response.json(await listAdminUsers(input));
  }),
);

router.get(
  "/users/:userId",
  requireAdminPermission("users"),
  asyncHandler(async (request, response) => {
    const { userId } = z
      .object({ userId: uuidSchema })
      .parse(request.params);
    response.json(await getAdminUserDetail(userId));
  }),
);

router.post(
  "/users/:userId/balance",
  requireAdminPermission("users"),
  asyncHandler(async (request, response) => {
    const { userId } = z
      .object({ userId: uuidSchema })
      .parse(request.params);
    const input = z
      .object({
        balance: z.enum(["main", "winner"]),
        operation: z.enum(["add", "subtract"]),
        amount: z.coerce.number().positive().max(1_000_000),
        reason: z.string().trim().min(3).max(500),
      })
      .strict()
      .parse(request.body);
    response.json({
      user: await adjustUserBalance({
        ...input,
        userId,
        actorId: request.authUser!.id,
        ipAddress: request.clientIp,
        io: request.app.get("io") as Server | undefined,
      }),
    });
  }),
);

router.post(
  "/users/:userId/ban",
  requireAdminPermission("users"),
  asyncHandler(async (request, response) => {
    const { userId } = z
      .object({ userId: uuidSchema })
      .parse(request.params);
    const input = z
      .object({
        banned: z.boolean(),
        reason: z.string().trim().min(3).max(500),
      })
      .strict()
      .parse(request.body);
    const io = request.app.get("io") as Server | undefined;
    const user = await setUserBan({
      ...input,
      userId,
      actorId: request.authUser!.id,
      ipAddress: request.clientIp,
    });
    if (input.banned) {
      io?.in(`user:${userId}`).disconnectSockets(true);
    }
    response.json({ user });
  }),
);

router.post(
  "/users/:userId/force-logout",
  requireAdminPermission("users"),
  asyncHandler(async (request, response) => {
    const { userId } = z
      .object({ userId: uuidSchema })
      .parse(request.params);
    await forceLogoutUser({
      userId,
      actorId: request.authUser!.id,
      ipAddress: request.clientIp,
    });
    const io = request.app.get("io") as Server | undefined;
    io?.in(`user:${userId}`).disconnectSockets(true);
    response.status(204).send();
  }),
);

router.post(
  "/users/:userId/password",
  requireAdminPermission("users"),
  asyncHandler(async (request, response) => {
    const { userId } = z
      .object({ userId: uuidSchema })
      .parse(request.params);
    const { password } = z
      .object({ password: passwordSchema })
      .strict()
      .parse(request.body);
    await resetUserPassword({
      userId,
      password,
      actorId: request.authUser!.id,
      ipAddress: request.clientIp,
    });
    const io = request.app.get("io") as Server | undefined;
    io?.in(`user:${userId}`).disconnectSockets(true);
    response.status(204).send();
  }),
);

router.post(
  "/users/:userId/endpoint-ban",
  requireAdminPermission("users"),
  asyncHandler(async (request, response) => {
    const { userId } = z
      .object({ userId: uuidSchema })
      .parse(request.params);
    const input = z
      .object({
        kind: z.enum(["ip", "device"]),
        value: z.string().trim().min(3).max(128),
        reason: z.string().trim().min(3).max(500),
      })
      .strict()
      .parse(request.body);
    await banUserEndpoint({
      ...input,
      actorId: request.authUser!.id,
      ipAddress: request.clientIp,
    });
    await forceLogoutUser({
      userId,
      actorId: request.authUser!.id,
      ipAddress: request.clientIp,
    });
    const io = request.app.get("io") as Server | undefined;
    io?.in(`user:${userId}`).disconnectSockets(true);
    response.status(204).send();
  }),
);

router.get(
  "/support",
  requireAdminPermission("support"),
  asyncHandler(async (request, response) => {
    const { status } = z
      .object({
        status: z
          .enum(["all", "open", "in_progress", "resolved"])
          .default("all"),
      })
      .parse(request.query);
    response.json({ tickets: await listAdminSupportTickets({ status }) });
  }),
);

router.patch(
  "/support/:ticketId",
  requireAdminPermission("support"),
  asyncHandler(async (request, response) => {
    const { ticketId } = z
      .object({ ticketId: uuidSchema })
      .parse(request.params);
    const input = z
      .object({
        status: z.enum(["open", "in_progress", "resolved"]).optional(),
        reply: z.string().trim().min(2).max(5_000).optional(),
        assignedTo: uuidSchema.nullable().optional(),
      })
      .strict()
      .parse(request.body);
    response.json({
      ticket: await updateSupportTicket({
        ...input,
        ticketId,
        actorId: request.authUser!.id,
        ipAddress: request.clientIp,
        io: request.app.get("io") as Server | undefined,
      }),
    });
  }),
);

router.post(
  "/notifications",
  requireMainAdmin,
  asyncHandler(async (request, response) => {
    const input = z
      .object({
        userId: z.string().trim().min(5).max(40).optional(),
        title: z.string().trim().min(2).max(160),
        message: z.string().trim().min(2).max(2_000),
      })
      .strict()
      .parse(request.body);
    response.status(201).json(
      await sendAdminNotification({
        ...input,
        actorId: request.authUser!.id,
        ipAddress: request.clientIp,
        io: request.app.get("io") as Server | undefined,
      }),
    );
  }),
);

router.get(
  "/notifications/history",
  requireMainAdmin,
  asyncHandler(async (request, response) => {
    const { limit } = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);
    response.json({
      history: await listAdminNotificationHistory(limit),
    });
  }),
);

router.get(
  "/subadmins",
  requireMainAdmin,
  asyncHandler(async (_request, response) => {
    response.json({ subAdmins: await listSubAdmins() });
  }),
);

router.post(
  "/subadmins",
  requireMainAdmin,
  asyncHandler(async (request, response) => {
    const input = z
      .object({
        username: z
          .string()
          .trim()
          .min(3)
          .max(40)
          .regex(/^[a-zA-Z0-9._-]+$/),
        name: z.string().trim().min(2).max(80),
        password: passwordSchema,
        permissions: z.array(permissionSchema).max(4),
      })
      .strict()
      .parse(request.body);
    response.status(201).json({
      user: await createSubAdmin({
        ...input,
        actorId: request.authUser!.id,
        ipAddress: request.clientIp,
      }),
    });
  }),
);

router.patch(
  "/subadmins/:subAdminId",
  requireMainAdmin,
  asyncHandler(async (request, response) => {
    const { subAdminId } = z
      .object({ subAdminId: uuidSchema })
      .parse(request.params);
    const input = z
      .object({
        name: z.string().trim().min(2).max(80).optional(),
        password: passwordSchema.optional(),
        permissions: z.array(permissionSchema).max(4).optional(),
      })
      .strict()
      .parse(request.body);
    response.json({
      user: await updateSubAdmin({
        ...input,
        subAdminId,
        actorId: request.authUser!.id,
        ipAddress: request.clientIp,
      }),
    });
  }),
);

router.delete(
  "/subadmins/:subAdminId",
  requireMainAdmin,
  asyncHandler(async (request, response) => {
    const { subAdminId } = z
      .object({ subAdminId: uuidSchema })
      .parse(request.params);
    await archiveSubAdmin({
      subAdminId,
      actorId: request.authUser!.id,
      ipAddress: request.clientIp,
    });
    response.status(204).send();
  }),
);

router.get(
  "/settings",
  requireMainAdmin,
  asyncHandler(async (_request, response) => {
    response.json(await getAdminSettings());
  }),
);

router.patch(
  "/settings",
  requireMainAdmin,
  asyncHandler(async (request, response) => {
    const { values } = z
      .object({
        values: z.record(z.string(), z.string()).refine(
          (record) => Object.keys(record).length <= 40,
        ),
      })
      .strict()
      .parse(request.body);
    const result = await updateAdminSettings({
      values,
      actorId: request.authUser!.id,
      ipAddress: request.clientIp,
    });
    const saved = result.values;
    (request.app.get("io") as Server | undefined)?.emit("admin:theme-update", {
      siteName: saved["site.name"],
      logoUrl: saved["site.logo_url"],
      themePreset: saved["site.theme_preset"],
      primaryColor: saved["site.primary_color"],
      secondaryColor: saved["site.secondary_color"],
      buttonColor: saved["site.button_color"],
      cardColor: saved["site.card_color"],
      backgroundColor: saved["site.background_color"],
      accentColor: saved["site.accent_color"],
    });
    response.json(result);
  }),
);

router.post(
  "/settings/logo",
  requireMainAdmin,
  express.raw({
    type: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"],
    limit: "256kb",
  }),
  asyncHandler(async (request, response) => {
    const body = request.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new Error("Logo upload body is empty.");
    }
    const mimeType = request.header("content-type") || "image/png";
    const logoUrl = `data:${mimeType};base64,${body.toString("base64")}`;
    await updateSettingsWithAudit({
      values: { "site.logo_url": logoUrl },
      actorId: request.authUser!.id,
      ipAddress: request.clientIp,
      action: "site.logo.update",
      targetType: "settings",
    });
    response.json({ logoUrl });
  }),
);

router.get(
  "/audit",
  requireMainAdmin,
  asyncHandler(async (request, response) => {
    const { limit } = z
      .object({
        limit: z.coerce.number().int().min(1).max(300).default(100),
      })
      .parse(request.query);
    response.json({ logs: await listAdminAudit(limit) });
  }),
);

export const adminRouter = router;
