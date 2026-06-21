import { randomInt } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import request from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { config } from "../config.js";
import { db, pool } from "../db/client.js";
import {
  adminAuditLogs,
  matches,
  matchPlayers,
  tournamentEntries,
  tournaments,
  transactions,
  users,
} from "../db/schema.js";
import { issueSession } from "./auth.service.js";

const runDatabaseTests = process.env.RUN_DB_TESTS === "1";

describe.runIf(runDatabaseTests)("Phase 3 profile integration", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("serves database-derived stats and history with secure profile edits", async () => {
    const suffix = randomInt(1000, 9999).toString();
    const initialPhone = `+880171000${suffix}`;
    const changedPhone = `+880181000${suffix}`;
    const createdUsers = await db
      .insert(users)
      .values([
        {
          gameId: `4${suffix}`,
          name: "Phase Three Player",
          phone: initialPhone,
          email: `phase-three-${suffix}@example.com`,
          referCode: `PLAYER${suffix}`,
        },
        {
          gameId: `5${suffix}`,
          name: "Profile Admin",
          phone: `+880191000${suffix}`,
          referCode: `ADMIN${suffix}`,
          isAdmin: true,
        },
      ])
      .returning();
    const player = createdUsers[0]!;
    const admin = createdUsers[1]!;
    const [referredUser] = await db
      .insert(users)
      .values({
        gameId: `6${suffix}`,
        name: "Referred Player",
        phone: `+880161000${suffix}`,
        referCode: `REFER${suffix}`,
        referredBy: player.id,
      })
      .returning();
    expect(referredUser).toBeDefined();
    const allUserIds = [player.id, admin.id, referredUser!.id];

    const [tournament] = await db
      .insert(tournaments)
      .values({
        title: "Phase Three Masters",
        playerCount: 4,
        boardType: "4p",
        gameMode: "master",
        type: "paid",
        joinFee: "50",
        prizePool: "800",
        status: "completed",
      })
      .returning();
    expect(tournament).toBeDefined();

    await db.insert(tournamentEntries).values({
      tournamentId: tournament!.id,
      userId: player.id,
      status: "eliminated",
      finishPosition: 2,
      prizeEarned: "300",
    });

    const baseTime = Date.now() - 60_000;
    const createdMatches = await db
      .insert(matches)
      .values([
        {
          tournamentId: tournament!.id,
          round: 1,
          player1Id: player.id,
          player2Id: admin.id,
          winnerId: player.id,
          status: "completed",
          endedAt: new Date(baseTime + 1_000),
        },
        {
          tournamentId: tournament!.id,
          round: 2,
          player1Id: player.id,
          player2Id: admin.id,
          winnerId: player.id,
          status: "completed",
          endedAt: new Date(baseTime + 2_000),
        },
        {
          tournamentId: tournament!.id,
          round: 3,
          player1Id: player.id,
          player2Id: admin.id,
          winnerId: admin.id,
          status: "completed",
          endedAt: new Date(baseTime + 3_000),
        },
        {
          tournamentId: tournament!.id,
          round: 4,
          player1Id: player.id,
          player2Id: admin.id,
          winnerId: player.id,
          status: "completed",
          endedAt: new Date(baseTime + 4_000),
        },
      ])
      .returning({ id: matches.id });
    await db.insert(matchPlayers).values(
      createdMatches.flatMap((match) => [
        { matchId: match.id, userId: player.id, seat: 1 },
        { matchId: match.id, userId: admin.id, seat: 2 },
      ]),
    );

    await db.insert(transactions).values([
      {
        userId: player.id,
        type: "prize",
        amount: "300",
        status: "paid",
        relatedTournamentId: tournament!.id,
        reference: `prize-${suffix}`,
      },
      {
        userId: admin.id,
        type: "prize",
        amount: "500",
        status: "success",
        reference: `rank-${suffix}`,
      },
      {
        userId: player.id,
        type: "deposit",
        amount: "500",
        status: "success",
        method: "bKash",
        bonusAmount: "50",
        reference: `deposit-${suffix}`,
      },
      {
        userId: player.id,
        type: "withdraw",
        amount: "120",
        status: "approved",
        method: "Nagad",
        reference: `withdraw-${suffix}`,
      },
      {
        userId: player.id,
        type: "refer",
        amount: "25",
        status: "success",
        direction: "incoming",
        relatedUserId: referredUser!.id,
        reference: `refer-${suffix}`,
      },
      {
        userId: player.id,
        type: "transfer",
        amount: "100",
        status: "success",
        direction: "outgoing",
        relatedUserId: admin.id,
        commissionAmount: "5",
        reference: `transfer-${suffix}`,
      },
      {
        userId: referredUser!.id,
        type: "deposit",
        amount: "200",
        status: "paid",
        method: "Rocket",
        reference: `referred-deposit-${suffix}`,
      },
    ]);

    const playerSession = await issueSession({
      user: player,
      ipAddress: "127.0.0.1",
      deviceId: "phase-three-player-device",
    });
    const adminSession = await issueSession({
      user: admin,
      ipAddress: "127.0.0.1",
      deviceId: "phase-three-admin-device",
    });
    const playerHeaders = {
      Cookie: `${config.COOKIE_NAME}=${playerSession.token}`,
      "x-device-id": "phase-three-player-device",
    };
    const adminHeaders = {
      Cookie: `${config.COOKIE_NAME}=${adminSession.token}`,
      "x-device-id": "phase-three-admin-device",
    };
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const app = createApp();
    app.set("io", { to });

    try {
      const profile = await request(app)
        .get("/api/profile")
        .set(playerHeaders);
      expect(profile.status).toBe(200);
      expect(profile.body.user.gameId).toBe(player.gameId);
      expect(profile.body.avatarOptions).toHaveLength(20);

      const updated = await request(app)
        .patch("/api/profile")
        .set(playerHeaders)
        .send({
          name: "Updated Phase Three",
          email: `updated-${suffix}@example.com`,
          avatar: "/avatars/face-03.svg",
        });
      expect(updated.status).toBe(200);
      expect(updated.body.user).toEqual(
        expect.objectContaining({
          gameId: player.gameId,
          name: "Updated Phase Three",
          avatar: "/avatars/face-03.svg",
        }),
      );
      expect(to).toHaveBeenCalledWith(`user:${player.id}`);
      expect(emit).toHaveBeenCalledWith(
        "profile:update",
        expect.objectContaining({ id: player.id }),
      );

      const gameIdEdit = await request(app)
        .patch("/api/profile")
        .set(playerHeaders)
        .send({ gameId: "99999" });
      expect(gameIdEdit.status).toBe(400);

      const stats = await request(app)
        .get("/api/profile/stats")
        .set(playerHeaders);
      expect(stats.status).toBe(200);
      expect(stats.body.stats).toEqual({
        totalGames: 4,
        totalWins: 3,
        totalLosses: 1,
        winRate: 75,
        totalEarnings: "300.00",
        currentRank: 2,
        highestWinStreak: 2,
        bestTournamentFinish: 2,
      });

      const tournamentHistory = await request(app)
        .get("/api/profile/history/tournament")
        .set(playerHeaders);
      expect(tournamentHistory.body.items[0]).toEqual(
        expect.objectContaining({
          title: "Phase Three Masters",
          gameMode: "master",
          joinFee: "50.00",
          finishPosition: 2,
          prizeEarned: "300.00",
          result: "loss",
        }),
      );

      const depositHistory = await request(app)
        .get("/api/profile/history/deposit")
        .set(playerHeaders);
      expect(depositHistory.body.items[0]).toEqual(
        expect.objectContaining({
          amount: "500.00",
          bonusAmount: "50.00",
          method: "bKash",
          status: "success",
        }),
      );

      const withdrawHistory = await request(app)
        .get("/api/profile/history/withdraw")
        .set(playerHeaders);
      expect(withdrawHistory.body.items[0]).toEqual(
        expect.objectContaining({
          amount: "120.00",
          method: "Nagad",
          status: "approved",
        }),
      );

      const referralHistory = await request(app)
        .get("/api/profile/history/refer")
        .set(playerHeaders);
      expect(referralHistory.body).toEqual(
        expect.objectContaining({
          totalReferCount: 1,
          totalReferIncome: "25.00",
          items: [
            expect.objectContaining({
              name: "Referred Player",
              depositAmount: "200.00",
              commissionEarned: "25.00",
            }),
          ],
        }),
      );

      const transferHistory = await request(app)
        .get("/api/profile/history/transfer")
        .set(playerHeaders);
      expect(transferHistory.body.items[0]).toEqual(
        expect.objectContaining({
          amount: "100.00",
          commissionAmount: "5.00",
          direction: "outgoing",
          otherParty: expect.objectContaining({
            name: "Profile Admin",
            gameId: admin.gameId,
          }),
        }),
      );

      const phoneChange = await request(app)
        .patch("/api/profile")
        .set(playerHeaders)
        .send({ phone: changedPhone });
      expect(phoneChange.status).toBe(200);
      expect(phoneChange.body.user.phone).toBe(changedPhone);

      const adminEdit = await request(app)
        .patch(`/api/profile/admin/${player.id}`)
        .set(adminHeaders)
        .send({ name: "Admin Edited Player" });
      expect(adminEdit.status).toBe(200);
      expect(adminEdit.body.user).toEqual(
        expect.objectContaining({
          name: "Admin Edited Player",
          gameId: player.gameId,
        }),
      );

      const forbiddenAdminGameIdEdit = await request(app)
        .patch(`/api/profile/admin/${player.id}`)
        .set(adminHeaders)
        .send({ gameId: "88888" });
      expect(forbiddenAdminGameIdEdit.status).toBe(400);

      const audit = await db.query.adminAuditLogs.findFirst({
        where: and(
          eq(adminAuditLogs.actorId, admin.id),
          eq(adminAuditLogs.targetId, player.id),
          eq(adminAuditLogs.action, "user.profile.update"),
        ),
      });
      expect(audit).toBeDefined();
    } finally {
      await db
        .delete(adminAuditLogs)
        .where(inArray(adminAuditLogs.actorId, allUserIds));
      await db
        .delete(transactions)
        .where(inArray(transactions.userId, allUserIds));
      await db.delete(tournaments).where(eq(tournaments.id, tournament!.id));
      await db.delete(users).where(inArray(users.id, allUserIds));
    }
  });
});
