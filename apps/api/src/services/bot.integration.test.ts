import { randomInt } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { Server } from "socket.io";
import { afterAll, describe, expect, it } from "vitest";
import { db, pool } from "../db/client.js";
import {
  adminAuditLogs,
  botPlayers,
  gameStates,
  matchPlayers,
  matches,
  promotionalWins,
  tournamentEntries,
  tournaments,
  transactions,
  users,
} from "../db/schema.js";
import { processBotTick } from "./bot-engine.service.js";
import {
  createBot,
  fillTournamentBots,
} from "./bot.service.js";
import { getLeaderboard } from "./leaderboard.service.js";
import {
  completeMatch,
  createTournament,
  processTournamentTick,
} from "./tournament.service.js";

const runDatabaseTests = process.env.RUN_DB_TESTS === "1";

describe.runIf(runDatabaseTests)("Phase 8 bot and leaderboard integration", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("fills tournaments, plays with fair server actions, and keeps bot prizes virtual", async () => {
    const suffix = randomInt(1000, 9999).toString();
    const io = new Server();
    const createdUsers = await db
      .insert(users)
      .values([
        {
          gameId: `2${suffix}`,
          name: "Bot Test Admin",
          phone: `+880152800${suffix}`,
          referCode: `BA${suffix}`,
          isAdmin: true,
        },
        {
          gameId: `3${suffix}`,
          name: "Real Leader",
          phone: `+880162800${suffix}`,
          referCode: `RL${suffix}`,
        },
      ])
      .returning();
    const [admin, realPlayer] = createdUsers;
    const tournamentIds: string[] = [];
    const botIds: string[] = [];
    const botUserIds: string[] = [];
    const previouslyActiveBots = await db
      .select({ id: botPlayers.id })
      .from(botPlayers)
      .where(eq(botPlayers.isActive, true));

    try {
      if (previouslyActiveBots.length > 0) {
        await db
          .update(botPlayers)
          .set({ isActive: false })
          .where(
            inArray(
              botPlayers.id,
              previouslyActiveBots.map((bot) => bot.id),
            ),
          );
      }
      for (const [index, name] of [
        `Rahim Bot ${suffix}`,
        `Nargis Bot ${suffix}`,
      ].entries()) {
        const bot = await createBot({
          bot: {
            name,
            avatar: `/avatars/face-0${index + 1}.svg`,
            winRate: 70,
            useGlobalWinRate: index === 0,
            actionDelayMinMs: 500,
            actionDelayMaxMs: 700,
            isActive: true,
          },
          actorId: admin!.id,
          ipAddress: "127.0.0.8",
          io,
        });
        botIds.push(bot.id);
        botUserIds.push(bot.userId!);
      }

      const botTournament = await createTournament({
        actorId: admin!.id,
        ipAddress: "127.0.0.8",
        tournament: {
          title: `Bot Cup ${suffix}`,
          playerCount: 2,
          boardType: "2p",
          gameMode: "quick",
          type: "free",
          joinFee: 0,
          prizePool: 200,
          adminCommission: 10,
          prizeFirst: 70,
          prizeSecond: 30,
          playerType: "bot",
          countdownDuration: 10,
          betweenRoundSeconds: 30,
          status: "waiting",
        },
      });
      tournamentIds.push(botTournament.id);
      const fill = await fillTournamentBots({
        tournamentId: botTournament.id,
        actorId: admin!.id,
        ipAddress: "127.0.0.8",
      });
      expect(fill.addedUserIds).toHaveLength(2);
      expect(fill.full).toBe(true);

      const [waiting] = await db
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, botTournament.id));
      await processTournamentTick(
        io,
        new Date(waiting!.countdownEndsAt!.getTime() + 1_000),
      );

      const [activeMatch] = await db
        .select()
        .from(matches)
        .where(eq(matches.tournamentId, botTournament.id));
      expect(activeMatch).toEqual(
        expect.objectContaining({ status: "active" }),
      );
      const botSeats = await db
        .select()
        .from(matchPlayers)
        .where(eq(matchPlayers.matchId, activeMatch!.id));
      expect(botSeats.every((seat) => seat.connectedAt)).toBe(true);

      const before = await db.query.gameStates.findFirst({
        where: eq(gameStates.matchId, activeMatch!.id),
      });
      expect(before?.currentTurn).toBeTruthy();
      await processBotTick(
        io,
        new Date(before!.updatedAt.getTime() + 10_000),
      );
      const after = await db.query.gameStates.findFirst({
        where: eq(gameStates.matchId, activeMatch!.id),
      });
      expect(after!.stateVersion).toBeGreaterThan(before!.stateVersion);
      expect(after!.diceValue).toBeGreaterThanOrEqual(1);
      expect(after!.diceValue).toBeLessThanOrEqual(6);

      const completed = await completeMatch({
        matchId: activeMatch!.id,
        placements: botUserIds,
        actorId: admin!.id,
        ipAddress: "127.0.0.8",
      });
      expect(completed.tournamentCompleted).toBe(true);
      const botWallets = await db
        .select({
          id: users.id,
          winnerBalance: users.winnerBalance,
        })
        .from(users)
        .where(inArray(users.id, botUserIds));
      expect(botWallets.every((user) => user.winnerBalance === "0.00")).toBe(
        true,
      );
      const promoRows = await db
        .select()
        .from(promotionalWins)
        .where(inArray(promotionalWins.botPlayerId, botIds));
      expect(promoRows).toHaveLength(2);
      expect(promoRows.every((row) => row.isDisclosed)).toBe(true);

      const realTournament = await createTournament({
        actorId: admin!.id,
        ipAddress: "127.0.0.8",
        tournament: {
          title: `Real Cup ${suffix}`,
          playerCount: 2,
          boardType: "2p",
          gameMode: "classic",
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
      tournamentIds.push(realTournament.id);
      const now = new Date();
      const [realMatch] = await db
        .insert(matches)
        .values({
          tournamentId: realTournament.id,
          round: 1,
          player1Id: realPlayer!.id,
          player2Id: admin!.id,
          winnerId: realPlayer!.id,
          status: "completed",
          startedAt: now,
          endedAt: now,
        })
        .returning();
      await db.insert(matchPlayers).values([
        {
          matchId: realMatch!.id,
          userId: realPlayer!.id,
          seat: 1,
          placement: 1,
        },
        {
          matchId: realMatch!.id,
          userId: admin!.id,
          seat: 2,
          placement: 2,
        },
      ]);
      await db.insert(transactions).values({
        userId: realPlayer!.id,
        type: "prize",
        amount: "70",
        status: "success",
        balanceSource: "winner",
        balanceAppliedAt: now,
        relatedTournamentId: realTournament.id,
        reference: `phase8-real-${suffix}`,
      });

      for (const period of [
        "daily",
        "weekly",
        "monthly",
        "all",
      ] as const) {
        const leaderboard = await getLeaderboard(period, realPlayer!.id);
        expect(leaderboard.period).toBe(period);
        expect(
          leaderboard.entries.some(
            (entry) =>
              entry.source === "real" &&
              entry.id === realPlayer!.id &&
              entry.isCurrentPlayer,
          ),
        ).toBe(true);
        expect(
          leaderboard.entries.some(
            (entry) =>
              entry.source === "bot" &&
              entry.isPromotional &&
              botIds.includes(entry.id),
          ),
        ).toBe(true);
      }
    } finally {
      await db
        .delete(adminAuditLogs)
        .where(eq(adminAuditLogs.actorId, admin!.id));
      await db
        .delete(transactions)
        .where(
          inArray(transactions.userId, [
            ...createdUsers.map((user) => user.id),
            ...botUserIds,
          ]),
        );
      if (tournamentIds.length > 0) {
        await db
          .delete(tournaments)
          .where(inArray(tournaments.id, tournamentIds));
      }
      if (botIds.length > 0) {
        await db
          .delete(promotionalWins)
          .where(inArray(promotionalWins.botPlayerId, botIds));
        await db
          .delete(botPlayers)
          .where(inArray(botPlayers.id, botIds));
      }
      await db
        .delete(users)
        .where(
          inArray(users.id, [
            ...createdUsers.map((user) => user.id),
            ...botUserIds,
          ]),
        );
      if (previouslyActiveBots.length > 0) {
        await db
          .update(botPlayers)
          .set({ isActive: true })
          .where(
            inArray(
              botPlayers.id,
              previouslyActiveBots.map((bot) => bot.id),
            ),
          );
      }
    }
  });
});
