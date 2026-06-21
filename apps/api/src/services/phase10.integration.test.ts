import { randomInt } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { db, pool } from "../db/client.js";
import { notifications, users } from "../db/schema.js";

const runDatabaseTests = process.env.RUN_DB_TESTS === "1";

describe.runIf(runDatabaseTests)("Phase 10 integration", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("registers without OTP and manages the authenticated notification center", async () => {
    const suffix = randomInt(10000, 99999).toString();
    const deviceId = `phase-ten-device-${suffix}`;
    const [referrer] = await db
      .insert(users)
      .values({
        gameId: suffix,
        name: "Phase Ten Referrer",
        phone: `+88016${suffix}000`,
        referCode: `PT${suffix}`,
      })
      .returning();
    expect(referrer).toBeDefined();

    const app = createApp();
    let registeredUserId = "";

    try {
      const registration = await request(app)
        .post("/api/auth/register")
        .set("x-device-id", deviceId)
        .send({
          name: "Phase Ten Player",
          phone: `017${suffix}000`,
          email: `phase10-${suffix}@example.com`,
          password: "DirectPass10",
          referCode: referrer!.referCode,
        });

      expect(registration.status).toBe(201);
      expect(registration.body.user).toEqual(
        expect.objectContaining({
          name: "Phase Ten Player",
          email: `phase10-${suffix}@example.com`,
        }),
      );
      expect(registration.headers["set-cookie"]?.[0]).toContain(
        "khan_ludo_session=",
      );

      registeredUserId = registration.body.user.id as string;
      const registered = await db.query.users.findFirst({
        where: eq(users.id, registeredUserId),
      });
      expect(registered?.passwordHash).toMatch(/^\$2[aby]\$/);
      expect(registered?.referredBy).toBe(referrer!.id);

      const cookie = registration.headers["set-cookie"]![0]!.split(";")[0]!;
      const createdNotifications = await db
        .insert(notifications)
        .values([
          {
            userId: registeredUserId,
            title: "Tournament ready",
            message: "Your match is ready.",
          },
          {
            userId: registeredUserId,
            title: "Deposit approved",
            message: "Your deposit was approved.",
          },
        ])
        .returning();

      const list = await request(app)
        .get("/api/notifications")
        .set("Cookie", cookie)
        .set("x-device-id", deviceId);
      expect(list.status).toBe(200);
      expect(list.body.unreadCount).toBe(2);
      expect(list.body.items).toHaveLength(2);

      const markOne = await request(app)
        .patch(`/api/notifications/${createdNotifications[0]!.id}/read`)
        .set("Cookie", cookie)
        .set("x-device-id", deviceId)
        .send({});
      expect(markOne.status).toBe(200);
      expect(markOne.body.notification.isRead).toBe(true);

      const markAll = await request(app)
        .patch("/api/notifications/read-all")
        .set("Cookie", cookie)
        .set("x-device-id", deviceId)
        .send({});
      expect(markAll.status).toBe(200);
      expect(markAll.body.updated).toBe(1);

      const refreshed = await request(app)
        .get("/api/notifications")
        .set("Cookie", cookie)
        .set("x-device-id", deviceId);
      expect(refreshed.body.unreadCount).toBe(0);

      const duplicate = await request(app)
        .post("/api/auth/register")
        .set("x-device-id", `phase-ten-duplicate-${suffix}`)
        .send({
          name: "Duplicate Player",
          phone: `017${suffix}000`,
          password: "DirectPass10",
        });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error.code).toBe("PHONE_EXISTS");

      const oldRequest = await request(app)
        .post("/api/auth/register/request-otp")
        .set("x-device-id", deviceId)
        .send({});
      const oldVerify = await request(app)
        .post("/api/auth/register/verify")
        .set("x-device-id", deviceId)
        .send({});
      expect(oldRequest.status).toBe(404);
      expect(oldVerify.status).toBe(404);
    } finally {
      if (registeredUserId) {
        await db.delete(users).where(eq(users.id, registeredUserId));
      }
      await db
        .delete(users)
        .where(inArray(users.id, [referrer!.id]));
    }
  });
});
