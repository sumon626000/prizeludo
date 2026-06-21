export interface User {
  id: string;
  gameId: string;
  name: string;
  phone: string | null;
  email: string | null;
  username: string | null;
  avatar: string;
  mainBalance: string;
  winnerBalance: string;
  referCode: string;
  isAdmin: boolean;
  isSubAdmin: boolean;
  isGuest: boolean;
  adminPermissions: string[];
  isBot: boolean;
  createdAt: string;
}

export interface AuthState {
  authenticated: boolean;
  guest: boolean;
  user?: User;
  adminClaimAvailable: boolean;
}

export interface NotificationItem {
  id: string;
  userId: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationSnapshot {
  items: NotificationItem[];
  unreadCount: number;
  limit: number;
  offset: number;
}

export interface HomeWinner {
  id: string;
  name: string;
  avatar: string;
  amount: string;
  isPromotional: boolean;
  createdAt: string;
}

export interface LeaderboardPlayer {
  id: string;
  name: string;
  avatar: string;
  earnings: string;
  wins: number;
  isPromotional: boolean;
}

export type LeaderboardPeriod = "daily" | "weekly" | "monthly" | "all";

export interface LeaderboardEntry {
  rank: number;
  id: string;
  name: string;
  avatar: string;
  wins: number;
  losses: number;
  games: number;
  winRate: number;
  earnings: string;
  source: "real" | "bot";
  isPromotional: boolean;
  isCurrentPlayer: boolean;
}

export interface LeaderboardSnapshot {
  period: LeaderboardPeriod;
  entries: LeaderboardEntry[];
  currentPlayerRank: number | null;
  counts: {
    real: number;
    promotional: number;
  };
  generatedAt: string;
}

export interface BotPlayer {
  id: string;
  userId: string | null;
  gameId: string | null;
  name: string;
  avatar: string;
  winRate: number;
  useGlobalWinRate: boolean;
  effectiveWinRate: number;
  actionDelayMinMs: number;
  actionDelayMaxMs: number;
  wins: number;
  losses: number;
  totalEarnings: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BotAdminSnapshot {
  settings: {
    enabled: boolean;
    globalWinRate: number;
    actionDelayMinMs: number;
    actionDelayMaxMs: number;
  };
  bots: BotPlayer[];
}

export interface HomeTournament {
  id: string;
  title: string;
  playerCount: number;
  boardType: "2p" | "4p";
  gameMode: "classic" | "quick" | "master";
  type: "free" | "paid";
  joinFee: string;
  prizePool: string;
  status: "upcoming" | "waiting" | "active" | "completed";
  countdownEndsAt: string | null;
  startsAt: string | null;
  joinedCount: number;
  isPreRegistered: boolean;
}

export type TournamentStatus =
  | "upcoming"
  | "waiting"
  | "active"
  | "completed";

export interface TournamentSummary {
  id: string;
  title: string;
  playerCount: number;
  boardType: "2p" | "4p";
  gameMode: "classic" | "quick" | "master";
  type: "free" | "paid";
  joinFee: string;
  prizePool: string;
  adminCommission: string;
  prizeFirst: string;
  prizeSecond: string;
  playerType: "real" | "bot" | "mixed";
  isShowcase: boolean;
  isRecurring?: boolean;
  recurringTemplateKey?: string | null;
  status: TournamentStatus;
  countdownDuration: number;
  countdownEndsAt: string | null;
  startsAt: string | null;
  currentRound: number;
  totalRounds: number;
  betweenRoundSeconds: number;
  nextRoundAt: string | null;
  completedAt: string | null;
  collectedFees: string;
  adminRevenue: string;
  joinedCount?: number;
  currentEntryStatus?:
    | "pre_registered"
    | "joined"
    | "left"
    | "eliminated"
    | null;
  isCurrent?: boolean;
}

export interface TournamentParticipant {
  participant: {
    matchId: string;
    userId: string;
    seat: number;
    reconnectCount: number;
    missCount: number;
    hasLeft: boolean;
    isEliminated: boolean;
    connectedAt: string | null;
    disconnectedAt: string | null;
    reconnectDeadline: string | null;
    lastSeenAt: string | null;
    placement: number | null;
  };
  user: {
    id: string;
    gameId: string;
    name: string;
    avatar: string;
    isBot: boolean;
  };
}

export interface TournamentMatch {
  id: string;
  tournamentId: string;
  round: number;
  matchNumber?: number;
  winnerId: string | null;
  runnerUpId: string | null;
  status: "waiting" | "active" | "completed" | "cancelled";
  readyDeadline: string | null;
  startedAt: string | null;
  endedAt: string | null;
  players: TournamentParticipant[];
}

export interface TournamentDetails {
  tournament: TournamentSummary;
  joinedCount: number;
  entries: Array<{
    entry: {
      id: string;
      status: "pre_registered" | "joined" | "left" | "eliminated";
      finishPosition: number | null;
      prizeEarned: string;
      paidAmount: string;
    };
    user: {
      id: string;
      gameId: string;
      name: string;
      avatar: string;
      isBot: boolean;
    };
    participantStatus?: string;
  }>;
  matches: Array<
    TournamentMatch & {
      roundName?: string;
      matchNumber?: number;
    }
  >;
  bracket: Array<{
    bracket: {
      id: string;
      round: number;
      matchId: string | null;
      position: number;
      playerId: string | null;
      result: "waiting" | "win" | "loss";
    };
    player: {
      id: string | null;
      name: string | null;
      avatar: string | null;
      gameId: string | null;
      isBot: boolean | null;
    } | null;
  }>;
  currentEntry: {
    id: string;
    status: "pre_registered" | "joined" | "left" | "eliminated";
    participantStatus?: string;
  } | null;
  currentMatch?: {
    matchId: string;
    round: number;
    roundName: string;
    matchNumber: number;
    status: TournamentMatch["status"];
    opponentPlayers: Array<{
      id: string;
      name: string;
      gameId: string;
      avatar: string;
      isBot: boolean;
    }>;
  } | null;
  serverTime: string;
}

export interface MatchSnapshot {
  match: Omit<TournamentMatch, "players">;
  players: TournamentParticipant[];
  state: {
    id: string;
    boardState: Record<string, unknown>;
    stateVersion: number;
  } | null;
  serverTime: string;
}

export interface GameBoardState {
  schemaVersion: 1;
  phase: "ready" | "active" | "completed";
  boardType: "2p" | "4p";
  gameMode: "classic" | "quick" | "master";
  playerOrder: string[];
  turnStartedAt: string;
  turnDeadline: string;
  turnSeconds: number;
  roll: { dice: number; legalTokenIndexes: number[] } | null;
  consecutiveSixes: number;
  finishOrder: string[];
  eliminatedOrder: string[];
  eliminationReasons: Record<string, "misses" | "leave" | "reconnect">;
  captures: Record<string, number>;
  lastAction: {
    type: string;
    userId?: string;
    dice?: number;
    tokenIndex?: number;
    from?: number;
    to?: number;
    killedUserIds?: string[];
    killedTokens?: Array<{
      userId: string;
      tokenIndex: number;
      from: number;
    }>;
    reason?: string;
    at: string;
  };
  placements: string[];
}

export interface GameRoom {
  match: Omit<TournamentMatch, "players">;
  tournament: TournamentSummary;
  players: TournamentParticipant[];
  state: {
    id: string;
    currentTurn: string | null;
    diceValue: number | null;
    tokenPositions: Record<string, number[]>;
    stateVersion: number;
    boardState: GameBoardState;
    updatedAt: string;
  };
  messages: Array<{
    id: string;
    kind: "chat" | "emoji" | "system";
    content: string;
    createdAt: string;
    user: {
      id: string | null;
      name: string | null;
      avatar: string | null;
    } | null;
  }>;
  role: "player" | "spectator";
  rules: {
    finishPosition: number;
    homeLaneStart: number;
    releaseRolls: number[];
    turnSeconds: number;
    safeGlobalCells: number[];
    requiresCaptureForHome: boolean;
    label: string;
  };
  settings: {
    diceSpeed: "fast" | "normal" | "slow";
    tokenSpeed: "fast" | "normal" | "slow";
    voiceEnabled: boolean;
    voiceProvider: string;
  };
  voice: {
    enabled: boolean;
    provider: string;
    url: string | null;
  };
  serverTime: string;
}

export interface RealtimeEnvelope<T> {
  eventId: string;
  type: string;
  at: string;
  payload: T;
}

export interface RealtimeState {
  serverTime: string;
  recovered?: boolean;
  maintenance: {
    enabled: boolean;
    message: string;
  };
  theme: {
    siteName: string;
    logoUrl: string;
    themePreset: string;
    primaryColor: string;
    secondaryColor: string;
    buttonColor: string;
    cardColor: string;
    backgroundColor: string;
    accentColor: string;
  };
  user: {
    id: string;
    mainBalance: string;
    winnerBalance: string;
    unreadNotifications: number;
    activeTournamentId: string | null;
    activeMatchIds: string[];
  } | null;
}

export interface HomeSnapshot {
  settings: {
    siteName: string;
    logoUrl: string;
    maxWinAmount: number;
    marqueeSpeedSeconds: number;
    social: {
      telegram: string;
      whatsapp: string;
      facebook: string;
    };
  };
  winners: HomeWinner[];
  leaderboard: LeaderboardPlayer[];
  tournaments: HomeTournament[];
  upcomingTournaments: HomeTournament[];
  unreadNotifications: number;
  serverTime: string;
}

export interface ProfileOverview {
  user: User;
  hasPassword: boolean;
  avatarOptions: string[];
  social: {
    telegram: string;
    whatsapp: string;
    facebook: string;
  };
}

export interface PlayerStats {
  totalGames: number;
  totalWins: number;
  totalLosses: number;
  winRate: number;
  totalEarnings: string;
  currentRank: number;
  highestWinStreak: number;
  bestTournamentFinish: number | null;
}

export type HistoryType =
  | "tournament"
  | "deposit"
  | "withdraw"
  | "refer"
  | "transfer";

export interface TournamentHistoryItem {
  id: string;
  title: string;
  gameMode: "classic" | "quick" | "master";
  joinFee: string;
  finishPosition: number;
  prizeEarned: string;
  result: "win" | "loss";
  date: string;
}

export interface TransactionHistoryItem {
  id: string;
  amount: string;
  status:
    | "pending"
    | "success"
    | "failed"
    | "approved"
    | "rejected"
    | "paid";
  method: string | null;
  bonusAmount: string;
  reference: string | null;
  createdAt: string;
}

export interface ReferralHistoryItem {
  id: string;
  name: string;
  gameId: string;
  joinedAt: string;
  depositAmount: string;
  commissionEarned: string;
}

export interface ReferralSnapshot {
  totalReferCount: number;
  totalReferIncome: string;
  items: ReferralHistoryItem[];
}

export interface TransferHistoryItem {
  id: string;
  amount: string;
  status: TransactionHistoryItem["status"];
  direction: "none" | "incoming" | "outgoing";
  commissionAmount: string;
  createdAt: string;
  otherParty: {
    id: string;
    name: string;
    gameId: string;
  } | null;
}

export type WalletTransactionType =
  | "deposit"
  | "withdraw"
  | "transfer"
  | "prize"
  | "refer"
  | "bonus"
  | "tournament_fee"
  | "tournament_refund";

export interface DepositOffer {
  id: string;
  amount: string;
  bonusPercent: string;
  bonusAmount: string;
  totalAmount: string;
  isActive: boolean;
  sortOrder: number;
}

export interface WalletTransaction {
  id: string;
  type: WalletTransactionType;
  amount: string;
  status: "pending" | "success" | "failed" | "approved" | "rejected" | "paid";
  method: string | null;
  direction: "none" | "incoming" | "outgoing";
  bonusAmount: string;
  commissionAmount: string;
  balanceSource: "none" | "main" | "winner";
  createdAt: string;
  otherParty?: {
    id: string;
    name: string;
    gameId: string;
  } | null;
  metadata?: {
    accountLastFour?: string | null;
  };
  failureReason?: string | null;
}

export interface WalletOverview {
  user: User;
  offers: DepositOffer[];
  limits: {
    depositMin: number;
    depositMax: number;
    withdrawMin: number;
    transferMin: number;
    transferCommissionPercent: number;
  };
  methods: {
    uddoktaPay: boolean;
    ziniPay: boolean;
    manual: boolean;
    manualMethods: Array<{
      name: string;
      account: string;
      instructions?: string;
    }>;
    withdrawMethods: string[];
  };
  recentTransactions: WalletTransaction[];
}
