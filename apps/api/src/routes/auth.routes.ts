import { Router, type Response } from "express";
import { z } from "zod";
import {
  isGoogleAuthEnabled,
  passport,
  type GoogleIdentity,
} from "../auth/google.js";
import { config, isProduction } from "../config.js";
import { asyncHandler } from "../lib/async-handler.js";
import { AppError } from "../lib/errors.js";
import { normalizeBangladeshPhone } from "../lib/phone.js";
import { toPublicUser } from "../lib/public-user.js";
import { requireAuth } from "../middleware/auth.js";
import { authRateLimit } from "../middleware/security.js";
import {
  authenticatePassword,
  claimFirstAdmin,
  findOrCreateGoogleUser,
  isAdminClaimAvailable,
  issueSession,
  registerGuestUser,
  registerUserDirect,
  requestPasswordHelp,
  revokeSession,
} from "../services/auth.service.js";
import {
  assertLoginAllowed,
  assertRegistrationAllowed,
} from "../services/ban.service.js";

const router = Router();

const passwordSchema = z
  .string()
  .min(8)
  .max(72)
  .regex(/[A-Za-z]/, "Password must include a letter.")
  .regex(/\d/, "Password must include a number.");

const phoneSchema = z.string().min(10).max(18).transform(normalizeBangladeshPhone);

const registrationRequestSchema = z.object({
  phone: phoneSchema,
  name: z.string().min(2).max(80),
  password: passwordSchema,
  email: z
    .string()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase())
    .optional(),
  referCode: z
    .string()
    .min(4)
    .max(12)
    .transform((value) => value.toUpperCase())
    .optional(),
});
const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1).max(72),
});

function setSessionCookie(response: Response, token: string): void {
  response.cookie(config.COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    maxAge: config.JWT_EXPIRES_IN_SECONDS * 1_000,
    path: "/",
  });
}

function clearSessionCookie(response: Response): void {
  response.clearCookie(config.COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
  });
}

router.post(
  "/register",
  authRateLimit,
  asyncHandler(async (request, response) => {
    await assertLoginAllowed(request.clientIp, request.deviceId);
    await assertRegistrationAllowed(request.clientIp, request.deviceId);
    const input = registrationRequestSchema.parse(request.body);
    const user = await registerUserDirect({
      phone: input.phone,
      name: input.name,
      password: input.password,
      ...(input.email ? { email: input.email } : {}),
      ...(input.referCode ? { referCode: input.referCode } : {}),
    });
    const session = await issueSession({
      user,
      ipAddress: request.clientIp,
      deviceId: request.deviceId,
    });
    setSessionCookie(response, session.token);
    response.status(201).json({ user: toPublicUser(user) });
  }),
);

router.post(
  "/login",
  authRateLimit,
  asyncHandler(async (request, response) => {
    await assertLoginAllowed(request.clientIp, request.deviceId);
    const input = loginSchema.parse(request.body);
    const user = await authenticatePassword(input.phone, input.password);
    const session = await issueSession({
      user,
      ipAddress: request.clientIp,
      deviceId: request.deviceId,
    });
    setSessionCookie(response, session.token);
    response.json({ user: toPublicUser(user) });
  }),
);

router.post(
  "/password/request-help",
  authRateLimit,
  asyncHandler(async (request, response) => {
    await assertLoginAllowed(request.clientIp, request.deviceId);
    const input = z
      .object({
        phone: phoneSchema,
        message: z.string().trim().max(1_000).optional(),
      })
      .strict()
      .parse(request.body);
    await requestPasswordHelp(input.phone, input.message);
    response.status(202).json({
      message:
        "অ্যাকাউন্ট থাকলে password recovery request support team-এর কাছে পাঠানো হয়েছে।",
    });
  }),
);

