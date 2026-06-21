import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler.js";
import { optionalAuth } from "../middleware/auth.js";
import { getLeaderboard } from "../services/leaderboard.service.js";

const router = Router();

router.get(
  "/",
  optionalAuth,
  asyncHandler(async (request, response) => {
    const { period } = z
      .object({
        period: z
          .enum(["daily", "weekly", "monthly", "all"])
          .default("all"),
      })
      .parse(request.query);
    response.json(
      await getLeaderboard(period, request.authUser?.id),
    );
  }),
);

export const leaderboardRouter = router;
