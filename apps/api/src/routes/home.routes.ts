import { Router } from "express";
import type { Server } from "socket.io";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import {
  optionalAuth,
  requireMainAdmin,
  requireAuth,
} from "../middleware/auth.js";
import {
  getHomeSnapshot,
  type HomeRealtimeScheduler,
  preRegisterTournament,
} from "../services/home.service.js";
import {
  getSetting,
  updateSettingsWithAudit,
} from "../services/settings.service.js";

const router = Router();

const relativeOrUrl = z.string().refine((value) => {
  if (value === "") return true;
  if (value.startsWith("/")) return !value.startsWith("//");
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}, "Must be an HTTP(S) URL or a root-relative path.");

const adminHomeSettingsSchema = z
  .object({
    siteName: z.string().min(2).max(80).optional(),
    logoUrl: relativeOrUrl.optional(),
    maxWinAmount: z.number().int().min(0).max(100_000_000).optional(),
    marqueeSpeedSeconds: z.number().int().min(8).max(120).optional(),
    marqueeIntervalSeconds: z.number().int().min(30).max(3600).optional(),
    promotionalWinsEnabled: z.boolean().optional(),
    marqueeCustomItems: z
      .array(
        z.object({
          name: z.string().min(2).max(80),
          amount: z.number().positive().max(100_000_000),
        }),
      )
      .max(20)
      .optional(),
    telegramUrl: relativeOrUrl.optional(),
    whatsappUrl: relativeOrUrl.optional(),
    facebookUrl: relativeOrUrl.optional(),
    termsText: z.string().min(20).max(30_000).optional(),
    privacyText: z.string().min(20).max(30_000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one setting is required.",
  });

router.get(
  "/",
  optionalAuth,
  asyncHandler(async (request, response) => {
    response.json(await getHomeSnapshot(request.authUser?.id));
  }),
);

router.post(
  "/tournaments/:tournamentId/pre-register",
  requireAuth,
  asyncHandler(async (request, response) => {
    const { tournamentId } = z
      .object({ tournamentId: z.uuid() })
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
    io?.emit("home:tournament-update", {
      tournamentId,
      reason: "pre-registration",
    });
    response.status(201).json({
      entry: result.entry,
      notification: result.notification,
      alreadyRegistered: result.alreadyRegistered,
    });
  }),
);

router.get(
  "/legal/:document",
  asyncHandler(async (request, response) => {
    const { document } = z
      .object({ document: z.enum(["terms", "privacy"]) })
      .parse(request.params);
    const key =
      document === "terms" ? "legal.terms_text" : "legal.privacy_text";
    response.json({ document, content: await getSetting(key) });
  }),
);

router.patch(
  "/admin/settings",
  requireAuth,
  requireMainAdmin,
  asyncHandler(async (request, response) => {
    const input = adminHomeSettingsSchema.parse(request.body);
    const updates: Record<string, string> = {};
    if (input.siteName !== undefined) updates["site.name"] = input.siteName;
    if (input.logoUrl !== undefined) updates["site.logo_url"] = input.logoUrl;
    if (input.maxWinAmount !== undefined) {
      updates["home.max_win_amount"] = String(input.maxWinAmount);
    }
    if (input.marqueeSpeedSeconds !== undefined) {
      updates["home.marquee_speed_seconds"] = String(input.marqueeSpeedSeconds);
    }
    if (input.marqueeIntervalSeconds !== undefined) {
      updates["home.marquee_interval_seconds"] = String(
        input.marqueeIntervalSeconds,
      );
    }
    if (input.promotionalWinsEnabled !== undefined) {
      updates["home.promotional_wins_enabled"] = String(
        input.promotionalWinsEnabled,
      );
    }
    if (input.marqueeCustomItems !== undefined) {
      updates["home.marquee_custom_items"] = JSON.stringify(
        input.marqueeCustomItems,
      );
    }
    if (input.telegramUrl !== undefined) {
      updates["social.telegram_url"] = input.telegramUrl;
    }
    if (input.whatsappUrl !== undefined) {
      updates["social.whatsapp_url"] = input.whatsappUrl;
    }
    if (input.facebookUrl !== undefined) {
      updates["social.facebook_url"] = input.facebookUrl;
    }
    if (input.termsText !== undefined) {
      updates["legal.terms_text"] = input.termsText;
    }
    if (input.privacyText !== undefined) {
      updates["legal.privacy_text"] = input.privacyText;
    }

    await updateSettingsWithAudit({
      values: updates,
      actorId: request.authUser!.id,
      ipAddress: request.clientIp,
    });
    const scheduler = request.app.get(
      "homeScheduler",
    ) as HomeRealtimeScheduler | undefined;
    await scheduler?.reschedule();

    const io = request.app.get("io") as Server | undefined;
    const snapshot = await getHomeSnapshot();
    io?.emit("home:settings-update", snapshot.settings);
    io?.emit("home:update", snapshot);
    io?.emit("admin:theme-update", snapshot.settings);
    response.json({ settings: snapshot.settings });
  }),
);

export const homeRouter = router;
