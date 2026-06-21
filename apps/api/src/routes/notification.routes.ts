import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { requireAuth } from "../middleware/auth.js";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../services/notification.service.js";

const router = Router();
router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (request, response) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(request.query);
    response.json(await listNotifications(request.authUser!.id, query));
  }),
);

router.patch(
  "/read-all",
  asyncHandler(async (request, response) => {
    response.json(await markAllNotificationsRead(request.authUser!.id));
  }),
);

router.patch(
  "/:notificationId/read",
  asyncHandler(async (request, response) => {
    const { notificationId } = z
      .object({ notificationId: z.uuid() })
      .parse(request.params);
    response.json({
      notification: await markNotificationRead(
        request.authUser!.id,
        notificationId,
      ),
    });
  }),
);

export const notificationRouter = router;
