import { randomInt } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { config } from "../config.js";
import { db, pool } from "../db/client.js";
import {
  adminAuditLogs,
  authSessions,
  notifications,
  supportTickets,
  transactions,
  users,
} from "../db/schema.js";
import { issueSession } from "./auth.service.js";

const runDatabaseTests = process.env.RUN_DB_TESTS === "1";

describe.runIf(runDatabaseTests)("Phase 9 admin integration", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("enforces scoped admin permissions and audits user/support actions", async () => {
    const suffix = randomInt(1000, 9999).toString();
    const created = await db
      .insert(users)
      .values([
        {
          gameId: `7${suffix}`,
          name: "Phase Nine Main Admin",
          phone: `+880171900${suffix}`,
          referCode: `P9MAIN${suffix}`,
          isAdmin: true,
        },
        {
          gameId: `8${suffix}`,
          name: "Phase Nine Sub Admin",
          username: `phase9-${suffix}`,
          referCode: `P9SUB${suffix}`,
          isSubAdmin: true,
          adminPermissions: ["users", "support"],
        },
        {
          gameId: `9${suffix}`,
          name: "Phase Nine Player",
          phone: `+880181900${suffix}`,
          referCode: `P9USER${suffix}`,
          mainBalance: "100",
        },
      ])
      .returning();
    const mainAdmin = created[0]!;
    const subAdmin = created[1]!;
    const player = created[2]!;
    const userIds = created.map((user) => user.id);

    try {
      const [mainSession, subSession, playerSession] = await Promise.all([
        issueSession({
          user: mainAdmin,
          ipAddress: "127.0.0.1",
          deviceId: "phase-nine-main-device",
        }),
        issueSession({
          user: subAdmin,
          ipAddress: "127.0.0.1",
          deviceId: "phase-nine-sub-device",
        }),
        issueSession({
          user: player,
          ipAddress: "127.0.0.1",
          deviceId: "phase-nine-player-device",
        }),
      ]);
      const headers = (token: string, deviceId: string) => ({
        Cookie: `${config.COOKIE_NAME}=${token}`,
        "x-device-id": deviceId,
      });
      const mainHeaders = headers(
        mainSession.token,
        "phase-nine-main-device",
      );
      const subHeaders = headers(
        subSession.token,
        "phase-nine-sub-device",
      );
      const playerHeaders = headers(
        playerSession.token,
        "phase-nine-player-device",
      );
      const app = createApp();

      const subUsers = await request(app)
        .get(`/api/admin/users?search=${player.gameId}`)
        .set(subHeaders);
      expect(subUsers.status).toBe(200);
      expect(subUsers.body.users[0].id).toBe(player.id);

      const forbiddenSettings = await request(app)
        .get("/api/admin/settings")
        .set(subHeaders);
      expect(forbiddenSettings.status).toBe(403);
      expect(forbiddenSettings.body.error.code).toBe("MAIN_ADMIN_REQUIRED");

      const forbiddenReport = await request(app)
        .get("/api/admin/reports/financial")
        .set(subHeaders);
      expect(forbiddenReport.status).toBe(403);

      const balance = await request(app)
        .post(`/api/admin/users/${player.id}/balance`)
        .set(subHeaders)
        .send({
          balance: "main",
          operation: "add",
          amount: 25,
          reason: "Phase 9 integration adjustment",
        });
      expect(balance.status).toBe(200);
      expect(balance.body.user.mainBalance).toBe("125.00");

      const ticket = await request(app)
        .post("/api/support")
        .set(playerHeaders)
        .send({
          subject: "Phase 9 support request",
          message: "Please verify the support workflow.",
        });
      expect(ticket.status).toBe(201);

      const supportList = await request(app)
        .get("/api/admin/support")
        .set(subHeaders);
      expect(supportList.status).toBe(200);
      expect(supportList.body.tickets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ticket: expect.objectContaining({ id: ticket.body.ticket.id }),
          }),
        ]),
      );

      const reply = await request(app)
        .patch(`/api/admin/support/${ticket.body.ticket.id}`)
        .set(subHeaders)
        .send({
          status: "resolved",
          reply: "Your request has been resolved.",
          assignedTo: subAdmin.id,
        });
      expect(reply.status).toBe(200);
      expect(reply.body.ticket.status).toBe("resolved");

      const dashboard = await request(app)
        .get("/api/admin/dashboard")
        .set(mainHeaders);
      expect(dashboard.status).toBe(200);
      expect(dashboard.body.stats.totalUsers).toBeGreaterThanOrEqual(3);

      const [adjustment, audit, notice] = await Promise.all([
        db.query.transactions.findFirst({
          where: and(
            eq(transactions.userId, player.id),
            eq(transactions.type, "bonus"),
          ),
        }),
        db.query.adminAuditLogs.findFirst({
          where: and(
            eq(adminAuditLogs.actorId, subAdmin.id),
            eq(adminAuditLogs.action, "user.balance.adjust"),
          ),
        }),
        db.query.notifications.findFirst({
          where: and(
            eq(notifications.userId, player.id),
            eq(notifications.title, "Support reply"),
          ),
        }),
      ]);
      expect(adjustment?.amount).toBe("25.00");
      expect(audit?.targetId).toBe(player.id);
      expect(notice?.message).toBe("Your request has been resolved.");
    } finally {
      await db
        .delete(notifications)
        .where(inArray(notifications.userId, userIds));
      await db
        .delete(supportTickets)
        .where(inArray(supportTickets.userId, userIds));
      await db
        .delete(transactions)
        .where(inArray(transactions.userId, userIds));
      await db
        .delete(adminAuditLogs)
        .where(inArray(adminAuditLogs.actorId, userIds));
      await db
        .delete(authSessions)
        .where(inArray(authSessions.userId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
  });
});
