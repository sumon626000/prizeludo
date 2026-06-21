import { describe, expect, it } from "vitest";
import {
  buildCapturedReturnSteps,
  buildTokenMovementSteps,
  resolveCapturedTokens,
} from "./game-animation";

describe("buildTokenMovementSteps", () => {
  it("releases a yard token and advances through every cell", () => {
    expect(buildTokenMovementSteps(-1, 4)).toEqual([0, 1, 2, 3, 4]);
  });

  it("walks an active token one logical position at a time", () => {
    expect(buildTokenMovementSteps(11, 16)).toEqual([12, 13, 14, 15, 16]);
  });

  it("snaps captures and non-forward corrections to their final position", () => {
    expect(buildTokenMovementSteps(22, -1)).toEqual([-1]);
    expect(buildTokenMovementSteps(8, 8)).toEqual([8]);
  });
});

describe("buildCapturedReturnSteps", () => {
  it("walks a captured token backward into its yard", () => {
    expect(buildCapturedReturnSteps(4)).toEqual([3, 2, 1, 0, -1]);
    expect(buildCapturedReturnSteps(0)).toEqual([-1]);
  });
});

describe("resolveCapturedTokens", () => {
  it("uses server-provided kill metadata when available", () => {
    expect(
      resolveCapturedTokens(
        {
          userId: "a",
          killedTokens: [{ userId: "b", tokenIndex: 2, from: 4 }],
        },
        { a: [0, 0, 0, 0], b: [4, -1, 8, -1] },
        { a: [4, 0, 0, 0], b: [-1, -1, 8, -1] },
      ),
    ).toEqual([
      {
        playerId: "b",
        tokenIndex: 2,
        key: "b-2",
        from: 4,
        steps: [3, 2, 1, 0, -1],
      },
    ]);
  });

  it("falls back to board diffs when kill metadata is missing", () => {
    expect(
      resolveCapturedTokens(
        { userId: "a" },
        { a: [0, 0, 0, 0], b: [4, -1, -1, -1] },
        { a: [4, 0, 0, 0], b: [-1, -1, -1, -1] },
      ),
    ).toEqual([
      {
        playerId: "b",
        tokenIndex: 0,
        key: "b-0",
        from: 4,
        steps: [3, 2, 1, 0, -1],
      },
    ]);
  });
});
