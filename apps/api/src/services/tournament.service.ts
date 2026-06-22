import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  lte,
  ne,
  sql,
} from "drizzle-orm";
import type { Server } from "socket.io";
import { db } from "../db/client.js";
import {
  adminAuditLogs,
  botPlayers,
  brackets,
  gameStates,
  matchPlayers,
  matches,
  notifications,
  promotionalWins,
  tournamentEntries,
  tournaments,
  transactions,
  users,
  type User,
} from "../db/schema.js";
import { AppError } from "../lib/errors.js";
import { withPostgresAdvisoryLock } from "../lib/distributed-lock.js";
import { toPublicUser } from "../lib/public-user.js";
import { createInitialGame } from "./game-engine.js";
import {
  ensureShowcaseBotPool,
  fillTournamentBotsInTransaction,
} from "./bot.service.js";
import {
  emitBalanceUpdate,
  emitTournamentRealtime,
} from "./realtime.service.js";
import {
  getSettings,
  updateSettingsWithAudit,
} from "./settings.service.js";

type DatabaseTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export type TournamentBoardType = "2p" | "4p";
export type TournamentGameMode = "classic" | "quick" | "master";
export type TournamentType = "free" | "paid";
export type TournamentPlayerType = "real" | "bot" | "mixed";
export type TournamentStatus = "upcoming" | "waiting" | "active" | "completed";

export interface TournamentInput {
  title: string;
  playerCount: 2 | 4 | 8 | 16 | 32 | 64;
  boardType: TournamentBoardType;
  gameMode: TournamentGameMode;
  type: TournamentType;
  joinFee: string | number;
  prizePool: string | number;
  adminCommission: number;
  prizeFirst: number;
  prizeSecond: number;
  playerType: TournamentPlayerType;
  countdownDuration: number;
  betweenRoundSeconds: number;
  status: "upcoming" | "waiting";
  startsAt?: Date | null | undefined;
}

interface JoinResult {
  entry: typeof tournamentEntries.$inferSelect;
  user: User;
  notification: typeof notifications.$inferSelect | null;
  alreadyJoined: boolean;
}

interface RoundCreationResult {
  matchIds: string[];
  userIds: string[];
}

interface TickResult {
  tournamentIds: Set<string>;
  userIds: Set<string>;
  matchIds: Set<string>;
  reasons: Map<string, string>;
}

const ACTIVE_ENTRY_STATUSES = ["waiting", "active"] as const;
const SHOWCASE_SETTING_KEYS = [
  "tournament.showcase_enabled",
  "tournament.showcase_count",
  "tournament.showcase_sizes",
] as const;
const MIXED_AUTO_SETTING_KEYS = [
  "tournament.mixed_auto_enabled",
  "tournament.mixed_auto_countdown_seconds",
] as const;
const MIXED_AUTO_TEMPLATE_KEY = "mixed-auto-16p-4p";
const MIXED_AUTO_PLAYER_COUNT = 16;
const MIXED_AUTO_BOT_PREFILL = 15;
const SHOWCASE_PLAYER_COUNTS = [4, 8, 16, 32, 64] as const;
const RECURRING_COUNTDOWN_SETTING =
  "tournament.recurring_full_countdown_seconds" as const;
const RECURRING_REAL_ENABLED_SETTING =
  "tournament.recurring_real_enabled" as const;
const RECURRING_ENTRY_FEE = 30;
const RECURRING_ADMIN_COMMISSION = 10;
const RECURRING_TWO_PLAYER_SIZES = [2, 4, 8, 16, 32, 64] as const;
const RECURRING_FOUR_PLAYER_SIZES = [4, 8, 16, 32, 64] as const;
const TEST_RECURRING_ENABLED_SETTING =
  "tournament.test_recurring_enabled" as const;

export const TEST_RECURRING_TEMPLATES = [
  {
    key: "test-2p-50",
    title: "Game Test · 2P · Free",
    playerCount: 2 as const,
    boardType: "2p" as const,
    type: "free" as const,
    joinFee: "0",
    prizePool: "0",
    adminCommission: "0",
    prizeFirst: "100",
    prizeSecond: "0",
    botSlots: 1,
    countdownDuration: 10,
    betweenRoundSeconds: 30,
  },
  {
    key: "test-8p-4p-50",
    title: "Game Test · 8P · 4P Board · Free",
    playerCount: 8 as const,
    boardType: "4p" as const,
    type: "free" as const,
    joinFee: "0",
    prizePool: "0",
    adminCommission: "0",
    prizeFirst: "70",
    prizeSecond: "30",
    botSlots: 7,
    countdownDuration: 10,
    betweenRoundSeconds: 30,
  },
] as const;

interface RecurringTournamentTemplate {
  key: string;
  title: string;
  playerCount: 2 | 4 | 8 | 16 | 32 | 64;
  boardType: TournamentBoardType;
  prizePool: string;
  prizeFirst: number;
  prizeSecond: number;
}

export interface ShowcaseSettings {
  enabled: boolean;
  count: number;
  sizes: Array<(typeof SHOWCASE_PLAYER_COUNTS)[number]>;
}

export interface MixedAutoSettings {
  enabled: boolean;
  countdownSeconds: number;
}

export function isMixedAutoTournament(tournament: {
  recurringTemplateKey?: string | null;
  playerType: string;
}) {
  return (
    tournament.recurringTemplateKey === MIXED_AUTO_TEMPLATE_KEY &&
    tournament.playerType === "mixed"
  );
}

export function isTestRecurringTournament(tournament: {
  recurringTemplateKey?: string | null;
  isRecurring?: boolean;
}) {
  return (
    tournament.isRecurring === true &&
    !!tournament.recurringTemplateKey &&
    TEST_RECURRING_TEMPLATES.some(
      (template) => template.key === tournament.recurringTemplateKey,
    )
  );
}

function getTestRecurringTemplate(key: string) {
  return TEST_RECURRING_TEMPLATES.find((template) => template.key === key);
}

function moneyToCents(value: string | number): number {
  const normalized = String(value).trim();
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(normalized)) {
    throw new AppError(400, "INVALID_AMOUNT", "সঠিক টাকার পরিমাণ দিন।");
  }
  const cents = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new AppError(400, "INVALID_AMOUNT", "সঠিক টাকার পরিমাণ দিন।");
  }
  return cents;
}

function centsToMoney(cents: number): string {
  return (cents / 100).toFixed(2);
}

function getEntryPaymentSplit(entry: {
  paidAmount: string;
  paidMainAmount: string;
  paidWinnerAmount: string;
  balanceSource: "none" | "main" | "winner";
}) {
  let mainCents = moneyToCents(entry.paidMainAmount);
  let winnerCents = moneyToCents(entry.paidWinnerAmount);
  const totalCents = moneyToCents(entry.paidAmount);

  // Existing entries created before split tracking retain their original source.
  if (mainCents + winnerCents === 0 && totalCents > 0) {
    if (entry.balanceSource === "winner") {
      winnerCents = totalCents;
    } else {
      mainCents = totalCents;
    }
  }

  return { mainCents, winnerCents, totalCents };
}

function addSeconds(value: Date, seconds: number): Date {
  return new Date(value.getTime() + seconds * 1_000);
}

async function getRecurringCountdownSeconds(): Promise<number> {
  const values = await getSettings([RECURRING_COUNTDOWN_SETTING]);
  const seconds = Number(values[RECURRING_COUNTDOWN_SETTING]);
  return Number.isInteger(seconds) && seconds >= 10 && seconds <= 86_400
    ? seconds
    : 300;
}

function buildRecurringTournamentTemplates(): RecurringTournamentTemplate[] {
  const create = (
    playerCount: RecurringTournamentTemplate["playerCount"],
    boardType: TournamentBoardType,
  ): RecurringTournamentTemplate => ({
    key: `real-${boardType}-${playerCount}`,
    title: `PrizeJito ${boardType.toUpperCase()} ${playerCount} Player`,
    playerCount,
    boardType,
    prizePool: centsToMoney(
      Math.round(
        playerCount * RECURRING_ENTRY_FEE * 100 *
          ((100 - RECURRING_ADMIN_COMMISSION) / 100),
      ),
    ),
    prizeFirst: boardType === "2p" ? 100 : 70,
    prizeSecond: boardType === "2p" ? 0 : 30,
  });
  return [
    ...RECURRING_TWO_PLAYER_SIZES.map((size) => create(size, "2p")),
    ...RECURRING_FOUR_PLAYER_SIZES.map((size) => create(size, "4p")),
  ];
}

async function insertRecurringTournamentInTransaction(
  transaction: DatabaseTransaction,
  template: RecurringTournamentTemplate,
  countdownDuration: number,
) {
  const [created] = await transaction
    .insert(tournaments)
    .values({
      title: template.title,
      playerCount: template.playerCount,
      boardType: template.boardType,
      gameMode: "classic",
      type: "paid",
      joinFee: String(RECURRING_ENTRY_FEE),
      prizePool: template.prizePool,
      adminCommission: String(RECURRING_ADMIN_COMMISSION),
      prizeFirst: String(template.prizeFirst),
      prizeSecond: String(template.prizeSecond),
      playerType: "real",
      isRecurring: true,
      recurringTemplateKey: template.key,
      status: "waiting",
      countdownDuration,
      countdownEndsAt: null,
      betweenRoundSeconds: 30,
      totalRounds: getTournamentTotalRounds(
        template.playerCount,
        template.boardType,
      ),
    })
    .returning();
  return created!;
}

