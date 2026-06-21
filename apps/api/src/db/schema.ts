import { sql } from "drizzle-orm";
import {
  AnyPgColumn,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const createdAt = timestamp("created_at", {
  withTimezone: true,
  mode: "date",
})
  .defaultNow()
  .notNull();

const updatedAt = timestamp("updated_at", {
  withTimezone: true,
  mode: "date",
})
  .defaultNow()
  .notNull();

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const tournamentBoardTypeEnum = pgEnum("tournament_board_type", [
  "2p",
  "4p",
]);
export const gameModeEnum = pgEnum("game_mode", [
  "classic",
  "quick",
  "master",
]);
export const tournamentTypeEnum = pgEnum("tournament_type", [
  "free",
  "paid",
]);
export const tournamentPlayerTypeEnum = pgEnum("tournament_player_type", [
  "real",
  "bot",
  "mixed",
]);
export const tournamentStatusEnum = pgEnum("tournament_status", [
  "upcoming",
  "waiting",
  "active",
  "completed",
]);
export const matchStatusEnum = pgEnum("match_status", [
  "waiting",
  "active",
  "completed",
  "cancelled",
]);
export const bracketResultEnum = pgEnum("bracket_result", [
  "win",
  "loss",
  "waiting",
]);
export const transactionTypeEnum = pgEnum("transaction_type", [
  "deposit",
  "withdraw",
  "transfer",
  "prize",
  "refer",
  "bonus",
  "tournament_fee",
  "tournament_refund",
]);
export const transactionStatusEnum = pgEnum("transaction_status", [
  "pending",
  "success",
  "failed",
  "approved",
  "rejected",
  "paid",
]);
export const transactionDirectionEnum = pgEnum("transaction_direction", [
  "none",
  "incoming",
  "outgoing",
]);
export const balanceSourceEnum = pgEnum("balance_source", [
  "none",
  "main",
  "winner",
]);
export const walletDocumentKindEnum = pgEnum("wallet_document_kind", [
  "manual_deposit_proof",
]);
export const supportStatusEnum = pgEnum("support_status", [
  "open",
  "in_progress",
  "resolved",
]);
export const tournamentEntryStatusEnum = pgEnum("tournament_entry_status", [
  "pre_registered",
  "joined",
  "left",
  "eliminated",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gameId: varchar("game_id", { length: 5 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    phone: varchar("phone", { length: 20 }),
    email: varchar("email", { length: 254 }),
    username: varchar("username", { length: 40 }),
    passwordHash: text("password_hash"),
    googleId: varchar("google_id", { length: 128 }),
    avatar: text("avatar").notNull().default("/avatar-leaf.svg"),
    mainBalance: numeric("main_balance", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),
    winnerBalance: numeric("winner_balance", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),
    referCode: varchar("refer_code", { length: 12 }).notNull(),
    referredBy: uuid("referred_by").references(
      (): AnyPgColumn => users.id,
      { onDelete: "set null" },
    ),
    isAdmin: boolean("is_admin").notNull().default(false),
    isSubAdmin: boolean("is_sub_admin").notNull().default(false),
    isGuest: boolean("is_guest").notNull().default(false),
    adminPermissions: jsonb("admin_permissions")
      .$type<string[]>()
      .notNull()
      .default([]),
    isBot: boolean("is_bot").notNull().default(false),
    isBanned: boolean("is_banned").notNull().default(false),
    ipAddress: varchar("ip_address", { length: 64 }),
    deviceId: varchar("device_id", { length: 128 }),
    lastLoginAt: timestamp("last_login_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("users_game_id_unique").on(table.gameId),
    uniqueIndex("users_phone_unique").on(table.phone),
    uniqueIndex("users_email_unique").on(table.email),
    uniqueIndex("users_username_unique").on(table.username),
    uniqueIndex("users_google_id_unique").on(table.googleId),
    uniqueIndex("users_refer_code_unique").on(table.referCode),
    index("users_created_at_idx").on(table.createdAt),
    check("users_game_id_format_check", sql`${table.gameId} ~ '^[0-9]{5}$'`),
    check("users_main_balance_nonnegative", sql`${table.mainBalance} >= 0`),
    check("users_winner_balance_nonnegative", sql`${table.winnerBalance} >= 0`),
  ],
);

export const tournaments = pgTable(
  "tournaments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: varchar("title", { length: 160 }).notNull(),
    playerCount: integer("player_count").notNull(),
    boardType: tournamentBoardTypeEnum("board_type").notNull(),
    gameMode: gameModeEnum("game_mode").notNull(),
    type: tournamentTypeEnum("type").notNull().default("paid"),
    joinFee: numeric("join_fee", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    prizePool: numeric("prize_pool", { precision: 12, scale: 2 })
      .notNull()
      .default("0"),
    adminCommission: numeric("admin_commission", {
      precision: 5,
      scale: 2,
    })
      .notNull()
      .default("10"),
    prizeFirst: numeric("prize_first", { precision: 5, scale: 2 })
      .notNull()
      .default("70"),
    prizeSecond: numeric("prize_second", { precision: 5, scale: 2 })
      .notNull()
      .default("30"),
    playerType: tournamentPlayerTypeEnum("player_type")
      .notNull()
      .default("real"),
    isShowcase: boolean("is_showcase").notNull().default(false),
    isRecurring: boolean("is_recurring").notNull().default(false),
    recurringTemplateKey: varchar("recurring_template_key", { length: 80 }),
    status: tournamentStatusEnum("status").notNull().default("upcoming"),
    countdownDuration: integer("countdown_duration").notNull().default(60),
    countdownEndsAt: timestamp("countdown_ends_at", {
      withTimezone: true,
      mode: "date",
    }),
    startsAt: timestamp("starts_at", {
      withTimezone: true,
      mode: "date",
    }),
    currentRound: integer("current_round").notNull().default(0),
    totalRounds: integer("total_rounds").notNull().default(0),
    betweenRoundSeconds: integer("between_round_seconds")
      .notNull()
      .default(60),
    nextRoundAt: timestamp("next_round_at", {
      withTimezone: true,
      mode: "date",
    }),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
    collectedFees: numeric("collected_fees", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),
    adminRevenue: numeric("admin_revenue", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("tournaments_status_idx").on(table.status),
    index("tournaments_created_at_idx").on(table.createdAt),
    index("tournaments_recurring_template_idx").on(table.recurringTemplateKey),
    uniqueIndex("tournaments_recurring_waiting_unique")
      .on(table.recurringTemplateKey)
      .where(
        sql`${table.isRecurring} = true and ${table.status} in ('upcoming', 'waiting')`,
      ),
    check(
      "tournaments_player_count_check",
      sql`${table.playerCount} in (2, 4, 8, 16, 32, 64)`,
    ),
    check("tournaments_join_fee_nonnegative", sql`${table.joinFee} >= 0`),
    check("tournaments_prize_pool_nonnegative", sql`${table.prizePool} >= 0`),
    check(
      "tournaments_commission_range",
      sql`${table.adminCommission} between 0 and 100`,
    ),
    check(
      "tournaments_prize_first_range",
      sql`${table.prizeFirst} between 0 and 100`,
    ),
    check(
      "tournaments_prize_second_range",
      sql`${table.prizeSecond} between 0 and 100`,
    ),
    check(
      "tournaments_prize_split_check",
      sql`${table.prizeFirst} + ${table.prizeSecond} = 100`,
    ),
    check(
      "tournaments_countdown_duration_check",
      sql`${table.countdownDuration} between 10 and 86400`,
    ),
    check(
      "tournaments_between_round_check",
      sql`${table.betweenRoundSeconds} between 30 and 60`,
    ),
    check(
      "tournaments_rounds_nonnegative",
      sql`${table.currentRound} >= 0 and ${table.totalRounds} >= 0`,
    ),
    check(
      "tournaments_accounting_nonnegative",
      sql`${table.collectedFees} >= 0 and ${table.adminRevenue} >= 0`,
    ),
  ],
);

export const tournamentEntries = pgTable(
  "tournament_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: tournamentEntryStatusEnum("status")
      .notNull()
      .default("pre_registered"),
    finishPosition: integer("finish_position"),
    prizeEarned: numeric("prize_earned", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),
    paidAmount: numeric("paid_amount", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),
    paidMainAmount: numeric("paid_main_amount", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),
    paidWinnerAmount: numeric("paid_winner_amount", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),
    balanceSource: balanceSourceEnum("balance_source")
      .notNull()
      .default("none"),
    joinedAt: timestamp("joined_at", {
      withTimezone: true,
      mode: "date",
    }),
    leftAt: timestamp("left_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("tournament_entries_user_unique").on(
      table.tournamentId,
      table.userId,
    ),
    index("tournament_entries_tournament_status_idx").on(
      table.tournamentId,
      table.status,
    ),
    index("tournament_entries_user_status_idx").on(table.userId, table.status),
    check(
      "tournament_entries_finish_position_check",
      sql`${table.finishPosition} is null or ${table.finishPosition} > 0`,
    ),
    check(
      "tournament_entries_prize_nonnegative",
      sql`${table.prizeEarned} >= 0`,
    ),
    check(
      "tournament_entries_paid_nonnegative",
      sql`${table.paidAmount} >= 0`,
    ),
    check(
      "tournament_entries_paid_main_nonnegative",
      sql`${table.paidMainAmount} >= 0`,
    ),
    check(
      "tournament_entries_paid_winner_nonnegative",
      sql`${table.paidWinnerAmount} >= 0`,
    ),
  ],
);

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    round: integer("round").notNull(),
    player1Id: uuid("player_1_id").references(() => users.id, {
      onDelete: "set null",
    }),
    player2Id: uuid("player_2_id").references(() => users.id, {
      onDelete: "set null",
    }),
    player3Id: uuid("player_3_id").references(() => users.id, {
      onDelete: "set null",
    }),
    player4Id: uuid("player_4_id").references(() => users.id, {
      onDelete: "set null",
    }),
    winnerId: uuid("winner_id").references(() => users.id, {
      onDelete: "set null",
    }),
    runnerUpId: uuid("runner_up_id").references(() => users.id, {
      onDelete: "set null",
    }),
    status: matchStatusEnum("status").notNull().default("waiting"),
    readyDeadline: timestamp("ready_deadline", {
      withTimezone: true,
      mode: "date",
    }),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      mode: "date",
    }),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
    createdAt,
  },
  (table) => [
    index("matches_tournament_round_idx").on(
      table.tournamentId,
      table.round,
    ),
    check("matches_round_positive", sql`${table.round} > 0`),
    check(
      "matches_distinct_placements",
      sql`${table.winnerId} is null or ${table.runnerUpId} is null or ${table.winnerId} <> ${table.runnerUpId}`,
    ),
  ],
);

