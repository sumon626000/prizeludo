import { and, isNotNull, lt, or } from "drizzle-orm";
import { db } from "../db/client.js";
import { authSessions, gameMessages, notifications } from "../db/schema.js";
import { withPostgresAdvisoryLock } from "../lib/distributed-lock.js";

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

export async function runDataRetention(now = new Date()) {
  return withPostgresAdvisoryLock(1_071_005, async () => {
    const revokedCutoff = new Date(now.getTime() - 7 * DAY_MS);
    const gameMessageCutoff = new Date(now.getTime() - 30 * DAY_MS);
    const readNotificationCutoff = new Date(now.getTime() - 90 * DAY_MS);

    await db
      .delete(authSessions)
      .where(
        or(
          lt(authSessions.expiresAt, now),
          and(
            isNotNull(authSessions.revokedAt),
            lt(authSessions.revokedAt, revokedCutoff),
          ),
        ),
      );
    await db
      .delete(gameMessages)
      .where(lt(gameMessages.createdAt, gameMessageCutoff));
    await db
      .delete(notifications)
      .where(
        and(
          notifications.isRead,
          lt(notifications.createdAt, readNotificationCutoff),
        ),
      );
  });
}

export interface MaintenanceScheduler {
  stop: () => void;
  tick: () => Promise<void>;
}

export function startMaintenanceScheduler(): MaintenanceScheduler {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runDataRetention();
    } catch (error) {
      console.error("Data retention job failed", error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 6 * HOUR_MS);
  timer.unref();
  void tick();
  return { stop: () => clearInterval(timer), tick };
}
