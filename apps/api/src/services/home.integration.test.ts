import { randomInt } from "node:crypto";
import { and, count, eq, inArray } from "drizzle-orm";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { config } from "../config.js";
import { db, pool } from "../db/client.js";
import {
  adminAuditLogs,
  notifications,
  tournamentEntries,
  tournaments,
  transactions,
  users,
} from "../db/schema.js";
import { issueSession } from "./auth.service.js";
import { ensureHomeDefaults, updateSettings } from "./settings.service.js";

const runDatabaseTests = process.env.RUN_DB_TESTS === "1";

describe.runIf(runDatabaseTests)("Phase 2 home integration", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("serves real winners, slots, settings and authenticated pre-registration", async () => {
    await ensureHomeDefaults();
    const suffix = randomInt(1000, 9999).toString();
    const [user] = await db
      .insert(users)
      .values({
        gameId: `7${suffix}`,
        name: "Phase Two Player",
        phone: `+88017000${suffix}`,
        referCode: `PHTWO${suffix}`,
        isAdmin: true,
      })
      .returning();
    expect(user).toBeDefined();

    const now = Date.now();
    const createdTournaments = await db
      .insert(tournaments)
      .values([
        {
          title: "Live Integration Cup",
          playerCount: 4,
          boardType: "4p",
          gameMode: "classic",
          type: "paid",
          joinFee: "50",
          prizePool: "180",
          status: "waiting",
          countdownEndsAt: new Date(now + 60_000),
        },
        {
          title: "Upcoming Integration Cup",
          playerCount: 8,
          boardType: "2p",
          gameMode: "quick",
          type: "free",
          joinFee: "0",
          prizePool: "500",
          status: "upcoming",
          startsAt: new Date(now + 3_600_000),
        },
      ])
      .returning();
    const liveTournament = createdTournaments[0]!;
    const upcomingTournament = createdTournaments[1]!;

    await db.insert(tournamentEntries).values({
      tournamentId: liveTournament.id,
      userId: user!.id,
      status: "joined",
    });
    await db.insert(transactions).values({
      userId: user!.id,
      type: "prize",
      amount: "500",
      status: "success",
      reference: `phase-two-${suffix}`,
    });
    await db.insert(notifications).values({
      userId: user!.id,
      title: "Integration notice",
      message: "Unread notification",
    });

    const session = await issueSession({
      user: user!,
      ipAddress: "127.0.0.1",
      deviceId: "phase-two-test-device",
    });
    const cookie = `${config.COOKIE_NAME}=${session.token}`;
    const app = createApp();

    try {
      const home = await request(app)
        .get("/api/home")
        .set("Cookie", cookie)
        .set("x-device-id", "phase-two-test-device");

      expect(home.status).toBe(200);
      expect(home.body.winners).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "Phase Two Player",
            amount: "500.00",
            isPromotional: false,
          }),
        ]),
      );
      expect(home.body.leaderboard).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Phase Two Player" }),
        ]),
      );
      expect(home.body.tournaments[0]).toEqual(
        expect.objectContaining({
          title: "Live Integration Cup",
          joinedCount: 1,
        }),
      );
      expect(home.body.unreadNotifications).toBe(1);

      const registration = await request(app)
        .post(
          `/api/home/tournaments/${upcomingTournament.id}/pre-register`,
        )
        .set("Cookie", cookie)
        .set("x-device-id", "phase-two-test-device")
        .send({});
      expect(registration.status).toBe(201);
      expect(registration.body.entry.status).toBe("pre_registered");
      expect(registration.body.alreadyRegistered).toBe(false);

      const duplicateRegistration = await request(app)
        .post(
          `/api/home/tournaments/${upcomingTournament.id}/pre-register`,
        )
        .set("Cookie", cookie)
        .set("x-device-id", "phase-two-test-device")
        .send({});
      expect(duplicateRegistration.status).toBe(201);
      expect(duplicateRegistration.body.alreadyRegistered).toBe(true);

      const notificationCount = await db
        .select({ total: count() })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, user!.id),
            eq(notifications.title, "Pre-registration সম্পন্ন"),
          ),
        );
      expect(notificationCount[0]?.total).toBe(1);

      const refreshed = await request(app)
        .get("/api/home")
        .set("Cookie", cookie)
        .set("x-device-id", "phase-two-test-device");
      expect(refreshed.body.upcomingTournaments[0]).toEqual(
        expect.objectContaining({
          title: "Upcoming Integration Cup",
          isPreRegistered: true,
        }),
      );

      const settingsUpdate = await request(app)
        .patch("/api/home/admin/settings")
        .set("Cookie", cookie)
        .set("x-device-id", "phase-two-test-device")
        .send({
          siteName: "PrizeJito.com Live",
          maxWinAmount: 25000,
          marqueeCustomItems: [{ name: "Admin Promo", amount: 900 }],
        });
      expect(settingsUpdate.status).toBe(200);
      expect(settingsUpdate.body.settings).toEqual(
        expect.objectContaining({
          siteName: "PrizeJito.com Live",
          maxWinAmount: 25000,
        }),
      );

      const customized = await request(app).get("/api/home");
      expect(customized.body.winners[0]).toEqual(
        expect.objectContaining({
          name: "Admin Promo",
          amount: "900",
          isPromotional: true,
        }),
      );

      const unsafeUrl = await request(app)
        .patch("/api/home/admin/settings")
        .set("Cookie", cookie)
        .set("x-device-id", "phase-two-test-device")
        .send({ logoUrl: "javascript:alert(1)" });
      expect(unsafeUrl.status).toBe(400);
    } finally {
      await updateSettings({
        "site.name": "PrizeJito.com",
        "home.max_win_amount": "10000",
        "home.marquee_custom_items": "[]",
      });
      await db
        .delete(adminAuditLogs)
        .where(eq(adminAuditLogs.actorId, user!.id));
      await db
        .delete(transactions)
        .where(eq(transactions.userId, user!.id));
      await db
        .delete(tournamentEntries)
        .where(eq(tournamentEntries.userId, user!.id));
      await db
        .delete(tournaments)
        .where(
          inArray(
            tournaments.id,
            createdTournaments.map((tournament) => tournament.id),
          ),
        );
      await db.delete(users).where(eq(users.id, user!.id));
    }
  });
});
