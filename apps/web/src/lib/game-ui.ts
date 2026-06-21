import { useCallback, useEffect, useRef, useState } from "react";

export function getPlayerPodSeat(
  playerIndex: number,
  ownPlayerIndex: number,
  boardType: "2p" | "4p",
) {
  if (ownPlayerIndex < 0) {
    return boardType === "2p" && playerIndex === 1 ? 2 : playerIndex;
  }
  if (boardType === "2p") return playerIndex === ownPlayerIndex ? 2 : 0;
  return (2 + playerIndex - ownPlayerIndex + 4) % 4;
}

export function getOnlyLegalTokenIndex(legalTokenIndexes: number[]) {
  return legalTokenIndexes.length === 1 ? legalTokenIndexes[0]! : null;
}

const START_OFFSETS = [0, 13, 26, 39];

export type AutoMoveContext = {
  boardType: "2p" | "4p";
  playerOrder: string[];
  userId: string;
  dice: number;
  legalTokenIndexes: number[];
  tokenPositions: Record<string, number[]>;
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

function wouldKillOpponent(
  context: AutoMoveContext,
  to: number,
): boolean {
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

export function getEarlyFinishLabel(
  finishOrder: string[],
  playerId: string,
  boardType: "2p" | "4p",
  phase: string,
  bn: boolean,
): string | null {
  if (phase !== "active" || boardType !== "4p") return null;
  const rank = finishOrder.indexOf(playerId);
  if (rank === 0) return bn ? "১ম বিজয়ী" : "1st Winner";
  if (rank === 1) return bn ? "২য় বিজয়ী" : "2nd Winner";
  return null;
}

export function buildAutoMoveContext(
  room: {
    tournament: { boardType: "2p" | "4p" };
    rules: {
      finishPosition: number;
      homeLaneStart: number;
      safeGlobalCells: number[];
    };
    state: {
      tokenPositions: Record<string, number[]>;
      boardState: {
        playerOrder: string[];
        roll: { dice: number; legalTokenIndexes: number[] } | null;
      };
    };
  },
  userId: string,
): AutoMoveContext | null {
  const roll = room.state.boardState.roll;
  if (!roll || roll.legalTokenIndexes.length === 0) return null;
  return {
    boardType: room.tournament.boardType,
    playerOrder: room.state.boardState.playerOrder,
    userId,
    dice: roll.dice,
    legalTokenIndexes: roll.legalTokenIndexes,
    tokenPositions: room.state.tokenPositions,
    finishPosition: room.rules.finishPosition,
    homeLaneStart: room.rules.homeLaneStart,
    safeGlobalCells: room.rules.safeGlobalCells,
  };
}

export const AUTO_HUMAN_ROLL_DELAY_MS = 520;
export const AUTO_HUMAN_MOVE_DELAY_MS = 820;

export function getTurnProgress(remainingMs: number, turnSeconds: number) {
  if (turnSeconds <= 0) return 0;
  const totalMs = turnSeconds * 1_000;
  return Math.max(0, Math.min(1, remainingMs / totalMs));
}

export const DICE_ROLL_MS = 1500;
/** Standard board cell hop — step-by-step movement with visible bounce. */
export const TOKEN_STEP_MS = 520;
/** Single-cell move total. */
export const TOKEN_SINGLE_MOVE_MS = 620;
/** Yard release / first step out. */
export const TOKEN_RELEASE_MS = 700;
/** Pause after dice lands before the token starts walking. */
export const TOKEN_MOVE_AFTER_DICE_MS = 580;
/** Total kill-return animation budget. */
export const TOKEN_KILL_RETURN_TOTAL_MS = 960;
/** Pause on the kill cell — impact shake before walking back. */
export const TOKEN_KILL_PAUSE_MS = 380;
export const TOKEN_KILL_IMPACT_MS = TOKEN_KILL_PAUSE_MS;

function scaleTokenMs(
  base: number,
  speed: "fast" | "normal" | "slow" = "normal",
) {
  if (speed === "fast") return Math.round(base * 0.92);
  if (speed === "slow") return Math.round(base * 1.22);
  return base;
}

export function tokenPositionsEqual(
  left: Record<string, number[]>,
  right: Record<string, number[]>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => {
    const leftTokens = left[key] ?? [];
    const rightTokens = right[key] ?? [];
    return (
      leftTokens.length === rightTokens.length &&
      leftTokens.every((value, index) => value === rightTokens[index])
    );
  });
}

export function getDiceRollDuration(speed: "fast" | "normal" | "slow" = "normal") {
  if (speed === "fast") return Math.round(DICE_ROLL_MS * 0.72);
  if (speed === "slow") return Math.round(DICE_ROLL_MS * 1.35);
  return DICE_ROLL_MS;
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Wait until a player's dice animation finishes, then the standard Ludo pause. */
export async function waitForPlayerDiceRollFinish(
  isRolling: (playerId: string) => boolean,
  playerId: string,
): Promise<void> {
  while (isRolling(playerId)) {
    await sleepMs(40);
  }
  await sleepMs(TOKEN_MOVE_AFTER_DICE_MS);
}

export function getForwardStepDuration(
  speed: "fast" | "normal" | "slow",
  stepIndex: number,
  from: number,
  totalSteps: number,
): number {
  if (from < 0 && stepIndex === 0) {
    return scaleTokenMs(TOKEN_RELEASE_MS, speed);
  }
  if (totalSteps === 1) {
    return scaleTokenMs(TOKEN_SINGLE_MOVE_MS, speed);
  }
  return scaleTokenMs(TOKEN_STEP_MS, speed);
}

export function getKillReturnStepDuration(
  speed: "fast" | "normal" | "slow",
  returnStepCount: number,
): number {
  if (returnStepCount <= 0) return 0;
  return Math.max(
    50,
    Math.round(
      scaleTokenMs(TOKEN_KILL_RETURN_TOTAL_MS, speed) / returnStepCount,
    ),
  );
}

export function getTokenHopDuration(speed: "fast" | "normal" | "slow" = "normal") {
  return scaleTokenMs(TOKEN_STEP_MS, speed);
}

/** @deprecated Use getForwardStepDuration for animated moves. */
export function getTokenStepDuration(speed: "fast" | "normal" | "slow" = "normal") {
  return scaleTokenMs(TOKEN_STEP_MS, speed);
}

export function estimateForwardMoveDuration(
  speed: "fast" | "normal" | "slow",
  from: number,
  stepCount: number,
): number {
  return Array.from({ length: stepCount }, (_, index) =>
    getForwardStepDuration(speed, index, from, stepCount),
  ).reduce((total, duration) => total + duration, 0);
}

export function getPlacementPrize(
  tournament: {
    prizePool: string;
    prizeFirst: string;
    prizeSecond: string;
  },
  placement: number | null | undefined,
) {
  if (!placement || placement < 1) return 0;
  const pool = Number(tournament.prizePool);
  if (placement === 1) {
    return (pool * Number(tournament.prizeFirst)) / 100;
  }
  if (placement === 2) {
    return (pool * Number(tournament.prizeSecond)) / 100;
  }
  return 0;
}

export function useMultiplayerDiceRolls(
  diceSpeed: "fast" | "normal" | "slow" = "normal",
  onReveal?: (playerId: string, dice: number) => void,
) {
  const [activeRolls, setActiveRolls] = useState<Record<string, number>>({});
  const pendingDiceRef = useRef<Record<string, number>>({});
  const faceStateRef = useRef<Map<string, { face: number; lastChange: number }>>(
    new Map(),
  );
  const [rollFaces, setRollFaces] = useState<Record<string, number>>({});
  const [rollProgressByPlayer, setRollProgressByPlayer] = useState<
    Record<string, number>
  >({});

  const startRoll = useCallback((playerId: string, dice?: number) => {
    if (dice !== undefined) {
      pendingDiceRef.current[playerId] = dice;
    }
    faceStateRef.current.set(playerId, {
      face: 1,
      lastChange: performance.now(),
    });
    setActiveRolls((current) => ({ ...current, [playerId]: performance.now() }));
  }, []);

  const setRollResult = useCallback((playerId: string, dice: number) => {
    pendingDiceRef.current[playerId] = dice;
  }, []);

  const isRolling = useCallback(
    (playerId: string) => playerId in activeRolls,
    [activeRolls],
  );

  useEffect(() => {
    const rollingIds = Object.keys(activeRolls);
    if (rollingIds.length === 0) {
      setRollFaces({});
      setRollProgressByPlayer({});
      return;
    }

    const duration = getDiceRollDuration(diceSpeed);
    let raf = 0;
    const progressKeys: Record<string, number> = {};
    let publishedFaces = false;
    let publishedProgress = false;

    const tick = (now: number) => {
      const nextFaces: Record<string, number> = {};
      const nextProgress: Record<string, number> = {};
      const finished: Array<{ playerId: string; dice: number }> = [];
      let facesChanged = false;
      let progressChanged = false;

      for (const playerId of rollingIds) {
        const startedAt = activeRolls[playerId]!;
        const elapsed = now - startedAt;
        const progress = Math.min(1, elapsed / duration);
        const progressKey = Math.floor(progress * 25);
        if (progressKeys[playerId] !== progressKey) {
          progressKeys[playerId] = progressKey;
          progressChanged = true;
        }
        nextProgress[playerId] = progress;

        const currentFace =
          faceStateRef.current.get(playerId) ?? {
            face: 1,
            lastChange: startedAt,
          };
        const interval = 55 + progress * progress * 165;
        if (now - currentFace.lastChange >= interval) {
          currentFace.face = (currentFace.face % 6) + 1;
          currentFace.lastChange = now;
          facesChanged = true;
        }
        faceStateRef.current.set(playerId, currentFace);
        nextFaces[playerId] = currentFace.face;

        if (progress >= 1) {
          finished.push({
            playerId,
            dice: pendingDiceRef.current[playerId] ?? currentFace.face,
          });
        }
      }

      if (facesChanged || !publishedFaces) {
        setRollFaces(nextFaces);
        publishedFaces = true;
      }
      if (progressChanged || finished.length > 0 || !publishedProgress) {
        setRollProgressByPlayer(nextProgress);
        publishedProgress = true;
      }

      if (finished.length > 0) {
        setActiveRolls((current) => {
          const next = { ...current };
          for (const item of finished) {
            delete next[item.playerId];
            delete pendingDiceRef.current[item.playerId];
            faceStateRef.current.delete(item.playerId);
            onReveal?.(item.playerId, item.dice);
          }
          return next;
        });
      }

      const stillRolling = rollingIds.some(
        (playerId) => (nextProgress[playerId] ?? 0) < 1,
      );
      if (stillRolling) {
        raf = requestAnimationFrame(tick);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [activeRolls, diceSpeed, onReveal]);

  return {
    startRoll,
    setRollResult,
    isRolling,
    rollingFace: (playerId: string) => rollFaces[playerId],
    rollProgress: (playerId: string) => rollProgressByPlayer[playerId] ?? 0,
  };
}
