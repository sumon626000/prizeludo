import { getDiceRollDuration, getTokenMoveAfterDiceMs, sleepMs } from "./game-ui";

export type GameplayPhase =
  | "WAITING_FOR_ROLL"
  | "ROLLING_DICE"
  | "WAITING_FOR_TOKEN_SELECTION"
  | "MOVING_TOKEN"
  | "TURN_COMPLETE";

export function deriveGameplayPhase(input: {
  phase: string;
  currentTurn: string | null;
  userId?: string;
  hasRoll: boolean;
  rolling: boolean;
  tokenAnimating: boolean;
  moveBusy: boolean;
  rollBusy: boolean;
}): GameplayPhase {
  if (input.phase !== "active" || !input.currentTurn) return "TURN_COMPLETE";
  if (input.rolling || input.rollBusy) return "ROLLING_DICE";
  if (input.tokenAnimating || input.moveBusy) return "MOVING_TOKEN";
  if (input.hasRoll) return "WAITING_FOR_TOKEN_SELECTION";
  if (input.currentTurn === input.userId) return "WAITING_FOR_ROLL";
  return "TURN_COMPLETE";
}

export class GameplayPlaybackQueue {
  private chain = Promise.resolve();

  enqueue(task: () => Promise<void>) {
    this.chain = this.chain
      .then(task)
      .catch(() => undefined);
    return this.chain;
  }

  reset() {
    this.chain = Promise.resolve();
  }
}

export class GameplayEventGate {
  private seen = new Set<string>();

  accept(key: string, stateVersion?: number) {
    const id =
      stateVersion !== undefined ? `${stateVersion}|${key}` : key;
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    if (this.seen.size > 200) {
      this.seen.clear();
      this.seen.add(id);
    }
    return true;
  }

  reset() {
    this.seen.clear();
  }
}

export async function playDiceReveal(
  startRoll: (playerId: string, dice: number) => void,
  isRolling: (playerId: string) => boolean,
  playerId: string,
  dice: number,
  diceSpeed: "fast" | "normal" | "slow",
  tokenSpeed: "fast" | "normal" | "slow" = "normal",
  options?: { skipAnimation?: boolean },
) {
  if (options?.skipAnimation) {
    return;
  }
  startRoll(playerId, dice);
  await sleepMs(getDiceRollDuration(diceSpeed));
  const started = Date.now();
  while (isRolling(playerId)) {
    if (Date.now() - started > 6_000) break;
    await sleepMs(40);
  }
  await sleepMs(getTokenMoveAfterDiceMs(tokenSpeed));
}

const lastTapAt = new Map<string, number>();

export function canAcceptTap(key: string, minGapMs = 280) {
  const now = Date.now();
  const last = lastTapAt.get(key) ?? 0;
  if (now - last < minGapMs) return false;
  lastTapAt.set(key, now);
  return true;
}

export function startStuckRecoveryWatch(
  isStuck: () => boolean,
  recover: () => void,
  timeoutMs = 12_000,
) {
  const timer = window.setInterval(() => {
    if (isStuck()) recover();
  }, timeoutMs);
  return () => window.clearInterval(timer);
}
