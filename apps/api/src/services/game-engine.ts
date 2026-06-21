export type GameMode = "classic" | "quick" | "master";
export type BoardType = "2p" | "4p";
export type EliminationReason = "misses" | "leave" | "reconnect";

export interface GameModeRules {
  finishPosition: number;
  homeLaneStart: number;
  releaseRolls: number[];
  turnSeconds: number;
  safeGlobalCells: number[];
  requiresCaptureForHome: boolean;
  label: string;
}

export interface GameAction {
  type:
    | "ready"
    | "roll"
    | "move"
    | "kill"
    | "home"
    | "turn"
    | "miss"
    | "eliminated"
    | "game_over";
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
  reason?: EliminationReason;
  at: string;
}

export interface GameBoardState {
  schemaVersion: 1;
  phase: "ready" | "active" | "completed";
  boardType: BoardType;
  gameMode: GameMode;
  playerOrder: string[];
  turnStartedAt: string;
  turnDeadline: string;
  turnSeconds: number;
  roll: {
    dice: number;
    legalTokenIndexes: number[];
  } | null;
  consecutiveSixes: number;
  finishOrder: string[];
  eliminatedOrder: string[];
  eliminationReasons: Record<string, EliminationReason>;
  captures: Record<string, number>;
  lastAction: GameAction;
  placements: string[];
}

export type TokenPositions = Record<string, number[]>;

const CLASSIC_SAFE_CELLS = [0, 8, 13, 21, 26, 34, 39, 47];
const MASTER_SAFE_CELLS = [0, 13, 26, 39];
const START_OFFSETS = [0, 13, 26, 39];

export function getGameModeRules(mode: GameMode): GameModeRules {
  if (mode === "quick") {
    return {
      finishPosition: 29,
      homeLaneStart: 24,
      releaseRolls: [1, 2, 3, 4, 5, 6],
      turnSeconds: 10,
      safeGlobalCells: CLASSIC_SAFE_CELLS,
      requiresCaptureForHome: false,
      label: "Tokens start outside, a 29-step race, and 10-second turns.",
    };
  }
  if (mode === "master") {
    return {
      finishPosition: 57,
      homeLaneStart: 52,
      releaseRolls: [5, 6],
      turnSeconds: 10,
      safeGlobalCells: MASTER_SAFE_CELLS,
      requiresCaptureForHome: true,
      label:
        "Release on five or six, limited safe cells, capture before home, and 10-second turns.",
    };
  }
  return {
    finishPosition: 57,
    homeLaneStart: 52,
    releaseRolls: [6],
    turnSeconds: 10,
    safeGlobalCells: CLASSIC_SAFE_CELLS,
    requiresCaptureForHome: false,
    label: "Full standard circuit, release on six, safe stars, exact home, and 10-second turns.",
  };
}

function addSeconds(now: Date, seconds: number): string {
  return new Date(now.getTime() + seconds * 1_000).toISOString();
}

function activePlayers(state: GameBoardState): string[] {
  return state.playerOrder.filter(
    (userId) =>
      !state.finishOrder.includes(userId) &&
      !state.eliminatedOrder.includes(userId),
  );
}

function nextPlayer(state: GameBoardState, currentUserId: string): string | null {
  const active = activePlayers(state);
  if (active.length === 0) return null;
  const currentIndex = state.playerOrder.indexOf(currentUserId);
  for (let offset = 1; offset <= state.playerOrder.length; offset += 1) {
    const candidate =
      state.playerOrder[(currentIndex + offset) % state.playerOrder.length];
    if (candidate && active.includes(candidate)) return candidate;
  }
  return active[0] ?? null;
}

function resetTurn(
  state: GameBoardState,
  userId: string,
  now: Date,
  action: GameAction,
): GameBoardState {
  return {
    ...state,
    turnStartedAt: now.toISOString(),
    turnDeadline: addSeconds(now, state.turnSeconds),
    roll: null,
    consecutiveSixes: 0,
    lastAction: action,
  };
}