export const matchPlayers = pgTable(
  "match_players",
  {
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seat: integer("seat").notNull(),
    reconnectCount: integer("reconnect_count").notNull().default(0),
    missCount: integer("miss_count").notNull().default(0),
    hasLeft: boolean("has_left").notNull().default(false),
    isEliminated: boolean("is_eliminated").notNull().default(false),
    connectedAt: timestamp("connected_at", {
      withTimezone: true,
      mode: "date",
    }),
    disconnectedAt: timestamp("disconnected_at", {
      withTimezone: true,
      mode: "date",
    }),
    reconnectDeadline: timestamp("reconnect_deadline", {
      withTimezone: true,
      mode: "date",
    }),
    lastSeenAt: timestamp("last_seen_at", {
      withTimezone: true,
      mode: "date",
    }),
    placement: integer("placement"),
  },
  (table) => [
    primaryKey({ columns: [table.matchId, table.userId] }),
    uniqueIndex("match_players_seat_unique").on(table.matchId, table.seat),
    check("match_players_seat_check", sql`${table.seat} between 1 and 4`),
    check(
      "match_players_reconnect_nonnegative",
      sql`${table.reconnectCount} >= 0`,
    ),
    check("match_players_miss_nonnegative", sql`${table.missCount} >= 0`),
    check(
      "match_players_placement_check",
      sql`${table.placement} is null or ${table.placement} between 1 and 4`,
    ),
  ],
);

