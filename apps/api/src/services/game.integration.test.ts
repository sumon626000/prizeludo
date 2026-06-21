import { randomInt } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, pool } from "../db/client.js";
import {
  gameStates,
  matchPlayers,
  matches,
  tournamentEntries,
  tournaments,
  transactions,
  users,
} from "../db/schema.js";
import {
  addGameMessage,
  getGameRoom,
  markGameConnected,
  markGameDisconnected,
  processGameTick,
  rollGameDice,
} from "./game.service.js";

const runDatabaseTests = process.env.RUN_DB_TESTS === "1";

describe.runIf(runDatabaseTests)("Phase 6 game integration", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("persists cumulative misses and waits for the offline deadline before loss", async () => {
    const suffix = randomInt(1000, 9999).toString();
    const createdUsers = await db
      .insert(users)
      .values([
        {
          gameId: `2${suffix}`,
          name: "Game Player One",
          phone: `+880171200${suffix}`,
          referCode: `G1${suffix}`,
        },
        {
          gameId: `3${suffix}`,
          name: "Game Player Two",
          phone: `+880181200${suffix}`,
          referCode: `G2${suffix}`,
        },
      ])
      .returning();
    const [loser, winner] = createdUsers;
    const userIds = createdUsers.map((user) => user.id);
    let tournamentId = "";

    try {
      const [tournament] = await db
        .insert(tournaments)
        .values({
          title: `Game Integration ${suffix}`,
          playerCount: 2,
          boardType: "2p",
          gameMode: "classic",
          type: "free",
          prizePool: "100",
          status: "active",
          currentRound: 1,
          totalRounds: 1,
          startsAt: new Date(),
        })
        .returning();
      tournamentId = tournament!.id;
      await db.insert(tournamentEntries).values([
        {
          tournamentId,
          userId: loser!.id,
          status: "joined",
          joinedAt: new Date(),
        },
        {
          tournamentId,
          userId: winner!.id,
          status: "joined",
          joinedAt: new Date(),
        },
      ]);
      const [match] = await db
        .insert(matches)
        .values({
          tournamentId,
          round: 1,
          player1Id: loser!.id,
          player2Id: winner!.id,
          status: "active",
          startedAt: new Date(),
        })
        .returning();
      await db.insert(matchPlayers).values([
        {
          matchId: match!.id,
          userId: loser!.id,
          seat: 1,
          connectedAt: new Date(),
        },
        {
          matchId: match!.id,
          userId: winner!.id,
          seat: 2,
          connectedAt: new Date(),
        },
      ]);
      await db.insert(gameStates).values({
        matchId: match!.id,
        boardState: {},
        tokenPositions: {},
      });

      const room = await getGameRoom(match!.id, loser!.id);
      expect(room.role).toBe("player");
      expect(room.state.boardState).toEqual(
        expect.objectContaining({
          schemaVersion: 1,
          phase: "active",
          gameMode: "classic",
        }),
      );
      expect(room.state.tokenPositions).toEqual(
        expect.objectContaining({
          [loser!.id]: [-1, -1, -1, -1],
          [winner!.id]: [-1, -1, -1, -1],
        }),
      );

      const message = await addGameMessage({
        matchId: match!.id,
        userId: loser!.id,
        kind: "chat",
        content: "Good luck",
      });
      expect(message.content).toBe("Good luck");
      const reloaded = await getGameRoom(match!.id, winner!.id);
      expect(reloaded.messages.at(-1)).toEqual(
        expect.objectContaining({ content: "Good luck", kind: "chat" }),
      );

      await db
        .update(matchPlayers)
        .set({ missCount: 2 })
        .where(
          and(
            eq(matchPlayers.matchId, match!.id),
            eq(matchPlayers.userId, loser!.id),
          ),
        );
      await rollGameDice(match!.id, loser!.id);
      const afterSuccessfulRoll = await db.query.matchPlayers.findFirst({
        where: and(
          eq(matchPlayers.matchId, match!.id),
          eq(matchPlayers.userId, loser!.id),
        ),
      });
      expect(afterSuccessfulRoll?.missCount).toBe(0);

      for (let count = 1; count <= 4; count += 1) {
        const disconnected = await markGameDisconnected(
          match!.id,
          loser!.id,
        );
        expect(disconnected).toEqual(
          expect.objectContaining({
            automaticLoss: false,
            reconnectCount: count,
          }),
        );
        await markGameConnected(match!.id, loser!.id);
      }
      const fifth = await markGameDisconnected(match!.id, loser!.id);
      expect(fifth).toEqual(
        expect.objectContaining({
          automaticLoss: false,
          reconnectCount: 5,
          reconnectDeadline: expect.any(Date),
        }),
      );
      if (!fifth?.reconnectDeadline) {
        throw new Error("Expected a reconnect deadline");
      }

      const stillActive = await db.query.matches.findFirst({
        where: eq(matches.id, match!.id),
      });
      expect(stillActive?.status).toBe("active");

      await processGameTick(
        undefined,
        new Date(fifth.reconnectDeadline.getTime() + 1),
      );

      const completedMatch = await db.query.matches.findFirst({
        where: eq(matches.id, match!.id),
      });
      expect(completedMatch).toEqual(
        expect.objectContaining({
          status: "completed",
          winnerId: winner!.id,
        }),
      );
      const loserRoom = await getGameRoom(match!.id, loser!.id);
      const winnerRoom = await getGameRoom(match!.id, winner!.id);
      expect(loserRoom.role).toBe("player");
      expect(winnerRoom.role).toBe("player");
      const loserEntry = await db.query.tournamentEntries.findFirst({
        where: eq(tournamentEntries.userId, loser!.id),
      });
      expect(loserEntry).toEqual(
        expect.objectContaining({
          prizeEarned: "0.00",
          finishPosition: null,
        }),
      );
      const winnerEntry = await db.query.tournamentEntries.findFirst({
        where: eq(tournamentEntries.userId, winner!.id),
      });
      expect(winnerEntry).toEqual(
        expect.objectContaining({
          finishPosition: 1,
          prizeEarned: "70.00",
        }),
      );
      const reconnectPlayer = await db.query.matchPlayers.findFirst({
        where: and(
          eq(matchPlayers.matchId, match!.id),
          eq(matchPlayers.userId, loser!.id),
        ),
      });
      expect(reconnectPlayer?.reconnectCount).toBe(5);
    } finally {
      await db.delete(transactions).where(inArray(transactions.userId, userIds));
      if (tournamentId) {
        await db.delete(tournaments).where(eq(tournaments.id, tournamentId));
      }
      await db.delete(users).where(inArray(users.id, userIds));
    }
  });
});
