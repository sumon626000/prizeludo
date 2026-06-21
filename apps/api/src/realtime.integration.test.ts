import { createServer } from "node:http";
import { randomInt } from "node:crypto";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { Server } from "socket.io";
import { io as createSocketClient, type Socket } from "socket.io-client";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { db, pool } from "./db/client.js";
import {
  adminAuditLogs,
  gameStates,
  matchPlayers,
  matches,
  notifications,
  tournamentEntries,
  tournaments,
  users,
} from "./db/schema.js";
import { issueSession } from "./services/auth.service.js";
import { getGameRoom } from "./services/game.service.js";
import {
  broadcastAdminNotice,
  emitBalanceUpdate,
  emitTournamentRealtime,
  updateMaintenanceMode,
} from "./services/realtime.service.js";
import {
  getSettings,
  updateSettings,
} from "./services/settings.service.js";
import { configureSocketServer } from "./socket.js";

const runDatabaseTests = process.env.RUN_DB_TESTS === "1";

function waitForEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${event}`)),
      8_000,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
}

function emitWithAck(
  socket: Socket,
  event: string,
  payload?: string,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out acknowledging ${event}`)),
      8_000,
    );
    const callback = (response: { ok: boolean; error?: string }) => {
      clearTimeout(timeout);
      resolve(response);
    };
    if (payload === undefined) socket.emit(event, callback);
    else socket.emit(event, payload, callback);
  });
}