function globalTrackPosition(
  state: GameBoardState,
  userId: string,
  position: number,
): number | null {
  const rules = getGameModeRules(state.gameMode);
  if (position < 0 || position >= rules.homeLaneStart) return null;
  const seat = state.playerOrder.indexOf(userId);
  if (seat < 0) return null;
  const offset =
    state.boardType === "2p"
      ? seat === 0
        ? START_OFFSETS[0]!
        : START_OFFSETS[2]!
      : START_OFFSETS[seat]!;
  return (offset + position) % 52;
}

function hasOpponentBlockade(
  state: GameBoardState,
  positions: TokenPositions,
  movingUserId: string,
  destination: number,
): boolean {
  const target = globalTrackPosition(state, movingUserId, destination);
  if (target === null) return false;
  return state.playerOrder.some((opponentId) => {
    if (opponentId === movingUserId) return false;
    return (
      (positions[opponentId] ?? []).filter(
        (position) =>
          globalTrackPosition(state, opponentId, position) === target,
      ).length >= 2
    );
  });
}

export function createInitialGame(
  playerIds: string[],
  boardType: BoardType,
  gameMode: GameMode,
  now = new Date(),
): { state: GameBoardState; tokenPositions: TokenPositions } {
  const rules = getGameModeRules(gameMode);
  const order = [...playerIds];
  const tokenPositions = Object.fromEntries(
    order.map((userId) => [
      userId,
      gameMode === "quick" ? [0, 0, 0, 0] : [-1, -1, -1, -1],
    ]),
  );
  const first = order[0] ?? "";
  return {
    state: {
      schemaVersion: 1,
      phase: order.length > 1 ? "active" : "completed",
      boardType,
      gameMode,
      playerOrder: order,
      turnStartedAt: now.toISOString(),
      turnDeadline: addSeconds(now, rules.turnSeconds),
      turnSeconds: rules.turnSeconds,
      roll: null,
      consecutiveSixes: 0,
      finishOrder: [],
      eliminatedOrder: [],
      eliminationReasons: {},
      captures: Object.fromEntries(order.map((userId) => [userId, 0])),
      lastAction: {
        type: "ready",
        ...(first ? { userId: first } : {}),
        at: now.toISOString(),
      },
      placements: order.length === 1 ? order : [],
    },
    tokenPositions,
  };
}

export function getLegalTokenIndexes(
  state: GameBoardState,
  positions: TokenPositions,
  userId: string,
  dice: number,
): number[] {
  const rules = getGameModeRules(state.gameMode);
  const tokens = positions[userId] ?? [];
  const captureGateActive =
    rules.requiresCaptureForHome &&
    (state.captures[userId] ?? 0) === 0 &&
    tokens.some(
      (position) =>
        position < 0 || position < Math.max(0, rules.homeLaneStart - 6),
    );
  return tokens.flatMap((position, tokenIndex) => {
    if (position === rules.finishPosition) return [];
    if (position < 0) {
      return rules.releaseRolls.includes(dice) ? [tokenIndex] : [];
    }
    const destination = position + dice;
    if (destination > rules.finishPosition) return [];
    if (
      rules.requiresCaptureForHome &&
      position < rules.homeLaneStart &&
      destination >= rules.homeLaneStart &&
      captureGateActive
    ) {
      return [];
    }
    if (hasOpponentBlockade(state, positions, userId, destination)) return [];
    return [tokenIndex];
  });
}

export function applyDiceRoll(
  state: GameBoardState,
  positions: TokenPositions,
  currentTurn: string,
  userId: string,
  dice: number,
  now = new Date(),
): {
  state: GameBoardState;
  currentTurn: string | null;
  autoPassed: boolean;
} {
  if (state.phase !== "active") throw new Error("GAME_NOT_ACTIVE");
  if (currentTurn !== userId) throw new Error("NOT_YOUR_TURN");
  if (state.roll) throw new Error("DICE_ALREADY_ROLLED");
  if (!Number.isInteger(dice) || dice < 1 || dice > 6) {
    throw new Error("INVALID_DICE");
  }
  const consecutiveSixes =
    dice === 6 ? state.consecutiveSixes + 1 : 0;
  const legalTokenIndexes = getLegalTokenIndexes(
    state,
    positions,
    userId,
    dice,
  );
  const rolled: GameBoardState = {
    ...state,
    consecutiveSixes,
    roll: { dice, legalTokenIndexes },
    turnStartedAt: now.toISOString(),
    turnDeadline: addSeconds(now, state.turnSeconds),
    lastAction: {
      type: "roll",
      userId,
      dice,
      at: now.toISOString(),
    },
  };
  if (legalTokenIndexes.length > 0) {
    return {
      state: {
        ...rolled,
        turnStartedAt: now.toISOString(),
        turnDeadline: addSeconds(now, state.turnSeconds),
      },
      currentTurn,
      autoPassed: false,
    };
  }
  const next = nextPlayer(rolled, userId);
  return {
    state: next
      ? resetTurn(rolled, next, now, {
          type: "turn",
          userId: next,
          at: now.toISOString(),
        })
      : rolled,
    currentTurn: next,
    autoPassed: true,
  };
}

