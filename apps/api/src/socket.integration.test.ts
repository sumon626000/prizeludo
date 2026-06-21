import { createServer } from "node:http";
import { randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import { Server } from "socket.io";
import { io as createSocketClient, type Socket } from "socket.io-client";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { db, pool } from "./db/client.js";
import { users } from "./db/schema.js";
import { issueSession } from "./services/auth.service.js";
import { configureSocketServer } from "./socket.js";

const runDatabaseTests = process.env.RUN_DB_TESTS === "1";

function waitForEvent<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${event}`)),
      5_000,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
}

describe.runIf(runDatabaseTests)("Socket.io authenticated rooms", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("delivers private notifications only to the authenticated user room", async () => {
    const suffix = randomInt(1000, 9999).toString();
    const [user] = await db
      .insert(users)
      .values({
        gameId: `6${suffix}`,
        name: "Socket Room Player",
        phone: `+88018000${suffix}`,
        referCode: `SOCKET${suffix}`,
      })
      .returning();
    expect(user).toBeDefined();

    const session = await issueSession({
      user: user!,
      ipAddress: "127.0.0.1",
      deviceId: "socket-room-test-device",
    });
    const app = createApp();
    const httpServer = createServer(app);
    const io = new Server(httpServer);
    configureSocketServer(io);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const address = httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Test server did not expose a TCP port.");
    }
    const url = `http://127.0.0.1:${address.port}`;

    let authenticatedClient: Socket | undefined;
    let guestClient: Socket | undefined;
    try {
      authenticatedClient = createSocketClient(url, {
        transports: ["websocket"],
        extraHeaders: {
          Cookie: `${config.COOKIE_NAME}=${session.token}`,
        },
      });
      guestClient = createSocketClient(url, {
        transports: ["websocket"],
      });

      await Promise.all([
        waitForEvent(authenticatedClient, "system:ready"),
        waitForEvent(guestClient, "system:ready"),
      ]);

      const authenticatedEvent = waitForEvent<{ title: string }>(
        authenticatedClient,
        "notification:new",
      );
      let guestReceived = false;
      guestClient.once("notification:new", () => {
        guestReceived = true;
      });

      io.to(`user:${user!.id}`).emit("notification:new", {
        title: "Private match notice",
      });

      await expect(authenticatedEvent).resolves.toEqual({
        title: "Private match notice",
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(guestReceived).toBe(false);
    } finally {
      authenticatedClient?.disconnect();
      guestClient?.disconnect();
      io.close();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
      await db.delete(users).where(eq(users.id, user!.id));
    }
  });
});
