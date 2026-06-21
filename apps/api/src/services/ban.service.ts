import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { bannedDevices, bannedIps, users } from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { getSettings } from "./settings.service.js";

export async function assertRegistrationAllowed(
  ipAddress: string,
  deviceId: string,
): Promise<void> {
  const [limits, ipRows, deviceRows] = await Promise.all([
    getSettings([
      "security.max_accounts_per_ip",
      "security.max_accounts_per_device",
    ]),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(
        and(
          eq(users.ipAddress, ipAddress),
          eq(users.isGuest, false),
          eq(users.isBot, false),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(users)
      .where(
        and(
          eq(users.deviceId, deviceId),
          eq(users.isGuest, false),
          eq(users.isBot, false),
        ),
      ),
  ]);
  const maxIp = Math.max(
    1,
    Number(limits["security.max_accounts_per_ip"] || 100),
  );
  const maxDevice = Math.max(
    1,
    Number(limits["security.max_accounts_per_device"] || 3),
  );
  if ((ipRows[0]?.count ?? 0) >= maxIp) {
    throw new AppError(
      429,
      "IP_ACCOUNT_LIMIT",
      "This network has reached the account creation limit.",
    );
  }
  if ((deviceRows[0]?.count ?? 0) >= maxDevice) {
    throw new AppError(
      429,
      "DEVICE_ACCOUNT_LIMIT",
      "This device has reached the account creation limit.",
    );
  }
}

export async function assertLoginAllowed(
  ipAddress: string,
  deviceId: string,
  userId?: string,
): Promise<void> {
  const [ipBan, deviceBan] = await Promise.all([
    db.query.bannedIps.findFirst({
      where: eq(bannedIps.ipAddress, ipAddress),
      columns: { id: true },
    }),
    db.query.bannedDevices.findFirst({
      where: eq(bannedDevices.deviceId, deviceId),
      columns: { id: true },
    }),
  ]);

  if (ipBan) {
    throw new AppError(403, "IP_BANNED", "এই নেটওয়ার্ক থেকে প্রবেশ বন্ধ করা হয়েছে।");
  }
  if (deviceBan) {
    throw new AppError(403, "DEVICE_BANNED", "এই ডিভাইস থেকে প্রবেশ বন্ধ করা হয়েছে।");
  }

  if (userId) {
    const user = await db.query.users.findFirst({
      where: and(eq(users.id, userId), eq(users.isBanned, true)),
      columns: { id: true },
    });
    if (user) {
      throw new AppError(403, "USER_BANNED", "আপনার অ্যাকাউন্ট বন্ধ করা হয়েছে।");
    }
  }
}
