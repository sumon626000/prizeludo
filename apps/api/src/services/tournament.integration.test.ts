import { randomInt } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, pool } from "../db/client.js";
import {
  adminAuditLogs,
  matches,
  tournamentEntries,
  tournaments,
  transactions,
  users,
} from "../db/schema.js";
import {
  completeMatch,
  createTournament,
  joinTournament,
  leaveTournament,
  listTournaments,
  processTournamentTick,
} from "./tournament.service.js";

const runDatabaseTests = process.env.RUN_DB_TESTS === "1";

describe.runIf(runDatabaseTests)("Phase 5 tournament integration", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("handles paid entry, one-active enforcement, countdown, prizes, and refunds", async () => {
    const suffix = randomInt(1000, 9999).toString();
    const createdUsers = await db
      .insert(users)
      .values([
        {
          gameId: `5${suffix}`,
          name: "Tournament Admin",
          phone: `+880191100${suffix}`,
          referCode: `TA${suffix}`,
          isAdmin: true,
        },
        {
          gameId: `6${suffix}`,
          name: "Tournament Winner",
          phone: `+880171100${suffix}`,
          referCode: `TW${suffix}`,
          mainBalance: "30",
          winnerBalance: "200",
        },
        {
          gameId: `7${suffix}`,
          name: "Tournament Runner",
          phone: `+880181100${suffix}`,
          referCode: `TR${suffix}`,
          mainBalance: "500",
        },
        {
          gameId: `8${suffix}`,
          name: "Tournament Waiting",
          phone: `+880161100${suffix}`,
          referCode: `TX${suffix}`,
          mainBalance: "500",
        },
      ])
      .returning();
    const [admin, winner, runner, waitingPlayer] = createdUsers;
    const userIds = createdUsers.map((user) => user.id);
    const tournamentIds: string[] = [];

    try {
      const primary = await createTournament({
        actorId: admin!.id,
        ipAddress: `127.0.1.${suffix.slice(-1)}`,
        tournament: {
          title: `Paid Final ${suffix}`,
          playerCount: 2,
          boardType: "2p",
          gameMode: "classic",
          type: "paid",
          joinFee: 50,
          prizePool: 500,
          adminCommission: 10,
          prizeFirst: 70,
          prizeSecond: 30,
          playerType: "real",
          countdownDuration: 60,
          betweenRoundSeconds: 30,
          status: "waiting",
        },
      });
      tournamentIds.push(primary.id);
      const secondary = await createTournament({
        actorId: admin!.id,
        ipAddress: `127.0.2.${suffix.slice(-1)}`,
        tournament: {
          title: `Other Active ${suffix}`,
          playerCount: 2,
          boardType: "2p",
          gameMode: "quick",
          type: "free",
          joinFee: 0,
          prizePool: 100,
          adminCommission: 10,
          prizeFirst: 70,
          prizeSecond: 30,
          playerType: "real",
          countdownDuration: 60,
          betweenRoundSeconds: 30,
          status: "waiting",
        },
      });
      tournamentIds.push(secondary.id);
      const incomplete = await createTournament({
        actorId: admin!.id,
        ipAddress: `127.0.3.${suffix.slice(-1)}`,
        tournament: {
          title: `Countdown Reset ${suffix}`,
          playerCount: 4,
          boardType: "4p",
          gameMode: "master",
          type: "free",
          joinFee: 0,
          prizePool: 200,
          adminCommission: 10,
          prizeFirst: 70,
          prizeSecond: 30,
          playerType: "real",
          countdownDuration: 60,
          betweenRoundSeconds: 30,
          status: "waiting",
        },
      });
      tournamentIds.push(incomplete.id);

      const firstJoin = await joinTournament(primary.id, winner!.id);
      expect(firstJoin.user.mainBalance).toBe("0.00");
      expect(firstJoin.user.winnerBalance).toBe("180.00");
      expect(
        await db.query.tournamentEntries.findFirst({
          where: and(
            eq(tournamentEntries.tournamentId, primary.id),
            eq(tournamentEntries.userId, winner!.id),
          ),
          columns: {
            paidAmount: true,
            paidMainAmount: true,
            paidWinnerAmount: true,
          },
        }),
      ).toEqual({
        paidAmount: "50.00",
        paidMainAmount: "30.00",
        paidWinnerAmount: "20.00",
      });
      await expect(
        joinTournament(secondary.id, winner!.id),
      ).rejects.toMatchObject({ code: "ACTIVE_TOURNAMENT_EXISTS" });

      const leave = await leaveTournament(primary.id, winner!.id);
      expect(leave.user.mainBalance).toBe("30.00");
      expect(leave.user.winnerBalance).toBe("200.00");
      expect(
        await db.query.transactions.findMany({
          where: and(
            eq(transactions.userId, winner!.id),
            eq(transactions.type, "tournament_refund"),
          ),
          columns: { type: true, amount: true, balanceSource: true },
        }),
      ).toEqual(
        expect.arrayContaining([
          {
            type: "tournament_refund",
            amount: "30.00",
            balanceSource: "main",
          },
          {
            type: "tournament_refund",
            amount: "20.00",
            balanceSource: "winner",
          },
        ]),
      );

      await expect(
        joinTournament(primary.id, winner!.id),
      ).rejects.toMatchObject({ code: "TOURNAMENT_ALREADY_PARTICIPATED" });

      await joinTournament(primary.id, runner!.id);
      await joinTournament(incomplete.id, waitingPlayer!.id);

      const [fullTournament] = await db
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, primary.id));
      expect(fullTournament!.countdownEndsAt).toBeTruthy();
      await expect(leaveTournament(primary.id, winner!.id)).rejects.toMatchObject({
        code: "TOURNAMENT_LEAVE_CLOSED",
      });
      const tickTime = new Date(
        fullTournament!.countdownEndsAt!.getTime() + 1_000,
      );
      await processTournamentTick(undefined, tickTime);

      const [activeTournament] = await db
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, primary.id));
      expect(activeTournament).toEqual(
        expect.objectContaining({
          status: "active",
          currentRound: 1,
          totalRounds: 1,
          collectedFees: "100.00",
        }),
      );
      const [finalMatch] = await db
        .select()
        .from(matches)
        .where(eq(matches.tournamentId, primary.id));
      expect(finalMatch).toBeTruthy();

      const result = await completeMatch({
        matchId: finalMatch!.id,
        placements: [winner!.id, runner!.id],
        actorId: admin!.id,
        ipAddress: `127.0.4.${suffix.slice(-1)}`,
      });
      expect(result.tournamentCompleted).toBe(true);

      const finalUsers = await db
        .select({
          id: users.id,
          mainBalance: users.mainBalance,
          winnerBalance: users.winnerBalance,
        })
        .from(users)
        .where(inArray(users.id, [winner!.id, runner!.id]));
      expect(finalUsers.find((user) => user.id === winner!.id)).toEqual(
        expect.objectContaining({
          mainBalance: "0.00",
          winnerBalance: "530.00",
        }),
      );
      expect(finalUsers.find((user) => user.id === runner!.id)).toEqual(
        expect.objectContaining({
          mainBalance: "450.00",
          winnerBalance: "150.00",
        }),
      );

      const completed = await db.query.tournaments.findFirst({
        where: eq(tournaments.id, primary.id),
      });
      expect(completed).toEqual(
        expect.objectContaining({
          status: "completed",
          adminRevenue: "10.00",
        }),
      );
      const publicList = await listTournaments({});
      expect(publicList.some((item) => item.id === primary.id)).toBe(false);

      const recurring = await createTournament({
        actorId: admin!.id,
        ipAddress: `127.0.5.${suffix.slice(-1)}`,
        tournament: {
          title: `Recurring Duel ${suffix}`,
          playerCount: 2,
          boardType: "2p",
          gameMode: "classic",
          type: "paid",
          joinFee: 30,
          prizePool: 54,
          adminCommission: 10,
          prizeFirst: 100,
          prizeSecond: 0,
          playerType: "real",
          countdownDuration: 60,
          betweenRoundSeconds: 30,
          status: "waiting",
        },
      });
      const recurringKey = `test-recurring-${suffix}`;
      await db
        .update(tournaments)
        .set({ isRecurring: true, recurringTemplateKey: recurringKey })
        .where(eq(tournaments.id, recurring.id));
      tournamentIds.push(recurring.id);

      await joinTournament(recurring.id, winner!.id);
      const partiallyFilled = await db.query.tournaments.findFirst({
        where: eq(tournaments.id, recurring.id),
      });
      expect(partiallyFilled!.countdownEndsAt).toBeNull();
      await joinTournament(recurring.id, runner!.id);
      const filled = await db.query.tournaments.findFirst({
        where: eq(tournaments.id, recurring.id),
      });
      expect(filled!.countdownEndsAt).toBeTruthy();
      await processTournamentTick(
        undefined,
        new Date(filled!.countdownEndsAt!.getTime() + 1_000),
      );
      const recurringRows = await db
        .select()
        .from(tournaments)
        .where(eq(tournaments.recurringTemplateKey, recurringKey));
      const activeRecurring = recurringRows.find(
        (item) => item.status === "active",
      );
      const replacement = recurringRows.find(
        (item) => item.status === "waiting",
      );
      expect(activeRecurring?.id).toBe(recurring.id);
      expect(replacement).toEqual(
        expect.objectContaining({
          joinFee: "30.00",
          prizePool: "54.00",
          prizeFirst: "100.00",
          prizeSecond: "0.00",
          countdownEndsAt: null,
          isRecurring: true,
        }),
      );
      tournamentIds.push(replacement!.id);

      const [waitingBefore] = await db
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, incomplete.id));
      expect(waitingBefore!.countdownEndsAt).toBeNull();
      const resetTime = new Date(Date.now() + 10 * 60_000);
      await processTournamentTick(undefined, resetTime);
      const [waitingAfter] = await db
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, incomplete.id));
      expect(waitingAfter!.status).toBe("waiting");
      expect(waitingAfter!.countdownEndsAt).toBeNull();
    } finally {
      await db
        .delete(adminAuditLogs)
        .where(inArray(adminAuditLogs.actorId, userIds));
      await db
        .delete(transactions)
        .where(inArray(transactions.userId, userIds));
      await db
        .delete(tournamentEntries)
        .where(inArray(tournamentEntries.userId, userIds));
      if (tournamentIds.length > 0) {
        await db
          .delete(tournaments)
          .where(inArray(tournaments.id, tournamentIds));
      }
      await db.delete(users).where(inArray(users.id, userIds));
    }
  });
});