router.post(
  "/guest",
  authRateLimit,
  asyncHandler(async (request, response) => {
    await assertLoginAllowed(request.clientIp, request.deviceId);
    const user = await registerGuestUser(request.deviceId);
    const session = await issueSession({
      user,
      ipAddress: request.clientIp,
      deviceId: request.deviceId,
    });
    setSessionCookie(response, session.token);
    response.status(201).json({
      authenticated: true,
      guest: true,
      user: toPublicUser(user),
    });
  }),
);

router.post(
  "/logout",
  requireAuth,
  asyncHandler(async (request, response) => {
    if (request.authSessionId) {
      await revokeSession(request.authSessionId);
    }
    clearSessionCookie(response);
    response.status(204).send();
  }),
);

router.get(
  "/me",
  asyncHandler(async (request, response) => {
    const token = request.cookies?.[config.COOKIE_NAME] as string | undefined;
    if (!token) {
      response.json({
        authenticated: false,
        guest: true,
        adminClaimAvailable: await isAdminClaimAvailable(),
      });
      return;
    }

    try {
      const { authenticateSession } = await import("../services/auth.service.js");
      const auth = await authenticateSession(token, {
        ipAddress: request.clientIp,
        deviceId: request.deviceId,
      });
      response.json({
        authenticated: true,
        guest: auth.user.isGuest,
        user: toPublicUser(auth.user),
        adminClaimAvailable:
          !auth.user.isGuest && (await isAdminClaimAvailable()),
      });
    } catch (error) {
      if (
        error instanceof AppError &&
        (error.code === "AUTH_REQUIRED" ||
          error.code === "SESSION_DEVICE_MISMATCH")
      ) {
        clearSessionCookie(response);
        response.json({
          authenticated: false,
          guest: true,
          adminClaimAvailable: await isAdminClaimAvailable(),
        });
        return;
      }
      throw error;
    }
  }),
);

router.get(
  "/admin-claim/status",
  asyncHandler(async (_request, response) => {
    response.json({
      available: !isProduction && (await isAdminClaimAvailable()),
      requiresSecret: isProduction,
    });
  }),
);

router.post(
  "/admin-claim",
  requireAuth,
  asyncHandler(async (request, response) => {
    if (
      isProduction &&
      request.header("x-admin-claim-secret") !== config.ADMIN_CLAIM_SECRET
    ) {
      throw new AppError(
        403,
        "ADMIN_CLAIM_SECRET_REQUIRED",
        "A valid admin bootstrap secret is required.",
      );
    }
    const user = await claimFirstAdmin(
      request.authUser!.id,
      request.clientIp,
    );
    response.json({
      user: toPublicUser(user),
      adminClaimAvailable: false,
    });
  }),
);

router.get("/google", (request, response, next) => {
  if (!isGoogleAuthEnabled()) {
    next(
      new AppError(
        503,
        "GOOGLE_AUTH_NOT_CONFIGURED",
        "Google login এখনও configure করা হয়নি।",
      ),
    );
    return;
  }
  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
  })(request, response, next);
});

router.get(
  "/google/callback",
  (request, response, next) => {
    if (!isGoogleAuthEnabled()) {
      response.redirect(`${config.WEB_ORIGIN}/?auth=google_unavailable`);
      return;
    }
    passport.authenticate("google", {
      session: false,
      failureRedirect: `${config.WEB_ORIGIN}/?auth=google_failed`,
    })(request, response, next);
  },
  asyncHandler(async (request, response) => {
    const identity = request.user as unknown as GoogleIdentity | undefined;
    if (!identity) {
      throw new AppError(401, "GOOGLE_LOGIN_FAILED", "Google login সম্পন্ন হয়নি।");
    }

    await assertLoginAllowed(request.clientIp, request.deviceId);
    const user = await findOrCreateGoogleUser(identity);
    const session = await issueSession({
      user,
      ipAddress: request.clientIp,
      deviceId: request.deviceId,
    });
    setSessionCookie(response, session.token);
    response.redirect(`${config.WEB_ORIGIN}/?auth=success`);
  }),
);

export const authRouter = router;
