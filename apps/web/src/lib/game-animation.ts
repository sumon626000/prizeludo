export function buildTokenMovementSteps(from: number, to: number): number[] {
  if (to < 0) return [to];
  if (from < 0) {
    return Array.from({ length: to + 1 }, (_, index) => index);
  }
  if (to <= from) return [to];
  return Array.from({ length: to - from }, (_, index) => from + index + 1);
}

export function buildCapturedReturnSteps(from: number): number[] {
  if (from <= 0) return [-1];
  return Array.from({ length: from + 1 }, (_, index) => from - index - 1);
}

/** Map logical token position to board grid cell (0-based row/col). */
export function tokenBoardCoordinate(
  position: number,
  tokenIndex: number,
  boardSeat: number,
  homeLaneStart: number,
  finishPosition: number,
  track: Array<[number, number]>,
  homeLanes: Array<Array<[number, number]>>,
  yards: Array<Array<[number, number]>>,
): [number, number] {
  if (position < 0) return yards[boardSeat]![tokenIndex]!;
  if (position >= finishPosition) {
    return homeLanes[boardSeat]![5]!;
  }
  if (position >= homeLaneStart) {
    const progress = Math.min(5, position - homeLaneStart);
    return homeLanes[boardSeat]![progress]!;
  }
  const offset = [0, 13, 26, 39][boardSeat]!;
  return track[(offset + position) % 52]!;
}

export type CapturedTokenAnimation = {
  playerId: string;
  tokenIndex: number;
  key: string;
  from: number;
  steps: number[];
};

export function resolveCapturedTokens(
  action: {
    userId?: string;
    killedTokens?: Array<{
      userId: string;
      tokenIndex: number;
      from: number;
    }>;
  },
  previous: Record<string, number[]>,
  next: Record<string, number[]>,
): CapturedTokenAnimation[] {
  if (action.killedTokens?.length) {
    return action.killedTokens.map(({ userId, tokenIndex, from }) => ({
      playerId: userId,
      tokenIndex,
      key: `${userId}-${tokenIndex}`,
      from,
      steps: buildCapturedReturnSteps(from),
    }));
  }

  const attackerId = action.userId ?? "";
  return Object.entries(previous).flatMap(([capturedPlayerId, tokens]) =>
    tokens.flatMap((position, capturedTokenIndex) =>
      capturedPlayerId !== attackerId &&
      position >= 0 &&
      next[capturedPlayerId]?.[capturedTokenIndex] === -1
        ? [
            {
              playerId: capturedPlayerId,
              tokenIndex: capturedTokenIndex,
              key: `${capturedPlayerId}-${capturedTokenIndex}`,
              from: position,
              steps: buildCapturedReturnSteps(position),
            },
          ]
        : [],
    ),
  );
}
