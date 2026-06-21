import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { requireAuth } from "../middleware/auth.js";
import {
  createSupportTicket,
  listUserSupportTickets,
} from "../services/admin.service.js";

const router = Router();
router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (request, response) => {
    response.json({
      tickets: await listUserSupportTickets(request.authUser!.id),
    });
  }),
);

router.post(
  "/",
  asyncHandler(async (request, response) => {
    const input = z
      .object({
        subject: z.string().trim().min(3).max(180),
        message: z.string().trim().min(5).max(5_000),
      })
      .strict()
      .parse(request.body);
    response.status(201).json({
      ticket: await createSupportTicket({
        ...input,
        userId: request.authUser!.id,
      }),
    });
  }),
);

export const supportRouter = router;