export async function ensureRecurringRealTournaments(io?: Server) {
  const settings = await getSettings([RECURRING_REAL_ENABLED_SETTING]);
  if (settings[RECURRING_REAL_ENABLED_SETTING] === "false") {
    return [];
  }
  const countdownDuration = await getRecurringCountdownSeconds();
  const templates = buildRecurringTournamentTemplates();
  const created = await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext('prizejito-recurring-real-tournaments'))`,
    );
    const waiting = await transaction
      .select({
        id: tournaments.id,
        recurringTemplateKey: tournaments.recurringTemplateKey,
        countdownDuration: tournaments.countdownDuration,
        countdownEndsAt: tournaments.countdownEndsAt,
      })
      .from(tournaments)
      .where(
        and(
          eq(tournaments.isRecurring, true),
          eq(tournaments.status, "waiting"),
        ),
      )
      .for("update");
    const waitingByKey = new Map(
      waiting.map((item) => [item.recurringTemplateKey, item]),
    );
    const rows: Array<typeof tournaments.$inferSelect> = [];
    for (const template of templates) {
      const current = waitingByKey.get(template.key);
      if (current) {
        if (
          current.countdownDuration !== countdownDuration &&
          !current.countdownEndsAt
        ) {
          await transaction
            .update(tournaments)
            .set({ countdownDuration, updatedAt: new Date() })
            .where(eq(tournaments.id, current.id));
        }
        continue;
      }
      rows.push(
        await insertRecurringTournamentInTransaction(
          transaction,
          template,
          countdownDuration,
        ),
      );
    }
    return rows;
  });
  for (const tournament of created) {
    emitTournamentMutation(io, tournament.id, [], "recurring_created");
  }
  return created;
}

export async function getShowcaseSettings(): Promise<ShowcaseSettings> {
  const values = await getSettings(SHOWCASE_SETTING_KEYS);
  const sizes = (values["tournament.showcase_sizes"] || "8,16,32")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter(
      (value): value is (typeof SHOWCASE_PLAYER_COUNTS)[number] =>
        SHOWCASE_PLAYER_COUNTS.includes(
          value as (typeof SHOWCASE_PLAYER_COUNTS)[number],
        ),
    );
  return {
    enabled: values["tournament.showcase_enabled"] !== "false",
    count: Math.max(
      3,
      Math.min(5, Number(values["tournament.showcase_count"]) || 3),
    ),
    sizes: sizes.length > 0 ? sizes : [8, 16, 32],
  };
}

export async function updateShowcaseSettings(input: {
  settings: ShowcaseSettings;
  actorId: string;
  ipAddress: string;
  io?: Server;
}) {
  await updateSettingsWithAudit({
    values: {
      "tournament.showcase_enabled": String(input.settings.enabled),
      "tournament.showcase_count": String(input.settings.count),
      "tournament.showcase_sizes": input.settings.sizes.join(","),
    },
    actorId: input.actorId,
    ipAddress: input.ipAddress,
    action: "tournament.showcase.settings",
    targetType: "tournament_settings",
  });
  const settings = await getShowcaseSettings();
  if (settings.enabled) {
    await ensureShowcaseTournaments(input.io);
  }
  return settings;
}

export async function ensureShowcaseTournaments(io?: Server) {
  const settings = await getShowcaseSettings();
  if (!settings.enabled) return { created: [], settings };

  const activeBefore = await db
    .select({
      id: tournaments.id,
      playerCount: tournaments.playerCount,
    })
    .from(tournaments)
    .where(
      and(
        eq(tournaments.isShowcase, true),
        inArray(tournaments.status, ["waiting", "active"]),
      ),
    );
  const missingSizes = Array.from(
    { length: Math.max(0, settings.count - activeBefore.length) },
    (_, index) =>
      settings.sizes[
        (activeBefore.length + index) % settings.sizes.length
      ]!,
  );
  await ensureShowcaseBotPool(
    activeBefore.reduce((total, item) => total + item.playerCount, 0) +
      missingSizes.reduce((total, size) => total + size, 0),
  );

  const created = await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext('prizejito-showcase-tournaments'))`,
    );
    const current = await transaction
      .select({
        id: tournaments.id,
        playerCount: tournaments.playerCount,
      })
      .from(tournaments)
      .where(
        and(
          eq(tournaments.isShowcase, true),
          inArray(tournaments.status, ["waiting", "active"]),
        ),
      )
      .for("update");
    const rows: Array<typeof tournaments.$inferSelect> = [];
    const now = new Date();
    for (
      let index = current.length;
      index < settings.count;
      index += 1
    ) {
      const playerCount =
        settings.sizes[index % settings.sizes.length] ?? 8;
      const [tournament] = await transaction
        .insert(tournaments)
        .values({
          title: `Live Forest Showcase ${playerCount}P`,
          playerCount,
          boardType: "4p",
          gameMode:
            index % 3 === 0
              ? "classic"
              : index % 3 === 1
                ? "quick"
                : "master",
          type: "free",
          joinFee: "0",
          prizePool: String(playerCount * 100),
          adminCommission: "0",
          prizeFirst: "70",
          prizeSecond: "30",
          playerType: "bot",
          isShowcase: true,
          status: "waiting",
          countdownDuration: 15,
          countdownEndsAt: addSeconds(now, 15),
          betweenRoundSeconds: 30,
          totalRounds: getTournamentTotalRounds(playerCount, "4p"),
        })
        .returning();
      if (!tournament) continue;
      await fillTournamentBotsInTransaction(
        transaction,
        tournament,
        now,
      );
      rows.push(tournament);
    }
    return rows;
  });

  for (const tournament of created) {
    emitTournamentMutation(io, tournament.id, [], "showcase_created");
  }
  return { created, settings };
}

export async function getMixedAutoSettings(): Promise<MixedAutoSettings> {
  const values = await getSettings(MIXED_AUTO_SETTING_KEYS);
  const seconds = Number(values["tournament.mixed_auto_countdown_seconds"]);
  return {
    enabled: values["tournament.mixed_auto_enabled"] !== "false",
    countdownSeconds:
      Number.isInteger(seconds) && seconds >= 5 && seconds <= 300
        ? seconds
        : 15,
  };
}

export async function updateMixedAutoSettings(input: {
  settings: MixedAutoSettings;
  actorId: string;
  ipAddress: string;
  io?: Server;
}) {
  await updateSettingsWithAudit({
    values: {
      "tournament.mixed_auto_enabled": String(input.settings.enabled),
      "tournament.mixed_auto_countdown_seconds": String(
        input.settings.countdownSeconds,
      ),
    },
    actorId: input.actorId,
    ipAddress: input.ipAddress,
    action: "tournament.mixed_auto.settings",
    targetType: "tournament_settings",
  });
  const settings = await getMixedAutoSettings();
  if (settings.enabled) {
    await ensureMixedAutoTournaments(input.io);
  }
  return settings;
}

export async function ensureMixedAutoTournaments(io?: Server) {
  const settings = await getMixedAutoSettings();
  if (!settings.enabled) return { created: [], settings };

  await ensureShowcaseBotPool(MIXED_AUTO_BOT_PREFILL + 8);

  const created = await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext('prizejito-mixed-auto-tournaments'))`,
    );
    const [waiting] = await transaction
      .select({ id: tournaments.id })
      .from(tournaments)
      .where(
        and(
          eq(tournaments.recurringTemplateKey, MIXED_AUTO_TEMPLATE_KEY),
          eq(tournaments.status, "waiting"),
        ),
      )
      .limit(1)
      .for("update");
    if (waiting) return [];

    const now = new Date();
    const [tournament] = await transaction
      .insert(tournaments)
      .values({
        title: "Mixed 16P Quick Lobby",
        playerCount: MIXED_AUTO_PLAYER_COUNT,
        boardType: "4p",
        gameMode: "classic",
        type: "free",
        joinFee: "0",
        prizePool: "1600",
        adminCommission: "0",
        prizeFirst: "70",
        prizeSecond: "30",
        playerType: "mixed",
        isRecurring: true,
        recurringTemplateKey: MIXED_AUTO_TEMPLATE_KEY,
        isShowcase: false,
        status: "waiting",
        countdownDuration: settings.countdownSeconds,
        countdownEndsAt: null,
        betweenRoundSeconds: 30,
        totalRounds: getTournamentTotalRounds(
          MIXED_AUTO_PLAYER_COUNT,
          "4p",
        ),
      })
      .returning();
    if (!tournament) return [];

    await fillTournamentBotsInTransaction(
      transaction,
      tournament,
      now,
      MIXED_AUTO_BOT_PREFILL,
    );
    return [tournament];
  });

  for (const tournament of created) {
    emitTournamentMutation(io, tournament.id, [], "mixed_auto_created");
  }
  return { created, settings };
}

export async function ensureTestRecurringTournaments(io?: Server) {
  const settings = await getSettings([TEST_RECURRING_ENABLED_SETTING]);
  if (settings[TEST_RECURRING_ENABLED_SETTING] === "false") {
    return { created: [] as Array<typeof tournaments.$inferSelect> };
  }

  const maxBotSlots = Math.max(
    ...TEST_RECURRING_TEMPLATES.map((template) => template.botSlots),
  );
  await ensureShowcaseBotPool(maxBotSlots + 8);

  const created = await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext('prizejito-test-recurring-tournaments'))`,
    );
    const now = new Date();
    const inserted: Array<typeof tournaments.$inferSelect> = [];
    for (const template of TEST_RECURRING_TEMPLATES) {
      const [waiting] = await transaction
        .select({ id: tournaments.id })
        .from(tournaments)
        .where(
          and(
            eq(tournaments.recurringTemplateKey, template.key),
            eq(tournaments.status, "waiting"),
          ),
        )
        .limit(1)
        .for("update");
      if (waiting) continue;

      const [tournament] = await transaction
        .insert(tournaments)
        .values({
          title: template.title,
          playerCount: template.playerCount,
          boardType: template.boardType,
          gameMode: "classic",
          type: template.type,
          joinFee: template.joinFee,
          prizePool: template.prizePool,
          adminCommission: template.adminCommission,
          prizeFirst: template.prizeFirst,
          prizeSecond: template.prizeSecond,
          playerType: "mixed",
          isRecurring: true,
          recurringTemplateKey: template.key,
          status: "waiting",
          countdownDuration: template.countdownDuration,
          countdownEndsAt: null,
          betweenRoundSeconds: template.betweenRoundSeconds,
          totalRounds: getTournamentTotalRounds(
            template.playerCount,
            template.boardType,
          ),
        })
        .returning();
      if (!tournament) continue;

      await fillTournamentBotsInTransaction(
        transaction,
        tournament,
        now,
        template.botSlots,
      );
      inserted.push(tournament);
    }
    return inserted;
  });

  for (const tournament of created) {
    emitTournamentMutation(io, tournament.id, [], "test_recurring_created");
  }
  return { created };
}

export async function ensureTournamentIntegrity(): Promise<void> {
  const now = new Date();
  const rows = await db.select().from(tournaments);
  for (const tournament of rows) {
    const totalRounds = getTournamentTotalRounds(
      tournament.playerCount,
      tournament.boardType,
    );
    if (tournament.totalRounds !== totalRounds) {
      await db
        .update(tournaments)
        .set({ totalRounds, updatedAt: now })
        .where(eq(tournaments.id, tournament.id));
    }
  }
  await db
    .update(tournamentEntries)
    .set({
      joinedAt: sql`coalesce(${tournamentEntries.joinedAt}, ${tournamentEntries.createdAt})`,
    })
    .where(
      and(
        eq(tournamentEntries.status, "joined"),
        sql`${tournamentEntries.joinedAt} is null`,
      ),
    );
}

export function getTournamentTotalRounds(
  playerCount: number,
  boardType: TournamentBoardType,
): number {
  const power = Math.log2(playerCount);
  return boardType === "4p" ? Math.max(1, power - 1) : power;
}

export function getTournamentRoundName(
  round: number,
  totalRounds: number,
  boardType: TournamentBoardType,
): string {
  if (round >= totalRounds) {
    return boardType === "4p" ? "Final Board" : "Final";
  }
  const roundsBeforeFinal = totalRounds - round;
  if (boardType === "2p") {
    const names = [
      "Semi Final",
      "Quarter Final",
      "Round of 16",
      "Round of 32",
      "Round of 64",
    ] as const;
    return names[roundsBeforeFinal - 1] ?? `Round ${round}`;
  }
  const names = [
    "Semi Final Board",
    "Quarter Final Board",
    "Round of 16 Board",
    "Round of 32 Board",
    "Round of 64 Board",
  ] as const;
  return names[roundsBeforeFinal - 1] ?? `Round ${round} Board`;
}

export function buildRoundGroups(
  participantIds: string[],
  boardType: TournamentBoardType,
): string[][] {
  const size = boardType === "4p" ? 4 : 2;
  const groups: string[][] = [];
  for (let index = 0; index < participantIds.length; index += size) {
    groups.push(participantIds.slice(index, index + size));
  }
  return groups;
}

function validateTournamentBracketGroups(
  groups: string[][],
  boardType: TournamentBoardType,
) {
  const size = boardType === "4p" ? 4 : 2;
  for (const group of groups) {
    if (group.length === 1) continue;
    if (group.length !== size) {
      throw new AppError(
        500,
        "INVALID_BRACKET_GROUP",
        `${boardType.toUpperCase()} tournament requires groups of ${size} players.`,
      );
    }
  }
}

