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
  broadcastAdminNotice,
  getRealtimeState,
  updateMaintenanceMode,
} from "../services/realtime.service.js";

const router = Router();

router.get(
  "/state",
  optionalAuth,
  asyncHandler(async (request, response) => {
    response.json(await getRealtimeState(request.authUser?.id));
  }),
);

router.post(
  "/admin/notice",
  requireAuth,
  requireMainAdmin,
  asyncHandler(async (request, response) => {
    const input = z
      .object({
        title: z.string().trim().min(2).max(160),
        message: z.string().trim().min(2).max(2_000),
      })
      .strict()
      .parse(request.body);
    response.status(201).json(
      await broadcastAdminNotice({
        io: request.app.get("io") as Server | undefined,
        ...input,
      }),
    );
  }),
);

router.put(
  "/admin/maintenance",
  requireAuth,
  requireMainAdmin,
  asyncHandler(async (request, response) => {
    const input = z
      .object({
        enabled: z.boolean(),
        message: z.string().trim().min(2).max(500),
      })
      .strict()
      .parse(request.body);
    response.json({
      maintenance: await updateMaintenanceMode({
        io: request.app.get("io") as Server | undefined,
        ...input,
        actorId: request.authUser!.id,
        ipAddress: request.clientIp,
      }),
    });
  }),
);

export const realtimeRouter = router;
