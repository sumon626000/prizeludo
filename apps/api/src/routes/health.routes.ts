import { sql } from "drizzle-orm";
import { Router } from "express";
import { db } from "../db/client.js";
import { asyncHandler } from "../lib/async-handler.js";

const router = Router();

router.get(
  "/health",
  asyncHandler(async (_request, response) => {
    await db.execute(sql`select 1`);
    response.json({
      status: "ok",
      service: "prizejito-api",
      timestamp: new Date().toISOString(),
    });
  }),
);

export const healthRouter = router;
