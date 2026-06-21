import type { RequestHandler } from "express";
import { config, isProduction } from "../config.js";
import { asyncHandler } from "../lib/async-handler.js";
import { AppError } from "../lib/errors.js";
import { authenticateSession } from "../services/auth.service.js";

export const adminPermissions = [
  "users",
  "financial",
  "tournaments",
  "support",
] as const;
export type AdminPermission = (typeof adminPermissions)[number];

function clearStaleSession(response: Parameters<RequestHandler>[1]): void {
  response.clearCookie(config.COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
  });
}

export const requireAuth: RequestHandler = asyncHandler(
  async (request, response, next) => {
    const token = request.cookies?.[config.COOKIE_NAME] as string | undefined;
    if (!token) {
      throw new AppError(401, "AUTH_REQUIRED", "এই কাজের জন্য লগইন করুন।");
    }

    let auth;
    try {
      auth = await authenticateSession(token, {
        ipAddress: request.clientIp,
        deviceId: request.deviceId,
      });
    } catch (error) {
      if (
        error instanceof AppError &&
        (error.code === "AUTH_REQUIRED" ||
          error.code === "SESSION_DEVICE_MISMATCH")
      ) {
        clearStaleSession(response);
      }
      throw error;
    }
    request.authUser = auth.user;
    request.authSessionId = auth.sessionId;
    next();
  },
);

export const optionalAuth: RequestHandler = asyncHandler(
  async (request, response, next) => {
    const token = request.cookies?.[config.COOKIE_NAME] as string | undefined;
    if (!token) {
      next();
      return;
    }

    try {
      const auth = await authenticateSession(token, {
        ipAddress: request.clientIp,
        deviceId: request.deviceId,
      });
      request.authUser = auth.user;
      request.authSessionId = auth.sessionId;
    } catch (error) {
      if (
        error instanceof AppError &&
        (error.code === "AUTH_REQUIRED" ||
          error.code === "SESSION_DEVICE_MISMATCH")
      ) {
        clearStaleSession(response);
        next();
        return;
      }
      throw error;
    }
    next();
  },
);

export const requireAdmin: RequestHandler = (request, _response, next) => {
  if (!request.authUser?.isAdmin && !request.authUser?.isSubAdmin) {
    next(new AppError(403, "ADMIN_REQUIRED", "Admin অনুমতি প্রয়োজন।"));
    return;
  }
  next();
};

export const requireMainAdmin: RequestHandler = (
  request,
  _response,
  next,
) => {
  if (!request.authUser?.isAdmin) {
    next(
      new AppError(
        403,
        "MAIN_ADMIN_REQUIRED",
        "Main Admin permission is required.",
      ),
    );
    return;
  }
  next();
};

export function requireAdminPermission(
  permission: AdminPermission,
): RequestHandler {
  return (request, _response, next) => {
    if (request.authUser?.isAdmin) {
      next();
      return;
    }
    if (
      request.authUser?.isSubAdmin &&
      request.authUser.adminPermissions.includes(permission)
    ) {
      next();
      return;
    }
    next(
      new AppError(
        403,
        "ADMIN_PERMISSION_REQUIRED",
        `Admin permission required: ${permission}.`,
      ),
    );
  };
}
