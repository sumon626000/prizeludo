import { createServer } from "node:http";
import { Server } from "socket.io";
import { createApp } from "./app.js";
import { config, isAllowedWebOrigin } from "./config.js";
import { pool } from "./db/client.js";
import {
  ensureInitialPromotionalWin,
  startHomeRealtimeJobs,
  type HomeRealtimeScheduler,
} from "./services/home.service.js";
import {
  startGameScheduler,
  type GameScheduler,
} from "./services/game.service.js";
import {
  startBotScheduler,
  type BotScheduler,
} from "./services/bot-engine.service.js";
import { ensureBotIdentities } from "./services/bot.service.js";
import { ensureHomeDefaults } from "./services/settings.service.js";
import { ensureWalletDefaults, ensureZiniPayFromEnv } from "./services/wallet.service.js";
import {
  ensureMixedAutoTournaments,
  ensureRecurringRealTournaments,
  ensureTestRecurringTournaments,
  ensureTournamentIntegrity,
  startTournamentScheduler,
  type TournamentScheduler,
} from "./services/tournament.service.js";
import { configureSocketServer } from "./socket.js";
import { configureGoogleAuthFromSettings } from "./auth/google.js";
import {
  startMaintenanceScheduler,
  type MaintenanceScheduler,
} from "./services/maintenance.service.js";

const app = createApp();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin(origin, callback) {
      callback(null, isAllowedWebOrigin(origin));
    },
    credentials: true,
  },
  transports: ["websocket", "polling"],
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60_000,
    skipMiddlewares: false,
  },
});
app.set("io", io);
configureSocketServer(io);

let homeScheduler: HomeRealtimeScheduler | undefined;
let tournamentScheduler: TournamentScheduler | undefined;
let gameScheduler: GameScheduler | undefined;
let botScheduler: BotScheduler | undefined;
let maintenanceScheduler: MaintenanceScheduler | undefined;

async function bootstrap(): Promise<void> {
  await ensureHomeDefaults();
  await configureGoogleAuthFromSettings();
  await ensureBotIdentities();
  await ensureWalletDefaults();
  await ensureZiniPayFromEnv();
  await ensureTournamentIntegrity();
  await ensureRecurringRealTournaments(io);
  await ensureMixedAutoTournaments(io);
  await ensureTestRecurringTournaments(io);
  await ensureInitialPromotionalWin(io);
  homeScheduler = await startHomeRealtimeJobs(io);
  app.set("homeScheduler", homeScheduler);
  tournamentScheduler = startTournamentScheduler(io);
  gameScheduler = startGameScheduler(io);
  botScheduler = startBotScheduler(io);
  maintenanceScheduler = startMaintenanceScheduler();
  httpServer.listen(config.PORT, () => {
    console.log(`PrizeJito.com API listening on ${config.API_PUBLIC_URL}`);
  });
}

void bootstrap().catch(async (error) => {
  console.error("PrizeJito.com startup failed", error);
  await pool.end();
  process.exitCode = 1;
});

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, shutting down.`);
  homeScheduler?.stop();
  tournamentScheduler?.stop();
  gameScheduler?.stop();
  botScheduler?.stop();
  maintenanceScheduler?.stop();
  io.close();
  await new Promise<void>((resolve, reject) => {
    httpServer.close((error) => (error ? reject(error) : resolve()));
  });
  await pool.end();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