export const gameStates = pgTable(
  "game_states",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    boardState: jsonb("board_state").notNull().default({}),
    currentTurn: uuid("current_turn").references(() => users.id, {
      onDelete: "set null",
    }),
    diceValue: integer("dice_value"),
    tokenPositions: jsonb("token_positions").notNull().default({}),
    stateVersion: integer("state_version").notNull().default(0),
    updatedAt,
  },
  (table) => [
    uniqueIndex("game_states_match_unique").on(table.matchId),
    check(
      "game_states_dice_check",
      sql`${table.diceValue} is null or ${table.diceValue} between 1 and 6`,
    ),
    check("game_states_version_nonnegative", sql`${table.stateVersion} >= 0`),
  ],
);

export const gameMessages = pgTable(
  "game_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    kind: varchar("kind", { length: 20 }).notNull(),
    content: varchar("content", { length: 500 }).notNull(),
    createdAt,
  },
  (table) => [
    index("game_messages_match_created_idx").on(
      table.matchId,
      table.createdAt,
    ),
    index("game_messages_created_idx").on(table.createdAt),
    check(
      "game_messages_kind_check",
      sql`${table.kind} in ('chat', 'emoji', 'system')`,
    ),
  ],
);

export const brackets = pgTable(
  "brackets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    round: integer("round").notNull(),
    matchId: uuid("match_id").references(() => matches.id, {
      onDelete: "cascade",
    }),
    position: integer("position").notNull(),
    playerId: uuid("player_id").references(() => users.id, {
      onDelete: "set null",
    }),
    result: bracketResultEnum("result").notNull().default("waiting"),
  },
  (table) => [
    uniqueIndex("brackets_position_unique").on(
      table.tournamentId,
      table.round,
      table.position,
    ),
    uniqueIndex("brackets_player_round_unique")
      .on(table.tournamentId, table.round, table.playerId)
      .where(sql`${table.playerId} is not null`),
    check("brackets_round_positive", sql`${table.round} > 0`),
    check("brackets_position_positive", sql`${table.position} > 0`),
  ],
);