type TournamentMatchSummary = {
  id: string;
  round: number;
  status: string;
  winnerId: string | null;
  runnerUpId: string | null;
  players: Array<{
    user: {
      id: string;
      gameId: string;
      name: string;
      avatar: string;
      isBot: boolean;
    };
  }>;
};

function getParticipantDisplayStatus(
  entry: typeof tournamentEntries.$inferSelect,
  tournament: typeof tournaments.$inferSelect,
  matches: TournamentMatchSummary[],
): string {
  if (entry.status === "left") return "left";
  if (entry.status === "pre_registered") return "waiting";
  if (tournament.status === "completed") {
    if (entry.finishPosition === 1) return "champion";
    if (entry.finishPosition === 2) return "runner_up";
    return "eliminated";
  }
  if (entry.status === "eliminated") return "eliminated";
  if (tournament.status === "waiting" && entry.status === "joined") {
    return "waiting";
  }
  const activeMatch = matches.find(
    (match) =>
      match.round === tournament.currentRound &&
      match.status !== "completed" &&
      match.status !== "cancelled" &&
      match.players.some(({ user }) => user.id === entry.userId),
  );
  if (activeMatch) return "playing";
  if (entry.status === "joined" && tournament.status === "active") {
    if (tournament.nextRoundAt) return "qualified";
    const playedCurrentRound = matches.some(
      (match) =>
        match.round === tournament.currentRound &&
        match.players.some(({ user }) => user.id === entry.userId),
    );
    if (!playedCurrentRound && tournament.currentRound > 1) {
      return "qualified";
    }
  }
  return entry.status;
}

function findCurrentUserMatch(
  userId: string | undefined,
  tournament: typeof tournaments.$inferSelect,
  matches: TournamentMatchSummary[],
) {
  if (!userId) return null;
  const userMatches = matches.filter((match) =>
    match.players.some(({ user }) => user.id === userId),
  );
  if (userMatches.length === 0) return null;
  const pending =
    userMatches.find(
      (match) =>
        match.status !== "completed" && match.status !== "cancelled",
    ) ?? userMatches.at(-1);
  if (!pending) return null;
  const roundMatches = matches.filter((match) => match.round === pending.round);
  const matchNumber =
    roundMatches.findIndex((match) => match.id === pending.id) + 1;
  return {
    matchId: pending.id,
    round: pending.round,
    roundName: getTournamentRoundName(
      pending.round,
      tournament.totalRounds,
      tournament.boardType,
    ),
    matchNumber: matchNumber > 0 ? matchNumber : 1,
    status: pending.status,
    opponentPlayers: pending.players
      .filter(({ user }) => user.id !== userId)
      .map(({ user }) => ({
        id: user.id,
        name: user.name,
        gameId: user.gameId,
        avatar: user.avatar,
        isBot: user.isBot,
      })),
  };
}

function tournamentFilters(input: {
  type?: TournamentType;
  boardType?: TournamentBoardType;
  gameMode?: TournamentGameMode;
  status?: TournamentStatus;
}) {
  const filters = [];
  if (input.type) filters.push(eq(tournaments.type, input.type));
  if (input.boardType) filters.push(eq(tournaments.boardType, input.boardType));
  if (input.gameMode) filters.push(eq(tournaments.gameMode, input.gameMode));
  if (input.status) filters.push(eq(tournaments.status, input.status));
  return filters;
}

export async function listTournaments(input: {
  userId?: string;
  type?: TournamentType;
  boardType?: TournamentBoardType;
  gameMode?: TournamentGameMode;
  status?: TournamentStatus;
  includeCompleted?: boolean;
}) {
  const filters = tournamentFilters(input);
  if (!input.includeCompleted && !input.status) {
    filters.push(ne(tournaments.status, "completed"));
  }

  const rows = await db
    .select({
      tournament: tournaments,
      joinedCount: sql<number>`count(${tournamentEntries.id}) filter (where ${tournamentEntries.status} = 'joined')::int`,
      currentEntryStatus: input.userId
        ? sql<string | null>`max(case when ${tournamentEntries.userId} = ${input.userId} then ${tournamentEntries.status}::text else null end)`
        : sql<null>`null`,
    })
    .from(tournaments)
    .leftJoin(
      tournamentEntries,
      eq(tournamentEntries.tournamentId, tournaments.id),
    )
    .where(filters.length ? and(...filters) : undefined)
    .groupBy(tournaments.id)
    .orderBy(
      ...(input.userId
        ? [
            sql`case when max(case when ${tournamentEntries.userId} = ${input.userId} and ${tournamentEntries.status} = 'joined' then 1 else 0 end) = 1 then 0 else 1 end`,
          ]
        : []),
      sql`case ${tournaments.status}
        when 'active' then 1
        when 'waiting' then 2
        when 'upcoming' then 3
        else 4 end`,
      asc(tournaments.startsAt),
      desc(tournaments.createdAt),
    )
    .limit(100);

  return rows.map(({ tournament, joinedCount, currentEntryStatus }) => ({
    ...tournament,
    joinedCount,
    currentEntryStatus,
    isCurrent:
      currentEntryStatus === "joined" &&
      ACTIVE_ENTRY_STATUSES.includes(
        tournament.status as (typeof ACTIVE_ENTRY_STATUSES)[number],
      ),
  }));
}

export async function getActiveTournament(userId: string) {
  const [row] = await db
    .select({
      tournament: tournaments,
      entry: tournamentEntries,
    })
    .from(tournamentEntries)
    .innerJoin(
      tournaments,
      eq(tournamentEntries.tournamentId, tournaments.id),
    )
    .where(
      and(
        eq(tournamentEntries.userId, userId),
        eq(tournamentEntries.status, "joined"),
        inArray(tournaments.status, ["waiting", "active"]),
      ),
    )
    .orderBy(desc(tournamentEntries.joinedAt))
    .limit(1);
  return row ?? null;
}

export async function getTournamentDetails(
  tournamentId: string,
  userId?: string,
) {
  const tournament = await db.query.tournaments.findFirst({
    where: eq(tournaments.id, tournamentId),
  });
  if (!tournament) {
    throw new AppError(
      404,
      "TOURNAMENT_NOT_FOUND",
      "Tournament পাওয়া যায়নি।",
    );
  }

  const [entryRows, matchRows, bracketRows, currentEntry] = await Promise.all([
    db
      .select({
        entry: tournamentEntries,
        user: {
          id: users.id,
          gameId: users.gameId,
          name: users.name,
          avatar: users.avatar,
          isBot: users.isBot,
        },
      })
      .from(tournamentEntries)
      .innerJoin(users, eq(tournamentEntries.userId, users.id))
      .where(eq(tournamentEntries.tournamentId, tournamentId))
      .orderBy(asc(tournamentEntries.joinedAt), asc(tournamentEntries.createdAt)),
    db.query.matches.findMany({
      where: eq(matches.tournamentId, tournamentId),
      orderBy: [asc(matches.round), asc(matches.createdAt)],
    }),
    db
      .select({
        bracket: brackets,
        player: {
          id: users.id,
          name: users.name,
          avatar: users.avatar,
          gameId: users.gameId,
          isBot: users.isBot,
        },
      })
      .from(brackets)
      .leftJoin(users, eq(brackets.playerId, users.id))
      .where(eq(brackets.tournamentId, tournamentId))
      .orderBy(asc(brackets.round), asc(brackets.position)),
    userId
      ? db.query.tournamentEntries.findFirst({
          where: and(
            eq(tournamentEntries.tournamentId, tournamentId),
            eq(tournamentEntries.userId, userId),
          ),
        })
      : Promise.resolve(undefined),
  ]);

  const matchDetails = await Promise.all(
    matchRows.map(async (match) => {
      const players = await db
        .select({
          participant: matchPlayers,
          user: {
            id: users.id,
            gameId: users.gameId,
            isBot: users.isBot,
            name: users.name,
            avatar: users.avatar,
          },
        })
        .from(matchPlayers)
        .innerJoin(users, eq(matchPlayers.userId, users.id))
        .where(eq(matchPlayers.matchId, match.id))
        .orderBy(asc(matchPlayers.seat));
      return {
        ...match,
        roundName: getTournamentRoundName(
          match.round,
          tournament.totalRounds,
          tournament.boardType,
        ),
        players,
      };
    }),
  );

  return {
    tournament,
    joinedCount: entryRows.filter((row) => row.entry.status === "joined")
      .length,
    entries: entryRows.map((row) => ({
      ...row,
      participantStatus: getParticipantDisplayStatus(
        row.entry,
        tournament,
        matchDetails,
      ),
    })),
    matches: matchDetails.map((match, index, allMatches) => ({
      ...match,
      matchNumber:
        allMatches.filter((item) => item.round === match.round).findIndex(
          (item) => item.id === match.id,
        ) + 1,
    })),
    bracket: bracketRows,
    currentEntry: currentEntry
      ? {
          ...currentEntry,
          participantStatus: getParticipantDisplayStatus(
            currentEntry,
            tournament,
            matchDetails,
          ),
        }
      : null,
    currentMatch: findCurrentUserMatch(userId, tournament, matchDetails),
    serverTime: new Date(),
  };
}

async function findActiveEntryForUpdate(
  transaction: DatabaseTransaction,
  userId: string,
  excludeTournamentId?: string,
) {
  const conditions = [
    eq(tournamentEntries.userId, userId),
    eq(tournamentEntries.status, "joined"),
    inArray(tournaments.status, ["waiting", "active"]),
  ];
  if (excludeTournamentId) {
    conditions.push(ne(tournaments.id, excludeTournamentId));
  }
  const [row] = await transaction
    .select({
      entryId: tournamentEntries.id,
      tournamentId: tournaments.id,
      title: tournaments.title,
    })
    .from(tournamentEntries)
    .innerJoin(
      tournaments,
      eq(tournamentEntries.tournamentId, tournaments.id),
    )
    .where(and(...conditions))
    .limit(1);
  return row;
}

async function evictOneBotEntryInTransaction(
  transaction: DatabaseTransaction,
  tournamentId: string,
  now: Date,
) {
  const [botEntry] = await transaction
    .select({ id: tournamentEntries.id })
    .from(tournamentEntries)
    .innerJoin(users, eq(tournamentEntries.userId, users.id))
    .where(
      and(
        eq(tournamentEntries.tournamentId, tournamentId),
        eq(tournamentEntries.status, "joined"),
        eq(users.isBot, true),
      ),
    )
    .orderBy(desc(tournamentEntries.joinedAt))
    .limit(1)
    .for("update");
  if (!botEntry) {
    throw new AppError(409, "TOURNAMENT_FULL", "Tournament slot পূর্ণ।");
  }
  await transaction
    .update(tournamentEntries)
    .set({ status: "left", leftAt: now, updatedAt: now })
    .where(eq(tournamentEntries.id, botEntry.id));
}

