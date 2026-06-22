import { describe, expect, it } from "vitest";
import {
  estimateForwardMoveDuration,
  getForwardStepDuration,
  getKillReturnStepDuration,
  getOnlyLegalTokenIndex,
  getPlayerPodSeat,
  getTokenHopDuration,
  getTurnProgress,
  pickSmartAutoToken,
  getEarlyFinishLabel,
  getAuthoritativeDiceForPlayer,
  TOKEN_KILL_RETURN_TOTAL_MS,
  TOKEN_RELEASE_MS,
  TOKEN_SINGLE_MOVE_MS,
  TOKEN_STEP_MS,
  waitForPlayerDiceRollFinish,
} from "./game-ui";

describe("game UI helpers", () => {
  it("keeps the local player at bottom-right in two-player games", () => {
    expect(getPlayerPodSeat(0, 0, "2p")).toBe(2);
    expect(getPlayerPodSeat(1, 0, "2p")).toBe(0);
    expect(getPlayerPodSeat(1, 1, "2p")).toBe(2);
  });

  it("rotates four-player pods around a bottom-right local seat", () => {
    expect([0, 1, 2, 3].map((index) => getPlayerPodSeat(index, 1, "4p")))
      .toEqual([1, 2, 3, 0]);
  });

  it("auto-selects only an unambiguous legal move", () => {
    expect(getOnlyLegalTokenIndex([2])).toBe(2);
    expect(getOnlyLegalTokenIndex([])).toBeNull();
    expect(getOnlyLegalTokenIndex([0, 1])).toBeNull();
  });

  it("clamps the turn ring progress from remaining milliseconds", () => {
    expect(getTurnProgress(5_000, 10)).toBe(0.5);
    expect(getTurnProgress(12_000, 10)).toBe(1);
    expect(getTurnProgress(-1, 10)).toBe(0);
  });

  it("reads dice from active roll, diceValue, or last roll action", () => {
    const board = {
      roll: { dice: 5, legalTokenIndexes: [0] },
      lastAction: { type: "roll", userId: "opp", dice: 5 },
    };
    expect(getAuthoritativeDiceForPlayer(board, "opp", "opp", 5)).toBe(5);
    expect(
      getAuthoritativeDiceForPlayer(
        { ...board, roll: null },
        "opp",
        "opp",
        5,
      ),
    ).toBe(5);
    expect(
      getAuthoritativeDiceForPlayer(
        {
          roll: null,
          lastAction: { type: "move", userId: "opp" },
        },
        "opp",
        "opp",
        null,
      ),
    ).toBeNull();
  });

  it("matches recommended token movement timing", () => {
    expect(getForwardStepDuration("normal", 0, 3, 6)).toBe(TOKEN_STEP_MS);
    expect(getForwardStepDuration("normal", 0, -1, 4)).toBe(TOKEN_RELEASE_MS);
    expect(getForwardStepDuration("normal", 0, 8, 1)).toBe(
      TOKEN_SINGLE_MOVE_MS,
    );
    expect(estimateForwardMoveDuration("normal", 3, 6)).toBe(6 * TOKEN_STEP_MS);
    expect(estimateForwardMoveDuration("normal", 8, 1)).toBe(
      TOKEN_SINGLE_MOVE_MS,
    );
    expect(getKillReturnStepDuration("normal", 5)).toBe(
      Math.round(TOKEN_KILL_RETURN_TOTAL_MS / 5),
    );
    expect(getTokenHopDuration("normal")).toBe(TOKEN_STEP_MS);
  });

  it("prefers a kill move when auto-picking tokens", () => {
    const context = {
      boardType: "2p" as const,
      playerOrder: ["me", "opp"],
      userId: "me",
      dice: 3,
      legalTokenIndexes: [0, 1],
      tokenPositions: {
        me: [10, 5],
        opp: [-1, -1, -1, 13],
      },
      finishPosition: 57,
      homeLaneStart: 52,
      safeGlobalCells: [0, 8, 13, 21, 26, 34, 39, 47],
    };
    expect(pickSmartAutoToken(context)).toBe(0);
  });

  it("labels early finishers in active four-player games", () => {
    expect(
      getEarlyFinishLabel(["a", "b"], "a", "4p", "active", false),
    ).toBe("1st Winner");
    expect(
      getEarlyFinishLabel(["a", "b"], "b", "4p", "active", true),
    ).toBe("২য় বিজয়ী");
    expect(
      getEarlyFinishLabel(["a"], "a", "2p", "active", false),
    ).toBeNull();
  });

  it("waits for dice animation before token pause", async () => {
    let rolling = true;
    const timer = window.setTimeout(() => {
      rolling = false;
    }, 30);
    await waitForPlayerDiceRollFinish(() => rolling, "player-1");
    window.clearTimeout(timer);
    expect(rolling).toBe(false);
  });
});
