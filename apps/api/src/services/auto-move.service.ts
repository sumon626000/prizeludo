import { getGameModeRules, type GameBoardState, type TokenPositions } from "./game-engine.js";

const START_OFFSETS = [0, 13, 26, 39];

export type AutoMoveContext = {
  boardType: "2p" | "4p";
  playerOrder: string[];
  userId: string;
  dice: number;
  legalTokenIndexes: number[];
  tokenPositions: TokenPositions;
  finishPosition: number;
  homeLaneStart: number;
  safeGlobalCells: number[];
};

function globalTrackPosition(
  boardType: "2p" | "4p",
  playerOrder: string[],
  userId: string,
  position: number,
  homeLaneStart: number,
): number | null {
  if (position < 0 || position >= homeLaneStart) return null;
  const seat = playerOrder.indexOf(userId);
  if (seat < 0) return null;
  const offset =
    boardType === "2p"
      ? seat === 0
        ? START_OFFSETS[0]!
        : START_OFFSETS[2]!
      : START_OFFSETS[seat]!;
  return (offset + position) % 52;
}

function wouldKillOpponent(context: AutoMoveContext, to: number): boolean {
  const target = globalTrackPosition(
    context.boardType,
    context.playerOrder,
    context.userId,
    to,
    context.homeLaneStart,
  );
  if (target === null || context.safeGlobalCells.includes(target)) return false;
  return context.playerOrder.some((opponentId) => {
    if (opponentId === context.userId) return false;
    const opponentTokens = context.tokenPositions[opponentId] ?? [];
    const onCell = opponentTokens.filter(
      (position) =>
        globalTrackPosition(
          context.boardType,
          context.playerOrder,
          opponentId,
          position,
          context.homeLaneStart,
        ) === target,
    );
    return onCell.length === 1;
  });
}

function scoreAutoToken(context: AutoMoveContext, tokenIndex: number): number {
  const from = context.tokenPositions[context.userId]?.[tokenIndex] ?? -1;
  const to = from < 0 ? 0 : from + context.dice;
  let score = 0;

  if (wouldKillOpponent(context, to)) score += 10_000;
  if (to === context.finishPosition) score += 8_000;
  if (from < 0) score += 2_500;
  if (from < context.homeLaneStart && to >= context.homeLaneStart) {
    score += 1_500;
  }

  const global = globalTrackPosition(
    context.boardType,
    context.playerOrder,
    context.userId,
    to,
    context.homeLaneStart,
  );
  if (global !== null && context.safeGlobalCells.includes(global)) {
    score += 400;
  }

  score += to * 10;
  if (from >= 0) score += from;

  return score;
}

/** AFK auto-play: human-like picks — kills, home, safe progress (dice stays server-fair). */
export function pickSmartAutoToken(context: AutoMoveContext): number | null {
  const { legalTokenIndexes } = context;
  if (legalTokenIndexes.length === 0) return null;
  if (legalTokenIndexes.length === 1) return legalTokenIndexes[0]!;

  return [...legalTokenIndexes].sort(
    (left, right) => scoreAutoToken(context, right) - scoreAutoToken(context, left),
  )[0]!;
}

export function buildAutoMoveContext(
  boardType: "2p" | "4p",
  state: GameBoardState,
  positions: TokenPositions,
  userId: string,
): AutoMoveContext | null {
  const roll = state.roll;
  if (!roll || roll.legalTokenIndexes.length === 0) return null;
  const rules = getGameModeRules(state.gameMode);
  return {
    boardType,
    playerOrder: state.playerOrder,
    userId,
    dice: roll.dice,
    legalTokenIndexes: roll.legalTokenIndexes,
    tokenPositions: positions,
    finishPosition: rules.finishPosition,
    homeLaneStart: rules.homeLaneStart,
    safeGlobalCells: rules.safeGlobalCells,
  };
}

export const AUTO_HUMAN_ROLL_DELAY_MS = 520;
export const AUTO_HUMAN_MOVE_DELAY_MS = 820;