async function joinTournamentInTransaction(
  transaction: DatabaseTransaction,
  tournament: typeof tournaments.$inferSelect,
  userId: string,
  now: Date,
): Promise<JoinResult> {
  if (tournament.status !== "waiting") {
    throw new AppError(
      409,
      "TOURNAMENT_NOT_JOINABLE",
      "এই tournament এখন join করা যাবে না।",
    );
  }
  if (tournament.playerType === "bot") {
    throw new AppError(
      409,
      "BOT_ONLY_TOURNAMENT",
      "এই tournament শুধু bot player-এর জন্য।",
    );
  }

  const [user] = await transaction
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .for("update");
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User পাওয়া যায়নি।");
  }

  const [existing] = await transaction
    .select()
    .from(tournamentEntries)
    .where(
      and(
        eq(tournamentEntries.tournamentId, tournament.id),
        eq(tournamentEntries.userId, userId),
      ),
    )
    .limit(1)
    .for("update");
  if (existing?.status === "joined") {
    return {
      entry: existing,
      user,
      notification: null,
      alreadyJoined: true,
    };
  }
  if (
    existing &&
    (existing.status === "left" || existing.status === "eliminated")
  ) {
    throw new AppError(
      409,
      "TOURNAMENT_ALREADY_PARTICIPATED",
      "এই tournament-এ আপনি আগেই join করেছেন।",
    );
  }

  const active = await findActiveEntryForUpdate(
    transaction,
    userId,
    tournament.id,
  );
  if (active) {
    throw new AppError(
      409,
      "ACTIVE_TOURNAMENT_EXISTS",
      `আগে ${active.title} tournament শেষ করুন অথবা leave করুন।`,
    );
  }

  const [joinedRow] = await transaction
    .select({ count: count() })
    .from(tournamentEntries)
    .where(
      and(
        eq(tournamentEntries.tournamentId, tournament.id),
        eq(tournamentEntries.status, "joined"),
      ),
    );
  let joinedCount = Number(joinedRow?.count ?? 0);
  if (
    isMixedAutoTournament(tournament) &&
    !user.isBot &&
    joinedCount >= tournament.playerCount
  ) {
    await evictOneBotEntryInTransaction(transaction, tournament.id, now);
    joinedCount -= 1;
  }
  if (joinedCount >= tournament.playerCount) {
    throw new AppError(409, "TOURNAMENT_FULL", "Tournament slot পূর্ণ।");
  }

  const feeCents =
    tournament.type === "paid" ? moneyToCents(tournament.joinFee) : 0;
  const mainBalanceCents = moneyToCents(user.mainBalance);
  const winnerBalanceCents = moneyToCents(user.winnerBalance);
  if (mainBalanceCents + winnerBalanceCents < feeCents) {
    throw new AppError(
      409,
      "INSUFFICIENT_BALANCE",
      "Tournament join fee-এর জন্য Main ও Winner Balance মিলিয়েও পর্যাপ্ত টাকা নেই।",
    );
  }
  const mainDebitCents = Math.min(mainBalanceCents, feeCents);
  const winnerDebitCents = feeCents - mainDebitCents;
  const fee = centsToMoney(feeCents);
  const mainDebit = centsToMoney(mainDebitCents);
  const winnerDebit = centsToMoney(winnerDebitCents);
  let updatedUser = user;
  if (feeCents > 0) {
    const [debitedUser] = await transaction
      .update(users)
      .set({
        mainBalance: sql`${users.mainBalance} - cast(${mainDebit} as numeric)`,
        winnerBalance: sql`${users.winnerBalance} - cast(${winnerDebit} as numeric)`,
        updatedAt: now,
      })
      .where(eq(users.id, userId))
      .returning();
    updatedUser = debitedUser!;
    const feeTransactions = [
      ...(mainDebitCents > 0
        ? [{
            userId,
            type: "tournament_fee" as const,
            amount: mainDebit,
            status: "success" as const,
            balanceSource: "main" as const,
            balanceAppliedAt: now,
            relatedTournamentId: tournament.id,
            reference: `tournament-fee-main-${randomUUID()}`,
            metadata: { tournamentTitle: tournament.title },
          }]
        : []),
      ...(winnerDebitCents > 0
        ? [{
            userId,
            type: "tournament_fee" as const,
            amount: winnerDebit,
            status: "success" as const,
            balanceSource: "winner" as const,
            balanceAppliedAt: now,
            relatedTournamentId: tournament.id,
            reference: `tournament-fee-winner-${randomUUID()}`,
            metadata: { tournamentTitle: tournament.title },
          }]
        : []),
    ];
    await transaction.insert(transactions).values(feeTransactions);
  }

  const legacyBalanceSource =
    mainDebitCents > 0 && winnerDebitCents === 0
      ? "main"
      : winnerDebitCents > 0 && mainDebitCents === 0
        ? "winner"
        : "none";

  const [entry] = existing
    ? await transaction
        .update(tournamentEntries)
        .set({
          status: "joined",
          paidAmount: fee,
          paidMainAmount: mainDebit,
          paidWinnerAmount: winnerDebit,
          balanceSource: legacyBalanceSource,
          joinedAt: now,
          leftAt: null,
          finishPosition: null,
          prizeEarned: "0",
          updatedAt: now,
        })
        .where(eq(tournamentEntries.id, existing.id))
        .returning()
    : await transaction
        .insert(tournamentEntries)
        .values({
          tournamentId: tournament.id,
          userId,
          status: "joined",
          paidAmount: fee,
          paidMainAmount: mainDebit,
          paidWinnerAmount: winnerDebit,
          balanceSource: legacyBalanceSource,
          joinedAt: now,
        })
        .returning();

  const nextJoinedCount = joinedCount + 1;
  const fullCountdown = addSeconds(now, tournament.countdownDuration);
  const mixedAutoRealJoin =
    isMixedAutoTournament(tournament) && !user.isBot;
  const countdownEndsAt = mixedAutoRealJoin
    ? tournament.countdownEndsAt ?? fullCountdown
    : nextJoinedCount === tournament.playerCount
      ? tournament.countdownEndsAt &&
        tournament.countdownEndsAt.getTime() < fullCountdown.getTime()
        ? tournament.countdownEndsAt
        : fullCountdown
      : null;

  await transaction
    .update(tournaments)
    .set({
      collectedFees: sql`${tournaments.collectedFees} + cast(${fee} as numeric)`,
      countdownEndsAt,
      updatedAt: now,
    })
    .where(eq(tournaments.id, tournament.id));

  const [notification] = await transaction
    .insert(notifications)
    .values({
      userId,
      title: "Tournament join সম্পন্ন",
      message: mixedAutoRealJoin
        ? `${tournament.title}: ${tournament.countdownDuration} সেকেন্ড পরে শুরু হবে।`
        : nextJoinedCount === tournament.playerCount
          ? `${tournament.title} পূর্ণ হয়েছে। ম্যাচ ${tournament.countdownDuration} সেকেন্ড পরে শুরু হবে।`
          : `${tournament.title}-এ আপনার slot নিশ্চিত হয়েছে।`,
    })
    .returning();

  return {
    entry: entry!,
    user: updatedUser!,
    notification: notification!,
    alreadyJoined: false,
  };
}

export async function joinTournament(
  tournamentId: string,
  userId: string,
): Promise<JoinResult & { tournament: typeof tournaments.$inferSelect }> {
  return db.transaction(async (transaction) => {
    const [tournament] = await transaction
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId))
      .for("update");
    if (!tournament) {
      throw new AppError(
        404,
        "TOURNAMENT_NOT_FOUND",
        "Tournament পাওয়া যায়নি।",
      );
    }
    const result = await joinTournamentInTransaction(
      transaction,
      tournament,
      userId,
      new Date(),
    );
    return { ...result, tournament };
  });
}

export async function leaveTournament(tournamentId: string, userId: string) {
  return db.transaction(async (transaction) => {
    const [tournament] = await transaction
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId))
      .for("update");
    if (!tournament) {
      throw new AppError(
        404,
        "TOURNAMENT_NOT_FOUND",
        "Tournament পাওয়া যায়নি।",
      );
    }
    if (tournament.status !== "waiting") {
      throw new AppError(
        409,
        "TOURNAMENT_LEAVE_CLOSED",
        "Tournament শুরু হওয়ার পরে leave করা যাবে না।",
      );
    }
    if (tournament.countdownEndsAt) {
      throw new AppError(
        409,
        "TOURNAMENT_LEAVE_CLOSED",
        "স্লট পূর্ণ হয়ে কাউন্টডাউন শুরু হওয়ার পর leave করা যাবে না।",
      );
    }

    const [entry] = await transaction
      .select()
      .from(tournamentEntries)
      .where(
        and(
          eq(tournamentEntries.tournamentId, tournamentId),
          eq(tournamentEntries.userId, userId),
          eq(tournamentEntries.status, "joined"),
        ),
      )
      .for("update");
    if (!entry) {
      throw new AppError(409, "NOT_JOINED", "আপনি এই tournament-এ joined নন।");
    }

    const now = new Date();
    const {
      mainCents: mainRefundCents,
      winnerCents: winnerRefundCents,
      totalCents: refundCents,
    } = getEntryPaymentSplit(entry);
    let updatedUser = await transaction.query.users.findFirst({
      where: eq(users.id, userId),
    });
    if (refundCents > 0) {
      const refund = centsToMoney(refundCents);
      const mainRefund = centsToMoney(mainRefundCents);
      const winnerRefund = centsToMoney(winnerRefundCents);
      [updatedUser] = await transaction
        .update(users)
        .set({
          mainBalance: sql`${users.mainBalance} + cast(${mainRefund} as numeric)`,
          winnerBalance: sql`${users.winnerBalance} + cast(${winnerRefund} as numeric)`,
          updatedAt: now,
        })
        .where(eq(users.id, userId))
        .returning();
      const refundTransactions = [
        ...(mainRefundCents > 0
          ? [{
              userId,
              type: "tournament_refund" as const,
              amount: mainRefund,
              status: "success" as const,
              balanceSource: "main" as const,
              balanceAppliedAt: now,
              relatedTournamentId: tournament.id,
              reference: `tournament-refund-main-${randomUUID()}`,
              metadata: { tournamentTitle: tournament.title },
            }]
          : []),
        ...(winnerRefundCents > 0
          ? [{
              userId,
              type: "tournament_refund" as const,
              amount: winnerRefund,
              status: "success" as const,
              balanceSource: "winner" as const,
              balanceAppliedAt: now,
              relatedTournamentId: tournament.id,
              reference: `tournament-refund-winner-${randomUUID()}`,
              metadata: { tournamentTitle: tournament.title },
            }]
          : []),
      ];
      await transaction.insert(transactions).values(refundTransactions);
      await transaction
        .update(tournaments)
        .set({
          collectedFees: sql`${tournaments.collectedFees} - cast(${refund} as numeric)`,
          countdownEndsAt: null,
          updatedAt: now,
        })
        .where(eq(tournaments.id, tournament.id));
    }

    const [updatedEntry] = await transaction
      .update(tournamentEntries)
      .set({
        status: "left",
        leftAt: now,
        paidAmount: "0",
        paidMainAmount: "0",
        paidWinnerAmount: "0",
        balanceSource: "none",
        updatedAt: now,
      })
      .where(eq(tournamentEntries.id, entry.id))
      .returning();
    await transaction
      .update(tournaments)
      .set({ countdownEndsAt: null, updatedAt: now })
      .where(eq(tournaments.id, tournament.id));
    const [notification] = await transaction
      .insert(notifications)
      .values({
        userId,
        title: "Tournament leave হয়েছে",
        message:
          refundCents > 0
            ? `${tournament.title}-এর join fee যে balance থেকে কাটা হয়েছিল, সেই একই ভাগে ফেরত দেওয়া হয়েছে।`
            : `${tournament.title} থেকে আপনি leave করেছেন।`,
      })
      .returning();
    return {
      entry: updatedEntry!,
      user: updatedUser!,
      tournament,
      notification: notification!,
    };
  });
}