describe.runIf(runDatabaseTests)("Phase 7 realtime integration", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("delivers typed tournament, game, global, private, and recovery events", async () => {
    const suffix = randomInt(1000, 9999).toString();
    const noticeTitle = `Live notice ${suffix}`;
    const noticeMessage = "Realtime broadcast delivered.";
    const oldSettings = await getSettings([
      "site.maintenance_enabled",
      "site.maintenance_message",
    ]);
    const createdUsers = await db
      .insert(users)
      .values([
        {
          gameId: `7${suffix}`,
          name: "Realtime Admin",
          phone: `+880171700${suffix}`,
          referCode: `RA${suffix}`,
          isAdmin: true,
          mainBalance: "500",
        },
        {
          gameId: `8${suffix}`,
          name: "Realtime Player",
          phone: `+880181700${suffix}`,
          referCode: `RP${suffix}`,
          mainBalance: "250",
        },
      ])
      .returning();
    const [admin, player] = createdUsers;
    const userIds = createdUsers.map((user) => user.id);
    const [tournament] = await db
      .insert(tournaments)
      .values({
        title: `Realtime Cup ${suffix}`,
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
    await db.insert(tournamentEntries).values([
      {
        tournamentId: tournament!.id,
        userId: player!.id,
        status: "joined",
        joinedAt: new Date(),
      },
      {
        tournamentId: tournament!.id,
        userId: admin!.id,
        status: "joined",
        joinedAt: new Date(),
      },
    ]);
    const [match] = await db
      .insert(matches)
      .values({
        tournamentId: tournament!.id,
        round: 1,
        player1Id: player!.id,
        player2Id: admin!.id,
        status: "active",
        startedAt: new Date(),
      })
      .returning();
    await db.insert(matchPlayers).values([
      {
        matchId: match!.id,
        userId: player!.id,
        seat: 1,
        connectedAt: new Date(),
      },
      {
        matchId: match!.id,
        userId: admin!.id,
        seat: 2,
        connectedAt: new Date(),
      },
    ]);
    await db.insert(gameStates).values({
      matchId: match!.id,
      boardState: {},
      tokenPositions: {},
    });
    await getGameRoom(match!.id, player!.id);

    const session = await issueSession({
      user: player!,
      ipAddress: "127.0.0.1",
      deviceId: "realtime-player-device",
    });
    const app = createApp();
    const httpServer = createServer(app);
    const io = new Server(httpServer, {
      connectionStateRecovery: {
        maxDisconnectionDuration: 120_000,
        skipMiddlewares: false,
      },
    });
    app.set("io", io);
    configureSocketServer(io);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const address = httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Realtime test server did not expose a port.");
    }
    const url = `http://127.0.0.1:${address.port}`;
    const authenticated = createSocketClient(url, {
      autoConnect: false,
      transports: ["websocket"],
      extraHeaders: {
        Cookie: `${config.COOKIE_NAME}=${session.token}`,
      },
    });
    const guest = createSocketClient(url, {
      autoConnect: false,
      transports: ["websocket"],
    });

    try {
      const authenticatedState = waitForEvent<{
        payload: {
          user: { id: string; activeMatchIds: string[] } | null;
        };
      }>(authenticated, "system:state");
      const guestState = waitForEvent<{
        payload: { user: null };
      }>(guest, "system:state");
      authenticated.connect();
      guest.connect();
      await expect(authenticatedState).resolves.toEqual(
        expect.objectContaining({
          payload: expect.objectContaining({
            user: expect.objectContaining({
              id: player!.id,
              activeMatchIds: [match!.id],
            }),
          }),
        }),
      );
      await expect(guestState).resolves.toEqual(
        expect.objectContaining({
          payload: expect.objectContaining({ user: null }),
        }),
      );

      await expect(
        emitWithAck(
          authenticated,
          "tournament:subscribe",
          tournament!.id,
        ),
      ).resolves.toEqual(expect.objectContaining({ ok: true }));
      const joinedEvent = waitForEvent<{
        payload: { id: string; joinedCount: number };
      }>(authenticated, "tournament:join");
      await emitTournamentRealtime(io, {
        tournamentId: tournament!.id,
        reason: "joined",
        userId: player!.id,
      });
      await expect(joinedEvent).resolves.toEqual(
        expect.objectContaining({
          payload: expect.objectContaining({
            id: tournament!.id,
            joinedCount: 2,
          }),
        }),
      );

      const privateBalance = waitForEvent<{
        payload: { reason: string };
      }>(authenticated, "balance:update");
      let guestReceivedBalance = false;
      guest.once("balance:update", () => {
        guestReceivedBalance = true;
      });
      emitBalanceUpdate(io, player!.id, { reason: "integration_test" });
      await expect(privateBalance).resolves.toEqual(
        expect.objectContaining({
          payload: { reason: "integration_test" },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(guestReceivedBalance).toBe(false);

      const playerNotice = waitForEvent(authenticated, "admin:notice");
      const guestNotice = waitForEvent(guest, "admin:notice");
      const noticeResult = await broadcastAdminNotice({
        io,
        title: noticeTitle,
        message: noticeMessage,
      });
      expect(noticeResult.delivered).toBeGreaterThanOrEqual(userIds.length);
      await expect(playerNotice).resolves.toEqual(
        expect.objectContaining({
          payload: expect.objectContaining({ title: noticeTitle }),
        }),
      );
      await expect(guestNotice).resolves.toEqual(
        expect.objectContaining({
          payload: expect.objectContaining({ title: noticeTitle }),
        }),
      );

      const maintenanceEvent = waitForEvent<{
        payload: { enabled: boolean };
      }>(authenticated, "admin:maintenance");
      await updateMaintenanceMode({
        io,
        enabled: true,
        message: "Realtime maintenance test.",
        actorId: admin!.id,
        ipAddress: "127.0.0.1",
      });
      await expect(maintenanceEvent).resolves.toEqual(
        expect.objectContaining({
          payload: expect.objectContaining({ enabled: true }),
        }),
      );

      await expect(
        emitWithAck(authenticated, "game:join", match!.id),
      ).resolves.toEqual(expect.objectContaining({ ok: true }));
      const diceEvent = waitForEvent<{ dice: number }>(
        authenticated,
        "game:dice-roll",
      );
      const turnEvent = waitForEvent<{ userId: string }>(
        authenticated,
        "game:turn-change",
      );
      const rollResponse = await request(app)
        .post(`/api/games/${match!.id}/roll`)
        .set("Cookie", `${config.COOKIE_NAME}=${session.token}`)
        .set("x-device-id", "realtime-player-device")
        .send({});
      expect(rollResponse.status).toBe(200);
      await expect(diceEvent).resolves.toEqual(
        expect.objectContaining({ dice: expect.any(Number) }),
      );
      await expect(turnEvent).resolves.toEqual(
        expect.objectContaining({
          matchId: match!.id,
          userId: expect.any(String),
        }),
      );

      authenticated.disconnect();
      const recoveredState = waitForEvent<{
        payload: {
          maintenance: { enabled: boolean };
          user: { id: string } | null;
        };
      }>(authenticated, "system:state");
      authenticated.connect();
      await expect(recoveredState).resolves.toEqual(
        expect.objectContaining({
          payload: expect.objectContaining({
            maintenance: expect.objectContaining({ enabled: true }),
            user: expect.objectContaining({ id: player!.id }),
          }),
        }),
      );
    } finally {
      authenticated.disconnect();
      guest.disconnect();
      io.close();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
      await updateSettings(oldSettings);
      await db
        .delete(adminAuditLogs)
        .where(inArray(adminAuditLogs.actorId, userIds));
      await db.delete(notifications).where(
        and(
          eq(notifications.message, noticeMessage),
          or(
            eq(notifications.title, "Live notice"),
            like(notifications.title, "Live notice %"),
          ),
        ),
      );
      await db
        .delete(notifications)
        .where(inArray(notifications.userId, userIds));
      await db.delete(tournaments).where(eq(tournaments.id, tournament!.id));
      await db.delete(users).where(inArray(users.id, userIds));
    }
  });
});