function resolvePlacements(state: GameBoardState): GameBoardState {
  const target = state.boardType === "2p" ? 1 : 2;
  if (state.finishOrder.length >= target) {
    const placements =
      state.boardType === "2p"
        ? [
            ...state.finishOrder,
            ...activePlayers(state).filter(
              (userId) => !state.finishOrder.includes(userId),
            ),
          ].slice(0, 2)
        : state.finishOrder.slice(0, target);
    return {
      ...state,
      phase: "completed",
      placements,
      lastAction: {
        type: "game_over",
        at: state.lastAction.at,
      },
    };
  }
  const active = activePlayers(state);
  if (active.length <= 1) {
    const placements = [...state.finishOrder, ...active].slice(0, target);
    return {
      ...state,
      phase: "completed",
      placements,
      lastAction: {
        type: "game_over",
        at: state.lastAction.at,
      },
    };
  }
  return state;
}

export function applyTokenMove(
  state: GameBoardState,
  positions: TokenPositions,
  currentTurn: string,
  userId: string,
  tokenIndex: number,
  now = new Date(),
): {
  state: GameBoardState;
  tokenPositions: TokenPositions;
  currentTurn: string | null;
  killedUserIds: string[];
  reachedHome: boolean;
} {
  if (state.phase !== "active") throw new Error("GAME_NOT_ACTIVE");
  if (currentTurn !== userId) throw new Error("NOT_YOUR_TURN");
  if (!state.roll) throw new Error("ROLL_REQUIRED");
  if (!state.roll.legalTokenIndexes.includes(tokenIndex)) {
    throw new Error("ILLEGAL_MOVE");
  }
  const rules = getGameModeRules(state.gameMode);
  const currentTokens = positions[userId] ?? [];
  const from = currentTokens[tokenIndex];
  if (from === undefined) throw new Error("TOKEN_NOT_FOUND");
  const to = from < 0 ? 0 : from + state.roll.dice;
  const nextPositions: TokenPositions = Object.fromEntries(
    Object.entries(positions).map(([id, tokens]) => [id, [...tokens]]),
  );
  nextPositions[userId]![tokenIndex] = to;

  const killedUserIds: string[] = [];
  const killedTokens: Array<{
    userId: string;
    tokenIndex: number;
    from: number;
  }> = [];
  const target = globalTrackPosition(state, userId, to);
  if (target !== null && !rules.safeGlobalCells.includes(target)) {
    for (const opponentId of state.playerOrder) {
      if (opponentId === userId) continue;
      const opponentTokens = nextPositions[opponentId] ?? [];
      const targetIndexes = opponentTokens.flatMap((position, index) =>
        globalTrackPosition(state, opponentId, position) === target
          ? [index]
          : [],
      );
      if (targetIndexes.length === 1) {
        const killedTokenIndex = targetIndexes[0]!;
        const killedFrom = opponentTokens[killedTokenIndex]!;
        opponentTokens[killedTokenIndex] = -1;
        killedUserIds.push(opponentId);
        killedTokens.push({
          userId: opponentId,
          tokenIndex: killedTokenIndex,
          from: killedFrom,
        });
      }
    }
  }

  const reachedHome = to === rules.finishPosition;
  let finishOrder = [...state.finishOrder];
  if (
    nextPositions[userId]!.every(
      (position) => position === rules.finishPosition,
    ) &&
    !finishOrder.includes(userId)
  ) {
    finishOrder.push(userId);
  }
  const captures = {
    ...state.captures,
    [userId]: (state.captures[userId] ?? 0) + killedUserIds.length,
  };
  const moved: GameBoardState = {
    ...state,
    roll: null,
    finishOrder,
    captures,
    lastAction: {
      type: killedUserIds.length
        ? "kill"
        : reachedHome
          ? "home"
          : "move",
      userId,
      tokenIndex,
      from,
      to,
      ...(killedUserIds.length ? { killedUserIds } : {}),
      ...(killedTokens.length ? { killedTokens } : {}),
      at: now.toISOString(),
    },
  };
  const resolved = resolvePlacements(moved);
  if (resolved.phase === "completed") {
    return {
      state: resolved,
      tokenPositions: nextPositions,
      currentTurn: null,
      killedUserIds,
      reachedHome,
    };
  }

  const extraTurn =
    killedUserIds.length > 0 ||
    reachedHome ||
    (state.roll.dice === 6 && state.consecutiveSixes < 2);
  if (extraTurn) {
    return {
      state: {
        ...moved,
        turnStartedAt: now.toISOString(),
        turnDeadline: addSeconds(now, state.turnSeconds),
        consecutiveSixes:
          state.roll.dice === 6 ? state.consecutiveSixes : 0,
      },
      tokenPositions: nextPositions,
      currentTurn: userId,
      killedUserIds,
      reachedHome,
    };
  }
  const next = nextPlayer(moved, userId);
  return {
    state: next
      ? resetTurn(moved, next, now, {
          type: "turn",
          userId: next,
          at: now.toISOString(),
        })
      : moved,
    tokenPositions: nextPositions,
    currentTurn: next,
    killedUserIds,
    reachedHome,
  };
}

