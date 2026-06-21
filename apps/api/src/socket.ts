import { eq } from "drizzle-orm";
import type { Server, Socket } from "socket.io";
import { config, isProduction } from "./config.js";
import { db } from "./db/client.js";
import { matches, tournaments } from "./db/schema.js";
import { AppError } from "./lib/errors.js";
import {
  deviceCookieName,
  normalizeIp,
  verifyDeviceCookie,
} from "./middleware/request-context.js";
import { authenticateSession } from "./services/auth.service.js";
import {
  getGameRoom,
  markGameConnected,
  markGameDisconnected,
} from "./services/game.service.js";
import {
  getRealtimeState,
  getTournamentRealtimeState,
  realtimeEnvelope,
} from "./services/realtime.service.js";
import {
  getMatchSnapshot,
  getTournamentDetails,
} from "./services/tournament.service.js";

type SocketAck = (response: {
  ok: boolean;
  error?: string;
  recovered?: boolean;
}) => void;

const GAME_DISCONNECT_GRACE_MS = 12_000;

function getCookieValue(cookieHeader: string | undefined, key: string) {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name === key) return decodeURIComponent(valueParts.join("="));
  }
  return undefined;
}

function socketError(socket: Socket, error: unknown) {
  if (!(error instanceof AppError)) console.error("Socket action failed", error);
  const message = error instanceof AppError ? error.code : "SOCKET_ACTION_FAILED";
  socket.emit(
    "system:error",
    realtimeEnvelope("system:error", { message }),
  );
  return message;
}

async function emitSystemState(socket: Socket, userId?: string) {
  const state = await getRealtimeState(userId);
  socket.emit(
    "system:state",
    realtimeEnvelope("system:state", {
      ...state,
      recovered: socket.recovered,
    }),
  );
}