function normalizeTournamentInput(input: TournamentInput) {
  if (input.boardType === "4p" && input.playerCount < 4) {
    throw new AppError(
      400,
      "INVALID_TOURNAMENT_SIZE",
      "4-player board tournaments require at least 4 players.",
    );
  }
  const joinFee =
    input.type === "free" ? "0.00" : centsToMoney(moneyToCents(input.joinFee));
  const prizePool = centsToMoney(moneyToCents(input.prizePool));
  const prizeFirst = input.prizeFirst;
  let prizeSecond = input.prizeSecond;
  if (input.boardType === "2p" && prizeSecond < 0) {
    throw new AppError(
      400,
      "INVALID_PRIZE_SPLIT",
      "2-player tournaments cannot use a negative runner-up prize.",
    );
  }
  if (input.boardType === "2p" && prizeSecond > 0 && prizeFirst + prizeSecond !== 100) {
    throw new AppError(
      400,
      "INVALID_PRIZE_SPLIT",
      "1st এবং 2nd prize split মোট 100% হতে হবে।",
    );
  }
  if (input.boardType === "2p" && prizeSecond === 0 && prizeFirst !== 100) {
    prizeSecond = 0;
    if (prizeFirst !== 100) {
      throw new AppError(
        400,
        "INVALID_PRIZE_SPLIT",
        "2-player tournaments without runner-up prize must give 100% to the winner.",
      );
    }
  }
  if (input.boardType === "4p" && prizeFirst + prizeSecond !== 100) {
    throw new AppError(
      400,
      "INVALID_PRIZE_SPLIT",
      "1st এবং 2nd prize split মোট 100% হতে হবে।",
    );
  }
  return {
    ...input,
    joinFee,
    prizePool,
    prizeFirst,
    prizeSecond,
    totalRounds: getTournamentTotalRounds(input.playerCount, input.boardType),
  };
}

export async function createTournament(input: {
  tournament: TournamentInput;
  actorId: string;
  ipAddress: string;
}) {
  const value = normalizeTournamentInput(input.tournament);
  const now = new Date();
  const startsAt = value.startsAt ?? null;
  if (value.status === "upcoming" && !startsAt) {
    throw new AppError(
      400,
      "START_TIME_REQUIRED",
      "Upcoming tournament-এর start time দিন।",
    );
  }
  return db.transaction(async (transaction) => {
    const [tournament] = await transaction
      .insert(tournaments)
      .values({
        title: value.title,
        playerCount: value.playerCount,
        boardType: value.boardType,
        gameMode: value.gameMode,
        type: value.type,
        joinFee: value.joinFee,
        prizePool: value.prizePool,
        adminCommission: String(value.adminCommission),
        prizeFirst: String(value.prizeFirst),
        prizeSecond: String(value.prizeSecond),
        playerType: value.playerType,
        countdownDuration: value.countdownDuration,
        betweenRoundSeconds: value.betweenRoundSeconds,
        status: value.status,
        startsAt,
        countdownEndsAt: null,
        totalRounds: value.totalRounds,
      })
      .returning();
    await transaction.insert(adminAuditLogs).values({
      actorId: input.actorId,
      action: "tournament.create",
      targetType: "tournament",
      targetId: tournament!.id,
      ipAddress: input.ipAddress,
      details: {
        playerCount: value.playerCount,
        boardType: value.boardType,
        type: value.type,
      },
    });
    return tournament!;
  });
}

export async function updateTournament(input: {
  tournamentId: string;
  tournament: TournamentInput;
  actorId: string;
  ipAddress: string;
}) {
  const value = normalizeTournamentInput(input.tournament);
  return db.transaction(async (transaction) => {
    const [current] = await transaction
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, input.tournamentId))
      .for("update");
    if (!current) {
      throw new AppError(
        404,
        "TOURNAMENT_NOT_FOUND",
        "Tournament পাওয়া যায়নি।",
      );
    }
    if (current.status === "active" || current.status === "completed") {
      throw new AppError(
        409,
        "TOURNAMENT_ALREADY_STARTED",
        "শুরু হওয়া tournament edit করা যাবে না।",
      );
    }
    const [joinedRow] = await transaction
      .select({ count: count() })
      .from(tournamentEntries)
      .where(
        and(
          eq(tournamentEntries.tournamentId, current.id),
          eq(tournamentEntries.status, "joined"),
        ),
      );
    const joinedCount = Number(joinedRow?.count ?? 0);
    if (joinedCount > value.playerCount) {
      throw new AppError(
        409,
        "PLAYER_COUNT_TOO_SMALL",
        "Joined player-এর চেয়ে player count কমানো যাবে না।",
      );
    }
    if (value.status === "upcoming" && !value.startsAt) {
      throw new AppError(
        400,
        "START_TIME_REQUIRED",
        "Upcoming tournament-এর start time দিন।",
      );
    }
    const now = new Date();
    const [updated] = await transaction
      .update(tournaments)
      .set({
        title: value.title,
        playerCount: value.playerCount,
        boardType: value.boardType,
        gameMode: value.gameMode,
        type: value.type,
        joinFee: value.joinFee,
        prizePool: value.prizePool,
        adminCommission: String(value.adminCommission),
        prizeFirst: String(value.prizeFirst),
        prizeSecond: String(value.prizeSecond),
        playerType: value.playerType,
        countdownDuration: value.countdownDuration,
        betweenRoundSeconds: value.betweenRoundSeconds,
        status: value.status,
        startsAt: value.startsAt ?? null,
        countdownEndsAt:
          value.status === "waiting" && joinedCount === value.playerCount
            ? current.countdownEndsAt ?? addSeconds(now, value.countdownDuration)
            : null,
        totalRounds: value.totalRounds,
        updatedAt: now,
      })
      .where(eq(tournaments.id, current.id))
      .returning();
    await transaction.insert(adminAuditLogs).values({
      actorId: input.actorId,
      action: "tournament.update",
      targetType: "tournament",
      targetId: current.id,
      ipAddress: input.ipAddress,
      details: { previousStatus: current.status, status: value.status },
    });
    return updated!;
  });
}

export async function deleteTournament(input: {
  tournamentId: string;
  actorId: string;
  ipAddress: string;
}) {
  return db.transaction(async (transaction) => {
    const [tournament] = await transaction
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, input.tournamentId))
      .for("update");
    if (!tournament) {
      throw new AppError(
        404,
        "TOURNAMENT_NOT_FOUND",
        "Tournament পাওয়া যায়নি।",
      );
    }
    if (tournament.status === "active" || tournament.status === "completed") {
      throw new AppError(
        409,
        "TOURNAMENT_ALREADY_STARTED",
        "শুরু হওয়া tournament delete করা যাবে না।",
      );
    }
    const joinedEntries = await transaction
      .select()
      .from(tournamentEntries)
      .where(
        and(
          eq(tournamentEntries.tournamentId, tournament.id),
          eq(tournamentEntries.status, "joined"),
        ),
      )
      .for("update");
    const now = new Date();
    for (const entry of joinedEntries) {
      const {
        mainCents: mainRefundCents,
        winnerCents: winnerRefundCents,
        totalCents: refundCents,
      } = getEntryPaymentSplit(entry);
      if (refundCents > 0) {
        const mainRefund = centsToMoney(mainRefundCents);
        const winnerRefund = centsToMoney(winnerRefundCents);
        await transaction
          .update(users)
          .set({
            mainBalance: sql`${users.mainBalance} + cast(${mainRefund} as numeric)`,
            winnerBalance: sql`${users.winnerBalance} + cast(${winnerRefund} as numeric)`,
            updatedAt: now,
          })
          .where(eq(users.id, entry.userId));
        const refundTransactions = [
          ...(mainRefundCents > 0
            ? [{
                userId: entry.userId,
                type: "tournament_refund" as const,
                amount: mainRefund,
                status: "success" as const,
                balanceSource: "main" as const,
                balanceAppliedAt: now,
                relatedTournamentId: tournament.id,
                reference: `tournament-delete-refund-main-${randomUUID()}`,
                metadata: { tournamentTitle: tournament.title },
              }]
            : []),
          ...(winnerRefundCents > 0
            ? [{
                userId: entry.userId,
                type: "tournament_refund" as const,
                amount: winnerRefund,
                status: "success" as const,
                balanceSource: "winner" as const,
                balanceAppliedAt: now,
                relatedTournamentId: tournament.id,
                reference: `tournament-delete-refund-winner-${randomUUID()}`,
                metadata: { tournamentTitle: tournament.title },
              }]
            : []),
        ];
        await transaction.insert(transactions).values(refundTransactions);
      }
      await transaction.insert(notifications).values({
        userId: entry.userId,
        title: "Tournament বাতিল হয়েছে",
        message:
          refundCents > 0
            ? `${tournament.title} বাতিল হয়েছে এবং fee ফেরত দেওয়া হয়েছে।`
            : `${tournament.title} বাতিল হয়েছে।`,
      });
    }
    await transaction.insert(adminAuditLogs).values({
      actorId: input.actorId,
      action: "tournament.delete",
      targetType: "tournament",
      targetId: tournament.id,
      ipAddress: input.ipAddress,
      details: { refundedPlayers: joinedEntries.length },
    });
    await transaction.delete(tournaments).where(eq(tournaments.id, tournament.id));
    return { tournamentId: tournament.id, refundedUserIds: joinedEntries.map((entry) => entry.userId) };
  });
}

async function createRoundInTransaction(
  transaction: DatabaseTransaction,
  tournament: typeof tournaments.$inferSelect,
  round: number,
  participantIds: string[],
  readySeconds: number,
  now: Date,
): Promise<RoundCreationResult> {
  const groups = buildRoundGroups(participantIds, tournament.boardType);
  validateTournamentBracketGroups(groups, tournament.boardType);
  const botRows =
    participantIds.length === 0
      ? []
      : await transaction
          .select({ userId: botPlayers.userId })
          .from(botPlayers)
          .where(
            and(
              inArray(botPlayers.userId, participantIds),
              eq(botPlayers.isActive, true),
            ),
          );
  const botUserIds = new Set(
    botRows.flatMap((row) => (row.userId ? [row.userId] : [])),
  );
  const matchIds: string[] = [];
  const userIds: string[] = [];
  let bracketPosition = 1;

  for (const group of groups) {
    const autoAdvance = group.length === 1;
    const playable = group.length > 1;
    const game = playable
      ? createInitialGame(
          group,
          tournament.boardType,
          tournament.gameMode,
          now,
        )
      : null;
    const [match] = await transaction
      .insert(matches)
      .values({
        tournamentId: tournament.id,
        round,
        player1Id: group[0] ?? null,
        player2Id: group[1] ?? null,
        player3Id: group[2] ?? null,
        player4Id: group[3] ?? null,
        winnerId: autoAdvance ? group[0] : null,
        status: autoAdvance ? "completed" : "active",
        readyDeadline: null,
        startedAt: autoAdvance || playable ? now : null,
        endedAt: autoAdvance ? now : null,
      })
      .returning();
    matchIds.push(match!.id);
    userIds.push(...group);

    if (group.length > 0) {
      await transaction.insert(matchPlayers).values(
        group.map((userId, index) => ({
          matchId: match!.id,
          userId,
          seat: index + 1,
          isEliminated: false,
          placement: autoAdvance ? 1 : null,
          connectedAt: botUserIds.has(userId) ? now : null,
          lastSeenAt: botUserIds.has(userId) ? now : null,
        })),
      );
      await transaction.insert(brackets).values(
        group.map((userId) => ({
          tournamentId: tournament.id,
          round,
          matchId: match!.id,
          position: bracketPosition++,
          playerId: userId,
          result: autoAdvance ? ("win" as const) : ("waiting" as const),
        })),
      );
    }
    await transaction.insert(gameStates).values({
      matchId: match!.id,
      boardState:
        game?.state ?? {
          phase: autoAdvance ? "completed" : playable ? "ready" : "ready",
          boardType: tournament.boardType,
          gameMode: tournament.gameMode,
          playerOrder: group,
          spectators: 0,
        },
      currentTurn: game?.state.playerOrder[0] ?? null,
      tokenPositions: game?.tokenPositions ?? {},
    });
  }
  await maybeAdvanceAutoCompletedRound(transaction, tournament, round, now);
  return { matchIds, userIds };
}