export const depositOffers = pgTable(
  "deposit_offers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    bonusPercent: numeric("bonus_percent", {
      precision: 5,
      scale: 2,
    }).notNull(),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("deposit_offers_amount_unique").on(table.amount),
    index("deposit_offers_active_sort_idx").on(
      table.isActive,
      table.sortOrder,
    ),
    check("deposit_offers_amount_positive", sql`${table.amount} > 0`),
    check(
      "deposit_offers_bonus_range",
      sql`${table.bonusPercent} between 0 and 100`,
    ),
    check("deposit_offers_sort_nonnegative", sql`${table.sortOrder} >= 0`),
  ],
);

export const walletDocuments = pgTable(
  "wallet_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: walletDocumentKindEnum("kind").notNull(),
    mimeType: varchar("mime_type", { length: 40 }).notNull(),
    byteSize: integer("byte_size").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    content: bytea("content").notNull(),
    createdAt,
  },
  (table) => [
    index("wallet_documents_user_kind_idx").on(table.userId, table.kind),
    check(
      "wallet_documents_size_check",
      sql`${table.byteSize} between 1 and 5242880`,
    ),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    type: transactionTypeEnum("type").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    status: transactionStatusEnum("status").notNull().default("pending"),
    reference: varchar("reference", { length: 160 }),
    method: varchar("method", { length: 80 }),
    direction: transactionDirectionEnum("direction")
      .notNull()
      .default("none"),
    relatedUserId: uuid("related_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    relatedTournamentId: uuid("related_tournament_id").references(
      () => tournaments.id,
      { onDelete: "set null" },
    ),
    relatedDocumentId: uuid("related_document_id").references(
      () => walletDocuments.id,
      { onDelete: "set null" },
    ),
    groupId: uuid("group_id"),
    provider: varchar("provider", { length: 40 }),
    providerInvoiceId: varchar("provider_invoice_id", { length: 160 }),
    balanceSource: balanceSourceEnum("balance_source")
      .notNull()
      .default("none"),
    bonusAmount: numeric("bonus_amount", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),
    commissionAmount: numeric("commission_amount", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),
    balanceAppliedAt: timestamp("balance_applied_at", {
      withTimezone: true,
      mode: "date",
    }),
    refundedAt: timestamp("refunded_at", {
      withTimezone: true,
      mode: "date",
    }),
    reviewedBy: uuid("reviewed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", {
      withTimezone: true,
      mode: "date",
    }),
    failureReason: text("failure_reason"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt,
  },
  (table) => [
    index("transactions_user_created_idx").on(table.userId, table.createdAt),
    index("transactions_status_idx").on(table.status),
    index("transactions_related_user_idx").on(table.relatedUserId),
    index("transactions_related_tournament_idx").on(
      table.relatedTournamentId,
    ),
    index("transactions_related_document_idx").on(table.relatedDocumentId),
    index("transactions_group_idx").on(table.groupId),
    uniqueIndex("transactions_provider_invoice_unique").on(
      table.provider,
      table.providerInvoiceId,
    ),
    uniqueIndex("transactions_reference_unique")
      .on(table.reference)
      .where(sql`${table.reference} is not null`),
    check("transactions_amount_positive", sql`${table.amount} > 0`),
    check(
      "transactions_bonus_nonnegative",
      sql`${table.bonusAmount} >= 0`,
    ),
    check(
      "transactions_commission_nonnegative",
      sql`${table.commissionAmount} >= 0`,
    ),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    title: varchar("title", { length: 160 }).notNull(),
    message: text("message").notNull(),
    isRead: boolean("is_read").notNull().default(false),
    createdAt,
  },
  (table) => [
    index("notifications_user_read_idx").on(table.userId, table.isRead),
    index("notifications_read_created_idx").on(table.isRead, table.createdAt),
  ],
);

