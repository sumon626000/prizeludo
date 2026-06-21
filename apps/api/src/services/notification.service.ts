import { and, count, desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { notifications } from "../db/schema.js";
import { AppError } from "../lib/errors.js";

export async function listNotifications(
  userId: string,
  input: { limit: number; offset: number },
) {
  const [items, unreadRows] = await Promise.all([
    db.query.notifications.findMany({
      where: eq(notifications.userId, userId),
      orderBy: [desc(notifications.createdAt)],
      limit: input.limit,
      offset: input.offset,
    }),
    db
      .select({ total: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.isRead, false),
        ),
      ),
  ]);

  return {
    items,
    unreadCount: Number(unreadRows[0]?.total ?? 0),
    limit: input.limit,
    offset: input.offset,
  };
}

export async function markNotificationRead(
  userId: string,
  notificationId: string,
) {
  const [updated] = await db
    .update(notifications)
    .set({ isRead: true })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, userId),
      ),
    )
    .returning();

  if (!updated) {
    throw new AppError(
      404,
      "NOTIFICATION_NOT_FOUND",
      "Notification was not found.",
    );
  }
  return updated;
}

export async function markAllNotificationsRead(userId: string) {
  const updated = await db
    .update(notifications)
    .set({ isRead: true })
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.isRead, false),
      ),
    )
    .returning({ id: notifications.id });

  return { updated: updated.length };
}