async function maybeAdvanceAutoCompletedRound(
  transaction: DatabaseTransaction,
  tournament: typeof tournaments.$inferSelect,
  round: number,
  now: Date,
) {
  const { roundMatches } = await getRoundAdvancers(transaction, tournament, round);
  if (roundMatches.length === 0) return;
  const allDone = roundMatches.every(
    (match) => match.status === "completed" || match.status === "cancelled",
  );
  if (allDone) {
    await scheduleNextRoundOrComplete(transaction, tournament, round, now);
  }
}

async function createRecurringReplacementInTransaction(
  transaction: DatabaseTransaction,
  tournament: typeof tournaments.$inferSelect,
  now: Date,
) {
  if (!tournament.isRecurring || !tournament.recurringTemplateKey) return null;
  const [existing] = await transaction
    .select({ id: tournaments.id })
    .from(tournaments)
    .where(
      and(
        eq(tournaments.isRecurring, true),
        eq(tournaments.recurringTemplateKey, tournament.recurringTemplateKey),
        eq(tournaments.status, "waiting"),
      ),
    )
    .limit(1)
    .for("update");
  if (existing) return existing.id;

  const testTemplate = getTestRecurringTemplate(tournament.recurringTemplateKey);
  const playerType = tournament.playerType;

  const [replacement] = await transaction
    .insert(tournaments)
    .values({
      title: tournament.title,
      playerCount: tournament.playerCount,
      boardType: tournament.boardType,
      gameMode: tournament.gameMode,
      type: tournament.type,
      joinFee: tournament.joinFee,
      prizePool: tournament.prizePool,
      adminCommission: tournament.adminCommission,
      prizeFirst: tournament.prizeFirst,
      prizeSecond: tournament.prizeSecond,
      playerType,
      isRecurring: true,
      recurringTemplateKey: tournament.recurringTemplateKey,
      status: "waiting",
      countdownDuration: tournament.countdownDuration,
      countdownEndsAt: null,
      betweenRoundSeconds: tournament.betweenRoundSeconds,
      totalRounds: tournament.totalRounds,
    })
    .returning();
  if (!replacement) return null;

  if (playerType === "mixed") {
    const botSlots =
      testTemplate?.botSlots ??
      Math.max(0, tournament.playerCount - 1);
    await fillTournamentBotsInTransaction(
      transaction,
      replacement,
      now,
      botSlots,
    );
  }
  return replacement.id;
}

async function startTournamentInTransaction(
  transaction: DatabaseTransaction,
  tournament: typeof tournaments.$inferSelect,
  now: Date,
) {
  if (tournament.playerType !== "real") {
    await fillTournamentBotsInTransaction(transaction, tournament, now);
  }
  const entries = await transaction
    .select()
    .from(tournamentEntries)
    .where(
      and(
        eq(tournamentEntries.tournamentId, tournament.id),
        eq(tournamentEntries.status, "joined"),
      ),
    )
    .orderBy(asc(tournamentEntries.joinedAt), asc(tournamentEntries.createdAt))
    .for("update");
  if (entries.length !== tournament.playerCount) {
    await transaction
      .update(tournaments)
      .set({
        countdownEndsAt: null,
        updatedAt: now,
      })
      .where(eq(tournaments.id, tournament.id));
    return { started: false, matchIds: [], userIds: entries.map((entry) => entry.userId) };
  }

  const [started] = await transaction
    .update(tournaments)
    .set({
      status: "active",
      currentRound: 1,
      startsAt: now,
      countdownEndsAt: null,
      nextRoundAt: null,
      updatedAt: now,
    })
    .where(eq(tournaments.id, tournament.id))
    .returning();
  const replacementTournamentId =
    await createRecurringReplacementInTransaction(transaction, started!, now);
  const round = await createRoundInTransaction(
    transaction,
    started!,
    1,
    entries.map((entry) => entry.userId),
    30,
    now,
  );
  await transaction.insert(notifications).values(
    entries.map((entry) => ({
      userId: entry.userId,
      title: "আপনার ম্যাচ শুরু হয়েছে!",
      message: `${tournament.title}: এখনই খেলুন।`,
    })),
  );
  return { started: true, replacementTournamentId, ...round };
}

async function openUpcomingTournamentInTransaction(
  transaction: DatabaseTransaction,
  tournament: typeof tournaments.$inferSelect,
  now: Date,
) {
  const [opened] = await transaction
    .update(tournaments)
    .set({
      status: "waiting",
      countdownEndsAt: null,
      updatedAt: now,
    })
    .where(eq(tournaments.id, tournament.id))
    .returning();
  const queued = await transaction
    .select()
    .from(tournamentEntries)
    .where(
      and(
        eq(tournamentEntries.tournamentId, tournament.id),
        eq(tournamentEntries.status, "pre_registered"),
      ),
    )
    .orderBy(asc(tournamentEntries.createdAt))
    .for("update");
  const joinedUserIds: string[] = [];
  for (const entry of queued) {
    try {
      const joined = await joinTournamentInTransaction(
        transaction,
        opened!,
        entry.userId,
        now,
      );
      joinedUserIds.push(joined.user.id);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      await transaction
        .update(tournamentEntries)
        .set({ status: "left", leftAt: now, updatedAt: now })
        .where(eq(tournamentEntries.id, entry.id));
      await transaction.insert(notifications).values({
        userId: entry.userId,
        title: "Pre-registration join হয়নি",
        message: `${tournament.title}: ${error.message}`,
      });
    }
  }
  return joinedUserIds;
}

async function getRoundAdvancers(
  transaction: DatabaseTransaction,
  tournament: typeof tournaments.$inferSelect,
  round: number,
) {
  const roundMatches = await transaction
    .select()
    .from(matches)
    .where(
      and(
        eq(matches.tournamentId, tournament.id),
        eq(matches.round, round),
      ),
    )
    .orderBy(asc(matches.createdAt));
  const participants: string[] = [];
  for (const match of roundMatches) {
    if (match.winnerId) participants.push(match.winnerId);
    if (tournament.boardType === "4p" && match.runnerUpId) {
      participants.push(match.runnerUpId);
    }
  }
  return { roundMatches, participants };
}

async function awardPrizeInTransaction(
  transaction: DatabaseTransaction,
  tournament: typeof tournaments.$inferSelect,
  winnerId: string | null,
  runnerUpId: string | null,
  now: Date,
) {
  if (tournament.status === "completed") return [];
  const prizePoolCents = moneyToCents(tournament.prizePool);
  const runnerUpShare = Number(tournament.prizeSecond);
  const placements = [
    {
      userId: winnerId,
      position: 1,
      amount: Math.round(
        (prizePoolCents * Number(tournament.prizeFirst)) / 100,
      ),
    },
    ...(runnerUpShare > 0 && runnerUpId
      ? [
          {
            userId: runnerUpId,
            position: 2,
            amount: Math.round((prizePoolCents * runnerUpShare) / 100),
          },
        ]
      : []),
  ].filter(
    (placement): placement is { userId: string; position: number; amount: number } =>
      Boolean(placement.userId) && placement.amount > 0,
  );
  const rewardedUsers: User[] = [];

  for (const placement of placements) {
    const prize = centsToMoney(placement.amount);
    const [bot] = await transaction
      .select()
      .from(botPlayers)
      .where(eq(botPlayers.userId, placement.userId))
      .limit(1);
    if (bot) {
      await transaction
        .update(botPlayers)
        .set({
          wins:
            placement.position === 1
              ? sql`${botPlayers.wins} + 1`
              : botPlayers.wins,
          losses:
            placement.position === 1
              ? botPlayers.losses
              : sql`${botPlayers.losses} + 1`,
          totalEarnings:
            placement.amount > 0
              ? sql`${botPlayers.totalEarnings} + cast(${prize} as numeric)`
              : botPlayers.totalEarnings,
          updatedAt: now,
        })
        .where(eq(botPlayers.id, bot.id));
      if (placement.amount > 0) {
        await transaction.insert(promotionalWins).values({
          botPlayerId: bot.id,
          amount: prize,
          isDisclosed: true,
          createdAt: now,
        });
      }
      await transaction
        .update(tournamentEntries)
        .set({
          status: "eliminated",
          finishPosition: placement.position,
          prizeEarned: prize,
          updatedAt: now,
        })
        .where(
          and(
            eq(tournamentEntries.tournamentId, tournament.id),
            eq(tournamentEntries.userId, placement.userId),
          ),
        );
      continue;
    }
    const [updatedUser] = await transaction
      .update(users)
      .set({
        winnerBalance: sql`${users.winnerBalance} + cast(${prize} as numeric)`,
        updatedAt: now,
      })
      .where(eq(users.id, placement.userId))
      .returning();
    if (updatedUser) rewardedUsers.push(updatedUser);
    await transaction
      .update(tournamentEntries)
      .set({
        status: "eliminated",
        finishPosition: placement.position,
        prizeEarned: prize,
        updatedAt: now,
      })
      .where(
        and(
          eq(tournamentEntries.tournamentId, tournament.id),
          eq(tournamentEntries.userId, placement.userId),
        ),
      );
    if (placement.amount > 0) {
      await transaction.insert(transactions).values({
        userId: placement.userId,
        type: "prize",
        amount: prize,
        status: "success",
        balanceSource: "winner",
        balanceAppliedAt: now,
        relatedTournamentId: tournament.id,
        reference: `tournament-prize-${randomUUID()}`,
        metadata: {
          tournamentTitle: tournament.title,
          position: placement.position,
        },
      });
    }
    await transaction.insert(notifications).values({
      userId: placement.userId,
      title:
        placement.position === 1
          ? "WINNER! আপনি champion!"
          : "অভিনন্দন! আপনি runner-up",
      message: `৳${prize} Winner Balance-এ যোগ হয়েছে।`,
    });
  }

  await transaction
    .update(tournamentEntries)
    .set({ status: "eliminated", updatedAt: now })
    .where(
      and(
        eq(tournamentEntries.tournamentId, tournament.id),
        eq(tournamentEntries.status, "joined"),
      ),
    );
  const adminRevenue = centsToMoney(
    Math.round(
      (moneyToCents(tournament.collectedFees) *
        Number(tournament.adminCommission)) /
        100,
    ),
  );
  await transaction
    .update(tournaments)
    .set({
      status: "completed",
      completedAt: now,
      nextRoundAt: null,
      adminRevenue,
      updatedAt: now,
    })
    .where(eq(tournaments.id, tournament.id));
  return rewardedUsers;
}