export const supportTickets = pgTable(
  "support_tickets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subject: varchar("subject", { length: 180 }).notNull(),
    message: text("message").notNull(),
    status: supportStatusEnum("status").notNull().default("open"),
    adminReply: text("admin_reply"),
    assignedTo: uuid("assigned_to").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt,
    updatedAt,
  },
  (table) => [index("support_tickets_status_idx").on(table.status)],
);

export const botPlayers = pgTable(
  "bot_players",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    avatar: text("avatar").notNull(),
    winRate: integer("win_rate").notNull().default(70),
    useGlobalWinRate: boolean("use_global_win_rate").notNull().default(true),
    actionDelayMinMs: integer("action_delay_min_ms").notNull().default(900),
    actionDelayMaxMs: integer("action_delay_max_ms").notNull().default(2200),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),
    totalEarnings: numeric("total_earnings", {
      precision: 14,
      scale: 2,
    })
      .notNull()
      .default("0"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("bot_players_user_unique").on(table.userId),
    check("bot_players_win_rate_check", sql`${table.winRate} between 1 and 100`),
    check(
      "bot_players_action_delay_check",
      sql`${table.actionDelayMinMs} between 500 and 5000 and ${table.actionDelayMaxMs} between ${table.actionDelayMinMs} and 10000`,
    ),
    check("bot_players_wins_nonnegative", sql`${table.wins} >= 0`),
    check("bot_players_losses_nonnegative", sql`${table.losses} >= 0`),
    check(
      "bot_players_earnings_nonnegative",
      sql`${table.totalEarnings} >= 0`,
    ),
  ],
);

export const promotionalWins = pgTable(
  "promotional_wins",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    botPlayerId: uuid("bot_player_id")
      .notNull()
      .references(() => botPlayers.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    isDisclosed: boolean("is_disclosed").notNull().default(true),
    createdAt,
  },
  (table) => [
    index("promotional_wins_created_idx").on(table.createdAt),
    check("promotional_wins_amount_positive", sql`${table.amount} > 0`),
    check("promotional_wins_disclosed_check", sql`${table.isDisclosed} = true`),
  ],
);

export const settings = pgTable("settings", {
  key: varchar("key", { length: 120 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt,
});

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    ipAddress: varchar("ip_address", { length: 64 }).notNull(),
    deviceId: varchar("device_id", { length: 128 }).notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    revokedAt: timestamp("revoked_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt,
  },
  (table) => [
    uniqueIndex("auth_sessions_token_hash_unique").on(table.tokenHash),
    index("auth_sessions_user_idx").on(table.userId),
    index("auth_sessions_expires_idx").on(table.expiresAt),
  ],
);

export const bannedIps = pgTable("banned_ips", {
  id: uuid("id").defaultRandom().primaryKey(),
  ipAddress: varchar("ip_address", { length: 64 }).notNull().unique(),
  reason: text("reason").notNull(),
  bannedBy: uuid("banned_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt,
});

export const bannedDevices = pgTable("banned_devices", {
  id: uuid("id").defaultRandom().primaryKey(),
  deviceId: varchar("device_id", { length: 128 }).notNull().unique(),
  reason: text("reason").notNull(),
  bannedBy: uuid("banned_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt,
});

export const adminAuditLogs = pgTable(
  "admin_audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    action: varchar("action", { length: 120 }).notNull(),
    targetType: varchar("target_type", { length: 80 }),
    targetId: varchar("target_id", { length: 128 }),
    details: jsonb("details").notNull().default({}),
    ipAddress: varchar("ip_address", { length: 64 }).notNull(),
    createdAt,
  },
  (table) => [
    index("admin_audit_actor_created_idx").on(
      table.actorId,
      table.createdAt,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
