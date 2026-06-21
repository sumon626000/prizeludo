import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { config, isProduction } from "../config.js";
import { sha256 } from "../lib/crypto.js";
import type { RequestHandler } from "express";

export function normalizeIp(value: string | undefined): string {
  if (!value) return "unknown";
  return value.replace(/^::ffff:/, "").slice(0, 64);
}

export const deviceCookieName = `${config.COOKIE_NAME}_device`;

function deviceSignature(deviceId: string): string {
  return createHmac("sha256", config.JWT_SECRET).update(deviceId).digest("hex");
}

function encodeDeviceCookie(deviceId: string): string {
  return `${deviceId}.${deviceSignature(deviceId)}`;
}

export function verifyDeviceCookie(value: string | undefined): string | null {
  if (!value) return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0) return null;
  const deviceId = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  if (!/^[A-Za-z0-9-]{12,128}$/.test(deviceId) || !/^[a-f0-9]{64}$/.test(signature)) {
    return null;
  }
  const expected = Buffer.from(deviceSignature(deviceId), "hex");
  const actual = Buffer.from(signature, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual)
    ? deviceId
    : null;
}

export const requestContext: RequestHandler = (request, response, next) => {
  const explicitDeviceId = request.header("x-device-id")?.trim();
  const fallbackSeed = `${request.ip ?? ""}:${request.header("user-agent") ?? ""}`;
  const signedDeviceId = verifyDeviceCookie(
    request.cookies?.[deviceCookieName] as string | undefined,
  );
  const generatedDeviceId = randomUUID();

  request.clientIp = normalizeIp(request.ip);
  request.deviceId =
    signedDeviceId ??
    (!isProduction && explicitDeviceId && explicitDeviceId.length >= 12
      ? explicitDeviceId.slice(0, 128)
      : isProduction
        ? generatedDeviceId
        : `fallback-${sha256(fallbackSeed).slice(0, 48)}`);

  if (!signedDeviceId) {
    response.cookie(deviceCookieName, encodeDeviceCookie(request.deviceId), {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      maxAge: 365 * 24 * 60 * 60 * 1_000,
      path: "/",
    });
  }

  next();
};