async function scheduleNextRoundOrComplete(
  transaction: DatabaseTransaction,
  tournament: typeof tournaments.$inferSelect,
  round: number,
  now: Date,
  allowRunnerUpFallback = true,
) {
  const { roundMatches, participants } = await getRoundAdvancers(
    transaction,
    tournament,
    round,
  );
  if (
    roundMatches.length === 0 ||
    roundMatches.some(
      (match) => match.status !== "completed" && match.status !== "cancelled",
    )
  ) {
    return { completed: false, rewardedUsers: [] as User[] };
  }

  if (round >= tournament.totalRounds || participants.length <= 1) {
    const finalMatch = roundMatches.at(-1);
    const winnerId = participants[0] ?? finalMatch?.winnerId ?? null;
    let runnerUpId = finalMatch?.runnerUpId ?? null;
    if (
      !runnerUpId &&
      tournament.boardType === "2p" &&
      Number(tournament.prizeSecond) > 0 &&
      finalMatch &&
      winnerId &&
      allowRunnerUpFallback
    ) {
      const [runnerUp] = await transaction
        .select({ userId: matchPlayers.userId })
        .from(matchPlayers)
        .where(
          and(
            eq(matchPlayers.matchId, finalMatch.id),
            ne(matchPlayers.userId, winnerId),
          ),
        )
        .limit(1);
      runnerUpId = runnerUp?.userId ?? null;
    }
    const rewardedUsers = await awardPrizeInTransaction(
      transaction,
      tournament,
      winnerId,
      runnerUpId,
      now,
    );
    return { completed: true, rewardedUsers };
  }

  await transaction
    .update(tournaments)
    .set({
      nextRoundAt: addSeconds(now, tournament.betweenRoundSeconds),
      updatedAt: now,
    })
    .where(eq(tournaments.id, tournament.id));
  await transaction.insert(notifications).values(
    participants.map((userId) => ({
      userId,
      title: "পরের round-এর waiting room",
      message: `${tournament.betweenRoundSeconds} সেকেন্ড পরে পরের round ready হবে।`,
    })),
  );
  return { completed: false, rewardedUsers: [] as User[] };
}

export async function completeMatch(input: {
  matchId: string;
  placements: string[];
  actorId?: string;
  ipAddress?: string;
  allowPartialPlacements?: boolean;
}) {
  return db.transaction(async (transaction) => {
    const [match] = await transaction
      .select()
      .from(matches)
      .where(eq(matches.id, input.matchId))
      .for("update");
    if (!match) {
      throw new AppError(404, "MATCH_NOT_FOUND", "Match পাওয়া যায়নি।");
    }
    if (match.status === "completed" || match.status === "cancelled") {
      throw new AppError(409, "MATCH_ALREADY_COMPLETED", "Match শেষ হয়ে গেছে।");
    }
    const [tournament] = await transaction
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, match.tournamentId))
      .for("update");
    if (!tournament || tournament.status !== "active") {
      throw new AppError(409, "TOURNAMENT_NOT_ACTIVE", "Tournament active নয়।");
    }
    const participants = await transaction
      .select()
      .from(matchPlayers)
      .where(eq(matchPlayers.matchId, match.id))
      .for("update");
    const participantIds = new Set(participants.map((item) => item.userId));
    if (
      input.placements.length === 0 ||
      new Set(input.placements).size !== input.placements.length ||
      input.placements.some((userId) => !participantIds.has(userId))
    ) {
      throw new AppError(
        400,
        "INVALID_MATCH_PLACEMENTS",
        "Match participant-এর সঠিক result দিন।",
      );
    }

    if (
      tournament.boardType === "4p" &&
      participants.length >= 2 &&
      input.placements.length < 2 &&
      !input.allowPartialPlacements
    ) {
      throw new AppError(
        400,
        "TOP_TWO_REQUIRED",
        "4-player match requires first and second place.",
      );
    }

    const winnerId = input.placements[0]!;
    const runnerUpId = input.placements[1] ?? null;
    const now = new Date();
    const [updatedMatch] = await transaction
      .update(matches)
      .set({
        winnerId,
        runnerUpId,
        status: "completed",
        startedAt: match.startedAt ?? now,
        endedAt: now,
        readyDeadline: null,
      })
      .where(eq(matches.id, match.id))
      .returning();

    for (const participant of participants) {
      const placementIndex = input.placements.indexOf(participant.userId);
      const advances =
        placementIndex === 0 ||
        (tournament.boardType === "4p" && placementIndex === 1);
      await transaction
        .update(matchPlayers)
        .set({
          placement: placementIndex >= 0 ? placementIndex + 1 : null,
          isEliminated: !advances,
        })
        .where(
          and(
            eq(matchPlayers.matchId, match.id),
            eq(matchPlayers.userId, participant.userId),
          ),
        );
      await transaction
        .update(brackets)
        .set({ result: advances ? "win" : "loss" })
        .where(
          and(
            eq(brackets.matchId, match.id),
            eq(brackets.playerId, participant.userId),
          ),
        );
      if (!advances) {
        await transaction
          .update(tournamentEntries)
          .set({ status: "eliminated", updatedAt: now })
          .where(
            and(
              eq(tournamentEntries.tournamentId, tournament.id),
              eq(tournamentEntries.userId, participant.userId),
              eq(tournamentEntries.status, "joined"),
            ),
          );
      }
    }
    await transaction
      .update(gameStates)
      .set({
        boardState: sql`${gameStates.boardState} || ${JSON.stringify({
          phase: "completed",
          placements: input.placements,
          tournamentResult: {
            tournamentId: tournament.id,
            round: match.round,
            roundName: getTournamentRoundName(
              match.round,
              tournament.totalRounds,
              tournament.boardType,
            ),
            mode: tournament.boardType,
            matchId: match.id,
            winnerId,
            runnerUpId,
            ...(tournament.boardType === "4p"
              ? {
                  firstPlaceUserId: winnerId,
                  secondPlaceUserId: runnerUpId,
                  thirdPlaceUserId:
                    input.placements[2] ??
                    participants.find(
                      (item) =>
                        !input.placements.slice(0, 2).includes(item.userId),
                    )?.userId ??
                    null,
                  fourthPlaceUserId:
                    input.placements[3] ??
                    participants.find(
                      (item) =>
                        item.userId !== winnerId &&
                        item.userId !== runnerUpId &&
                        !input.placements.slice(0, 2).includes(item.userId),
                    )?.userId ??
                    null,
                  qualifiedUserIds: input.placements.slice(0, 2),
                  eliminatedUserIds: participants
                    .filter(
                      (item) => !input.placements.slice(0, 2).includes(item.userId),
                    )
                    .map((item) => item.userId),
                }
              : {
                  loserId:
                    participants.find((item) => item.userId !== winnerId)
                      ?.userId ?? null,
                }),
            boardStatus: "completed",
          },
        })}::jsonb`,
        stateVersion: sql`${gameStates.stateVersion} + 1`,
        updatedAt: now,
      })
      .where(eq(gameStates.matchId, match.id));

    if (input.actorId && input.ipAddress) {
      await transaction.insert(adminAuditLogs).values({
        actorId: input.actorId,
        action: "match.force_complete",
        targetType: "match",
        targetId: match.id,
        ipAddress: input.ipAddress,
        details: { placements: input.placements },
      });
    }

    const progression = await scheduleNextRoundOrComplete(
      transaction,
      tournament,
      match.round,
      now,
      !input.allowPartialPlacements,
    );
    return {
      match: updatedMatch!,
      tournamentId: tournament.id,
      participantIds: participants.map((item) => item.userId),
      rewardedUsers: progression.rewardedUsers,
      tournamentCompleted: progression.completed,
    };
  });
}

export async function connectToMatch(matchId: string, userId: string) {
  return db.transaction(async (transaction) => {
    const [match] = await transaction
      .select()
      .from(matches)
      .where(eq(matches.id, matchId))
      .for("update");
    if (!match || (match.status !== "waiting" && match.status !== "active")) {
      throw new AppError(409, "MATCH_NOT_READY", "Match ready নয়।");
    }
    const [participant] = await transaction
      .select()
      .from(matchPlayers)
      .where(
        and(
          eq(matchPlayers.matchId, matchId),
          eq(matchPlayers.userId, userId),
          eq(matchPlayers.isEliminated, false),
        ),
      )
      .for("update");
    if (!participant) {
      throw new AppError(403, "MATCH_PLAYER_REQUIRED", "আপনি এই match-এর player নন।");
    }
    const now = new Date();
    await transaction
      .update(matchPlayers)
      .set({
        connectedAt: now,
        lastSeenAt: now,
        disconnectedAt: null,
        reconnectDeadline: null,
      })
      .where(
        and(
          eq(matchPlayers.matchId, matchId),
          eq(matchPlayers.userId, userId),
        ),
      );
    const players = await transaction
      .select()
      .from(matchPlayers)
      .where(
        and(
          eq(matchPlayers.matchId, matchId),
          eq(matchPlayers.isEliminated, false),
        ),
      )
      .orderBy(asc(matchPlayers.seat));
    const allConnected = players.every(
      (player) => player.userId === userId || player.connectedAt,
    );
    let updatedMatch = match;
    let started = false;
    if (match.status === "waiting" && allConnected) {
      const tournament = await transaction.query.tournaments.findFirst({
        where: eq(tournaments.id, match.tournamentId),
      });
      if (!tournament) {
        throw new AppError(404, "TOURNAMENT_NOT_FOUND", "Tournament not found.");
      }
      const game = createInitialGame(
        players.map((player) => player.userId),
        tournament.boardType,
        tournament.gameMode,
        now,
      );
      const [startedMatch] = await transaction
        .update(matches)
        .set({ status: "active", startedAt: now, readyDeadline: null })
        .where(eq(matches.id, matchId))
        .returning();
      updatedMatch = startedMatch!;
      started = true;
      await transaction
        .update(gameStates)
        .set({
          boardState: game.state,
          currentTurn: players[0]?.userId ?? null,
          diceValue: null,
          tokenPositions: game.tokenPositions,
          stateVersion: sql`${gameStates.stateVersion} + 1`,
          updatedAt: now,
        })
        .where(eq(gameStates.matchId, matchId));
    }
    return { match: updatedMatch, allConnected, started };
  });
}

export async function getMatchSnapshot(matchId: string) {
  const match = await db.query.matches.findFirst({
    where: eq(matches.id, matchId),
  });
  if (!match) {
    throw new AppError(404, "MATCH_NOT_FOUND", "Match পাওয়া যায়নি।");
  }
  const [players, state] = await Promise.all([
    db
      .select({
        participant: matchPlayers,
        user: {
          id: users.id,
          gameId: users.gameId,
          isBot: users.isBot,
          name: users.name,
          avatar: users.avatar,
        },
      })
      .from(matchPlayers)
      .innerJoin(users, eq(matchPlayers.userId, users.id))
      .where(eq(matchPlayers.matchId, matchId))
      .orderBy(asc(matchPlayers.seat)),
    db.query.gameStates.findFirst({
      where: eq(gameStates.matchId, matchId),
    }),
  ]);
  return { match, players, state, serverTime: new Date() };
}