export function configureSocketServer(io: Server): void {
  io.use(async (socket, next) => {
    const token = getCookieValue(
      socket.handshake.headers.cookie,
      config.COOKIE_NAME,
    );
    if (!token) {
      next();
      return;
    }
    try {
      const deviceId = verifyDeviceCookie(
        getCookieValue(socket.handshake.headers.cookie, deviceCookieName),
      );
      if (!deviceId && isProduction) {
        next();
        return;
      }
      const auth = deviceId
        ? await authenticateSession(token, {
            ipAddress: normalizeIp(socket.handshake.address),
            deviceId,
          })
        : await authenticateSession(token);
      socket.data.userId = auth.user.id;
      socket.data.isAdmin = auth.user.isAdmin;
      next();
    } catch {
      next();
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId as string | undefined;
    const activeMatches = new Set<string>();
    const spectatedMatches = new Set<string>();
    const actionWindows = new Map<string, { startedAt: number; count: number }>();
    const assertActionRate = (action: string, limit: number) => {
      const now = Date.now();
      const current = actionWindows.get(action);
      if (!current || now - current.startedAt >= 60_000) {
        actionWindows.set(action, { startedAt: now, count: 1 });
        return;
      }
      current.count += 1;
      if (current.count > limit) {
        throw new AppError(429, "SOCKET_RATE_LIMITED", "Too many socket actions.");
      }
    };
    if (userId) void socket.join(`user:${userId}`);

    const subscribeTournament = async (
      tournamentId: unknown,
      ack?: SocketAck,
    ) => {
      if (typeof tournamentId !== "string") {
        ack?.({ ok: false, error: "INVALID_TOURNAMENT_ID" });
        return;
      }
      try {
        assertActionRate("tournament:subscribe", 60);
        const tournament = await db.query.tournaments.findFirst({
          where: eq(tournaments.id, tournamentId),
          columns: { id: true },
        });
        if (!tournament) {
          ack?.({ ok: false, error: "TOURNAMENT_NOT_FOUND" });
          return;
        }
        await socket.join(`tournament:${tournament.id}`);
        const [summary, details] = await Promise.all([
          getTournamentRealtimeState(tournament.id),
          getTournamentDetails(tournament.id, userId),
        ]);
        socket.emit(
          "tournament:state",
          realtimeEnvelope("tournament:state", summary),
        );
        if (details.currentEntry?.status === "joined") {
          socket.emit(
            "lobby:player-waiting",
            realtimeEnvelope("lobby:player-waiting", {
              tournamentId: tournament.id,
              userId,
              joinedCount: details.joinedCount,
              playerCount: details.tournament.playerCount,
            }),
          );
        }
        ack?.({ ok: true, recovered: socket.recovered });
      } catch (error) {
        ack?.({ ok: false, error: socketError(socket, error) });
      }
    };

    socket.on("tournament:subscribe", subscribeTournament);
    socket.on("lobby:join", subscribeTournament);
    socket.on("tournament:unsubscribe", (tournamentId: unknown) => {
      if (typeof tournamentId === "string") {
        void socket.leave(`tournament:${tournamentId}`);
      }
    });

    socket.on(
      "match:spectate",
      async (matchId: unknown, ack?: SocketAck) => {
        if (typeof matchId !== "string") {
          ack?.({ ok: false, error: "INVALID_MATCH_ID" });
          return;
        }
        try {
          assertActionRate("match:spectate", 60);
          const match = await db.query.matches.findFirst({
            where: eq(matches.id, matchId),
            columns: { id: true, tournamentId: true },
          });
          if (!match) {
            ack?.({ ok: false, error: "MATCH_NOT_FOUND" });
            return;
          }
          await socket.join(`match:${match.id}`);
          await socket.join(`tournament:${match.tournamentId}`);
          spectatedMatches.add(match.id);
          const snapshot = await getMatchSnapshot(match.id);
          socket.emit(
            "match:state",
            realtimeEnvelope("match:state", snapshot),
          );
          const sockets = await io.in(`match:${match.id}`).fetchSockets();
          io.to(`match:${match.id}`).emit(
            "lobby:spectate",
            realtimeEnvelope("lobby:spectate", {
              matchId: match.id,
              spectatorCount: sockets.filter(
                (item) => !activeMatches.has(match.id) || item.id !== socket.id,
              ).length,
            }),
          );
          ack?.({ ok: true, recovered: socket.recovered });
        } catch (error) {
          ack?.({ ok: false, error: socketError(socket, error) });
        }
      },
    );

    socket.on("match:unspectate", (matchId: unknown) => {
      if (typeof matchId !== "string") return;
      spectatedMatches.delete(matchId);
      void socket.leave(`match:${matchId}`);
    });

    socket.on("game:join", async (matchId: unknown, ack?: SocketAck) => {
      if (typeof matchId !== "string") {
        ack?.({ ok: false, error: "INVALID_MATCH_ID" });
        return;
      }
      try {
        assertActionRate("game:join", 30);
        const match = await db.query.matches.findFirst({
          where: eq(matches.id, matchId),
          columns: { id: true, tournamentId: true },
        });
        if (!match) {
          ack?.({ ok: false, error: "MATCH_NOT_FOUND" });
          return;
        }
        await socket.join(`match:${match.id}`);
        await socket.join(`tournament:${match.tournamentId}`);
        if (userId) {
          const connected = await markGameConnected(match.id, userId);
          if (connected) {
            activeMatches.add(match.id);
            if (connected.reconnected) {
              io.to(`match:${match.id}`).emit(
                "game:reconnect-success",
                realtimeEnvelope("game:reconnect-success", {
                  matchId: match.id,
                  userId,
                  serverTime: new Date().toISOString(),
                }),
              );
            }
          }
        }
        const room = await getGameRoom(match.id, userId);
        if (room.role === "spectator") {
          spectatedMatches.add(match.id);
          const sockets = await io.in(`match:${match.id}`).fetchSockets();
          io.to(`match:${match.id}`).emit(
            "lobby:spectate",
            realtimeEnvelope("lobby:spectate", {
              matchId: match.id,
              spectatorCount: sockets.length,
            }),
          );
        }
        socket.emit(
          "game:state-snapshot",
          realtimeEnvelope("game:state-snapshot", room),
        );
        ack?.({ ok: true, recovered: socket.recovered });
      } catch (error) {
        ack?.({ ok: false, error: socketError(socket, error) });
      }
    });

    socket.on("game:heartbeat", async (matchId: unknown, ack?: SocketAck) => {
      if (typeof matchId !== "string" || !userId) {
        ack?.({ ok: false, error: "AUTH_REQUIRED" });
        return;
      }
      try {
        assertActionRate("game:heartbeat", 30);
        await markGameConnected(matchId, userId);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: socketError(socket, error) });
      }
    });

    socket.on("system:resync", async (ack?: SocketAck) => {
      try {
        assertActionRate("system:resync", 30);
        await emitSystemState(socket, userId);
        ack?.({ ok: true, recovered: socket.recovered });
      } catch (error) {
        ack?.({ ok: false, error: socketError(socket, error) });
      }
    });

    socket.on("disconnect", () => {
      if (userId) {
        for (const matchId of activeMatches) {
          setTimeout(async () => {
            const connectedSockets = await io
              .in(`match:${matchId}`)
              .fetchSockets();
            if (
              connectedSockets.some(
                (connected) => connected.data.userId === userId,
              )
            ) {
              return;
            }
            const result = await markGameDisconnected(matchId, userId);
            if (!result) return;
            io.to(`match:${matchId}`).emit(
              "game:reconnect-start",
              realtimeEnvelope("game:reconnect-start", {
                matchId,
                userId,
                reconnectDeadline:
                  "reconnectDeadline" in result
                    ? result.reconnectDeadline
                    : null,
                automaticLoss: result.automaticLoss,
              }),
            );
          }, GAME_DISCONNECT_GRACE_MS);
        }
      }
      for (const matchId of spectatedMatches) {
        setTimeout(async () => {
          const sockets = await io.in(`match:${matchId}`).fetchSockets();
          io.to(`match:${matchId}`).emit(
            "lobby:spectate",
            realtimeEnvelope("lobby:spectate", {
              matchId,
              spectatorCount: sockets.length,
            }),
          );
        }, 100);
      }
    });

    void emitSystemState(socket, userId).catch((error) =>
      socketError(socket, error),
    );
    socket.emit("system:ready", {
      serverTime: new Date().toISOString(),
      recovered: socket.recovered,
    });
  });
}
