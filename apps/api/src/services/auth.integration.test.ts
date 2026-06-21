import { count, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { db, pool } from "../db/client.js";
import { adminAuditLogs, authSessions, users } from "../db/schema.js";
import { claimFirstAdmin, issueSession } from "./auth.service.js";
import { assertRegistrationAllowed } from "./ban.service.js";
import { getSettings, updateSettings } from "./settings.service.js";

const runDatabaseTests = process.env.RUN_DB_TESTS === "1";

describe.runIf(runDatabaseTests)("auth database integration", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("creates an authenticated, database-backed guest player", async () => {
    const app = createApp();
    const response = await request(app)
      .post("/api/auth/guest")
      .set("x-device-id", "guest-device-00000001")
      .send({});

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      authenticated: true,
      guest: true,
      user: {
        isGuest: true,
        phone: null,
        mainBalance: "0.00",
        winnerBalance: "0.00",
      },
    });
    expect(response.body.user.name).toMatch(/^Guest \d{5}$/);
    expect(String(response.headers["set-cookie"])).toContain(
      "khan_ludo_session=",
    );

    const userId = response.body.user.id as string;
    try {
      const repeated = await request(app)
        .post("/api/auth/guest")
        .set("x-device-id", "guest-device-00000001")
        .send({});
      expect(repeated.status).toBe(201);
      expect(repeated.body.user.id).toBe(userId);
      const stored = await db.query.users.findFirst({
        where: eq(users.id, userId),
      });
      expect(stored?.isGuest).toBe(true);
    } finally {
      await db.delete(authSessions).where(eq(authSessions.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  it("clears a stale device-bound session without blocking public pages", async () => {
    const [user] = await db
      .insert(users)
      .values({
        gameId: "98881",
        name: "Session Recovery Player",
        phone: "+8801700098881",
        referCode: "RECOVER881",
      })
      .returning();
    const session = await issueSession({
      user: user!,
      ipAddress: "127.0.0.1",
      deviceId: "original-device-0001",
    });
    const cookie = `khan_ludo_session=${session.token}`;
    try {
      const me = await request(createApp())
        .get("/api/auth/me")
        .set("Cookie", cookie)
        .set("x-device-id", "replacement-device-0002");
      expect(me.status).toBe(200);
      expect(me.body.authenticated).toBe(false);
      expect(String(me.headers["set-cookie"])).toContain(
        "khan_ludo_session=;",
      );

      const home = await request(createApp())
        .get("/api/home")
        .set("Cookie", cookie)
        .set("x-device-id", "replacement-device-0002");
      expect(home.status).toBe(200);
      expect(String(home.headers["set-cookie"])).toContain(
        "khan_ludo_session=;",
      );
    } finally {
      await db.delete(authSessions).where(eq(authSessions.userId, user!.id));
      await db.delete(users).where(eq(users.id, user!.id));
    }
  });

  it("does not count guest accounts against the shared network registration limit", async () => {
    const original = await getSettings(["security.max_accounts_per_ip"]);
    const ipAddress = "198.51.100.77";
    const created = await db
      .insert(users)
      .values(
        Array.from({ length: 6 }, (_, index) => ({
          gameId: String(97_000 + index),
          name: `Shared Guest ${index}`,
          referCode: `SHAREG${index}77`,
          isGuest: true,
          ipAddress,
          deviceId: `shared-guest-device-${index}`,
        })),
      )
      .returning({ id: users.id });
    try {
      await updateSettings({ "security.max_accounts_per_ip": "5" });
      await expect(
        assertRegistrationAllowed(ipAddress, "new-real-device-0001"),
      ).resolves.toBeUndefined();
    } finally {
      await updateSettings({
        "security.max_accounts_per_ip":
          original["security.max_accounts_per_ip"] || "100",
      });
      await db.delete(users).where(inArray(users.id, created.map((row) => row.id)));
    }
  });

  it("allows exactly one concurrent first-admin claim and audits it", async () => {
    const userCount = await db.select({ total: count() }).from(users);
    if (userCount[0]?.total !== 0) {
      throw new Error(
        "Integration test requires an empty dedicated PrizeJito.com database.",
      );
    }

    const created = await db
      .insert(users)
      .values([
        {
          gameId: "90001",
          name: "Admin Race One",
          phone: "+8801700000001",
          referCode: "RACEONE001",
        },
        {
          gameId: "90002",
          name: "Admin Race Two",
          phone: "+8801700000002",
          referCode: "RACETWO002",
        },
      ])
      .returning({ id: users.id });
    const userIds = created.map((user) => user.id);

    try {
      const results = await Promise.allSettled([
        claimFirstAdmin(userIds[0]!, "127.0.0.1"),
        claimFirstAdmin(userIds[1]!, "127.0.0.1"),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

      const adminCount = await db
        .select({ admins: count() })
        .from(users)
        .where(eq(users.isAdmin, true));
      const auditCount = await db
        .select({ audits: count() })
        .from(adminAuditLogs)
        .where(eq(adminAuditLogs.action, "admin.first_claim"));

      expect(adminCount[0]?.admins).toBe(1);
      expect(auditCount[0]?.audits).toBe(1);
    } finally {
      await db
        .delete(adminAuditLogs)
        .where(inArray(adminAuditLogs.actorId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
  });
});