export function eliminatePlayer(
  state: GameBoardState,
  positions: TokenPositions,
  currentTurn: string | null,
  userId: string,
  reason: EliminationReason,
  now = new Date(),
): {
  state: GameBoardState;
  tokenPositions: TokenPositions;
  currentTurn: string | null;
} {
  if (
    state.eliminatedOrder.includes(userId) ||
    state.finishOrder.includes(userId)
  ) {
    return { state, tokenPositions: positions, currentTurn };
  }
  const eliminated: GameBoardState = {
    ...state,
    roll: currentTurn === userId ? null : state.roll,
    eliminatedOrder: [...state.eliminatedOrder, userId],
    eliminationReasons: {
      ...state.eliminationReasons,
      [userId]: reason,
    },
    lastAction: {
      type: "eliminated",
      userId,
      reason,
      at: now.toISOString(),
    },
  };
  const resolved = resolvePlacements(eliminated);
  if (resolved.phase === "completed") {
    return { state: resolved, tokenPositions: positions, currentTurn: null };
  }
  if (currentTurn !== userId) {
    return { state: resolved, tokenPositions: positions, currentTurn };
  }
  const next = nextPlayer(resolved, userId);
  return {
    state: next
      ? resetTurn(resolved, next, now, {
          type: "turn",
          userId: next,
          at: now.toISOString(),
        })
      : resolved,
    tokenPositions: positions,
    currentTurn: next,
  };
}

export function applyTurnMiss(
  state: GameBoardState,
  positions: TokenPositions,
  currentTurn: string,
  userId: string,
  missCount: number,
  now = new Date(),
): {
  state: GameBoardState;
  tokenPositions: TokenPositions;
  currentTurn: string | null;
  missCount: number;
  eliminated: boolean;
} {
  if (currentTurn !== userId) throw new Error("NOT_YOUR_TURN");
  const nextMissCount = missCount + 1;
  if (nextMissCount >= 3) {
    const result = eliminatePlayer(
      state,
      positions,
      currentTurn,
      userId,
      "misses",
      now,
    );
    return {
      ...result,
      missCount: nextMissCount,
      eliminated: true,
    };
  }
  const next = nextPlayer(state, userId);
  return {
    state: next
      ? resetTurn(state, next, now, {
          type: "miss",
          userId,
          at: now.toISOString(),
        })
      : state,
    tokenPositions: positions,
    currentTurn: next,
    missCount: nextMissCount,
    eliminated: false,
  };
}