async function resolveNoShowMatch(
  transaction: DatabaseTransaction,
  match: typeof matches.$inferSelect,
  now: Date,
) {
  const [tournament] = await transaction
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, match.tournamentId))
    .for("update");
  if (!tournament || tournament.status !== "active") return null;
  const players = await transaction
    .select()
    .from(matchPlayers)
    .where(
      and(
        eq(matchPlayers.matchId, match.id),
        eq(matchPlayers.isEliminated, false),
      ),
    )
    .for("update");
  const connected = players.filter((player) => player.connectedAt);
  if (connected.length === players.length) {
    const game = createInitialGame(
      connected.map((player) => player.userId),
      tournament.boardType,
      tournament.gameMode,
      now,
    );
    await transaction
      .update(matches)
      .set({ status: "active", startedAt: now, readyDeadline: null })
      .where(eq(matches.id, match.id));
    await transaction
      .update(gameStates)
      .set({
        boardState: game.state,
        currentTurn: connected[0]?.userId ?? null,
        diceValue: null,
        tokenPositions: game.tokenPositions,
        stateVersion: sql`${gameStates.stateVersion} + 1`,
        updatedAt: now,
      })
      .where(eq(gameStates.matchId, match.id));
    return { tournamentId: tournament.id, userIds: players.map((item) => item.userId) };
  }

  if (tournament.boardType === "4p" && connected.length >= 2) {
    const disconnectedIds = players
      .filter((player) => !player.connectedAt)
      .map((player) => player.userId);
    if (disconnectedIds.length > 0) {
      await transaction
        .update(matchPlayers)
        .set({ isEliminated: true })
        .where(
          and(
            eq(matchPlayers.matchId, match.id),
            inArray(matchPlayers.userId, disconnectedIds),
          ),
        );
      await transaction
        .update(brackets)
        .set({ result: "loss" })
        .where(
          and(
            eq(brackets.matchId, match.id),
            inArray(brackets.playerId, disconnectedIds),
          ),
        );
      await transaction
        .update(tournamentEntries)
        .set({ status: "eliminated", updatedAt: now })
        .where(
          and(
            eq(tournamentEntries.tournamentId, tournament.id),
            inArray(tournamentEntries.userId, disconnectedIds),
            eq(tournamentEntries.status, "joined"),
          ),
        );
    }
    await transaction
      .update(matches)
      .set({ status: "active", startedAt: now, readyDeadline: null })
      .where(eq(matches.id, match.id));
    const game = createInitialGame(
      connected.map((player) => player.userId),
      tournament.boardType,
      tournament.gameMode,
      now,
    );
    await transaction
      .update(gameStates)
      .set({
        boardState: game.state,
        currentTurn: connected[0]?.userId ?? null,
        diceValue: null,
        tokenPositions: game.tokenPositions,
        stateVersion: sql`${gameStates.stateVersion} + 1`,
        updatedAt: now,
      })
      .where(eq(gameStates.matchId, match.id));
    return { tournamentId: tournament.id, userIds: players.map((item) => item.userId) };
  }

  const winnerId = connected[0]?.userId ?? null;
  await transaction
    .update(matches)
    .set({
      winnerId,
      status: winnerId ? "completed" : "cancelled",
      startedAt: now,
      endedAt: now,
      readyDeadline: null,
    })
    .where(eq(matches.id, match.id));
  for (const player of players) {
    const winner = player.userId === winnerId;
    await transaction
      .update(matchPlayers)
      .set({ isEliminated: !winner, placement: winner ? 1 : null })
      .where(
        and(
          eq(matchPlayers.matchId, match.id),
          eq(matchPlayers.userId, player.userId),
        ),
      );
    await transaction
      .update(brackets)
      .set({ result: winner ? "win" : "loss" })
      .where(
        and(
          eq(brackets.matchId, match.id),
          eq(brackets.playerId, player.userId),
        ),
      );
    if (!winner) {
      await transaction
        .update(tournamentEntries)
        .set({ status: "eliminated", updatedAt: now })
        .where(
          and(
            eq(tournamentEntries.tournamentId, tournament.id),
            eq(tournamentEntries.userId, player.userId),
            eq(tournamentEntries.status, "joined"),
          ),
        );
    }
  }
  await scheduleNextRoundOrComplete(transaction, tournament, match.round, now);
  return { tournamentId: tournament.id, userIds: players.map((item) => item.userId) };
}

export async function processTournamentTick(
  io?: Server,
  now = new Date(),
): Promise<TickResult> {
  const result: TickResult = {
    tournamentIds: new Set(),
    userIds: new Set(),
    matchIds: new Set(),
    reasons: new Map(),
  };

  const dueUpcoming = await db
    .select({ id: tournaments.id })
    .from(tournaments)
    .where(
      and(
        eq(tournaments.status, "upcoming"),
        lte(tournaments.startsAt, now),
      ),
    );
  for (const row of dueUpcoming) {
    const userIds = await db.transaction(async (transaction) => {
      const [tournament] = await transaction
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, row.id))
        .for("update");
      if (
        !tournament ||
        tournament.status !== "upcoming" ||
        !tournament.startsAt ||
        tournament.startsAt > now
      ) {
        return [];
      }
      return openUpcomingTournamentInTransaction(transaction, tournament, now);
    });
    result.tournamentIds.add(row.id);
    result.reasons.set(row.id, "registration_opened");
    userIds.forEach((userId) => result.userIds.add(userId));
  }

  const dueWaiting = await db
    .select({ id: tournaments.id })
    .from(tournaments)
    .where(
      and(
        eq(tournaments.status, "waiting"),
        lte(tournaments.countdownEndsAt, now),
      ),
    );
  for (const row of dueWaiting) {
    const started = await db.transaction(async (transaction) => {
      const [tournament] = await transaction
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, row.id))
        .for("update");
      if (
        !tournament ||
        tournament.status !== "waiting" ||
        !tournament.countdownEndsAt ||
        tournament.countdownEndsAt > now
      ) {
        return null;
      }
      return startTournamentInTransaction(transaction, tournament, now);
    });
    if (!started) continue;
    result.tournamentIds.add(row.id);
    result.reasons.set(
      row.id,
      started.started ? "tournament_started" : "countdown_reset",
    );
    if (
      started.started &&
      "replacementTournamentId" in started &&
      started.replacementTournamentId
    ) {
      result.tournamentIds.add(started.replacementTournamentId);
      result.reasons.set(
        started.replacementTournamentId,
        "recurring_created",
      );
    }
    started.userIds.forEach((userId) => result.userIds.add(userId));
    started.matchIds.forEach((matchId) => result.matchIds.add(matchId));
  }

  const dueRounds = await db
    .select({ id: tournaments.id })
    .from(tournaments)
    .where(
      and(
        eq(tournaments.status, "active"),
        lte(tournaments.nextRoundAt, now),
      ),
    );
  for (const row of dueRounds) {
    const created = await db.transaction(async (transaction) => {
      const [tournament] = await transaction
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, row.id))
        .for("update");
      if (
        !tournament ||
        tournament.status !== "active" ||
        !tournament.nextRoundAt ||
        tournament.nextRoundAt > now
      ) {
        return null;
      }
      const { participants } = await getRoundAdvancers(
        transaction,
        tournament,
        tournament.currentRound,
      );
      if (participants.length === 0) {
        await awardPrizeInTransaction(
          transaction,
          tournament,
          null,
          null,
          now,
        );
        return { matchIds: [], userIds: [] };
      }
      const nextRound = tournament.currentRound + 1;
      const round = await createRoundInTransaction(
        transaction,
        tournament,
        nextRound,
        participants,
        60,
        now,
      );
      await transaction
        .update(tournaments)
        .set({
          currentRound: nextRound,
          nextRoundAt: null,
          updatedAt: now,
        })
        .where(eq(tournaments.id, tournament.id));
      await transaction.insert(notifications).values(
        participants.map((userId) => ({
          userId,
          title: "আপনার match শুরু",
          message: "ম্যাচ চালু — এখনই খেলুন।",
        })),
      );
      return round;
    });
    if (!created) continue;
    result.tournamentIds.add(row.id);
    result.reasons.set(row.id, "round_started");
    created.userIds.forEach((userId) => result.userIds.add(userId));
    created.matchIds.forEach((matchId) => result.matchIds.add(matchId));
  }

  const dueMatches = await db
    .select()
    .from(matches)
    .where(
      and(eq(matches.status, "waiting"), lte(matches.readyDeadline, now)),
    );
  for (const match of dueMatches) {
    const resolved = await db.transaction(async (transaction) => {
      const [locked] = await transaction
        .select()
        .from(matches)
        .where(eq(matches.id, match.id))
        .for("update");
      if (
        !locked ||
        locked.status !== "waiting" ||
        !locked.readyDeadline ||
        locked.readyDeadline > now
      ) {
        return null;
      }
      return resolveNoShowMatch(transaction, locked, now);
    });
    if (!resolved) continue;
    result.matchIds.add(match.id);
    result.tournamentIds.add(resolved.tournamentId);
    result.reasons.set(resolved.tournamentId, "no_show_resolved");
    resolved.userIds.forEach((userId) => result.userIds.add(userId));
  }

  for (const tournamentId of result.tournamentIds) {
    const reason =
      result.reasons.get(tournamentId) ?? "tournament_tick";
    const emitted = await emitTournamentRealtime(io, {
      tournamentId,
      reason,
    });
    if (
      reason === "no_show_resolved" &&
      emitted?.payload.nextRoundAt
    ) {
      await emitTournamentRealtime(io, {
        tournamentId,
        reason: "next_round_countdown",
      });
    }
  }
  for (const matchId of result.matchIds) {
    io?.to(`match:${matchId}`).emit("match:update", {
      matchId,
      at: now.toISOString(),
    });
  }
  for (const userId of result.userIds) {
    io?.to(`user:${userId}`).emit("notification:new", {
      title: "Tournament update",
    });
    emitBalanceUpdate(io, userId, { reason: "tournament_update" });
  }
  return result;
}

export interface TournamentScheduler {
  stop: () => void;
  tick: () => Promise<void>;
}

export function startTournamentScheduler(io: Server): TournamentScheduler {
  let running = false;
  let nextShowcaseCheck = 0;
  let nextRecurringCheck = 0;
  let nextMixedAutoCheck = 0;
  let nextTestRecurringCheck = 0;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await withPostgresAdvisoryLock(1_071_002, async () => {
        if (Date.now() >= nextShowcaseCheck) {
          await ensureShowcaseTournaments(io);
          nextShowcaseCheck = Date.now() + 15_000;
        }
        if (Date.now() >= nextRecurringCheck) {
          await ensureRecurringRealTournaments(io);
          nextRecurringCheck = Date.now() + 15_000;
        }
        if (Date.now() >= nextMixedAutoCheck) {
          await ensureMixedAutoTournaments(io);
          nextMixedAutoCheck = Date.now() + 15_000;
        }
        if (Date.now() >= nextTestRecurringCheck) {
          await ensureTestRecurringTournaments(io);
          nextTestRecurringCheck = Date.now() + 15_000;
        }
        await processTournamentTick(io);
      });
    } catch (error) {
      console.error("Tournament scheduler tick failed", error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), 1_000);
  timer.unref();
  void tick();
  return {
    stop: () => clearInterval(timer),
    tick,
  };
}

export function emitTournamentMutation(
  io: Server | undefined,
  tournamentId: string,
  userIds: string[] = [],
  reason = "mutation",
  context?: {
    userId?: string;
    player?: {
      id: string;
      name: string;
      avatar: string;
      gameId: string;
    };
  },
) {
  void emitTournamentRealtime(io, {
    tournamentId,
    reason,
    ...(context?.userId ? { userId: context.userId } : {}),
    ...(context?.player ? { player: context.player } : {}),
  });
  for (const userId of userIds) {
    io?.to(`user:${userId}`).emit("profile:update-required", {
      reason,
    });
    emitBalanceUpdate(io, userId, { reason });
  }
}

export function publicTournamentUser(user: User) {
  return toPublicUser(user);
}
