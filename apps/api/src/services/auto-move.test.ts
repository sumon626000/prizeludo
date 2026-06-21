import { describe, expect, it } from "vitest";
import {
  buildAutoMoveContext,
  pickSmartAutoToken,
} from "./auto-move.service.js";
import { createInitialGame } from "./game-engine.js";

describe("auto-move.service", () => {
  it("returns a legal token for multi-choice moves", () => {
    const left = "left-user";
    const right = "right-user";
    const game = createInitialGame([left, right], "2p", "classic", new Date());
    const positions = {
      ...game.tokenPositions,
      [left]: [20, -1, -1, -1],
      [right]: [20, -1, -1, -1],
    };
    const state = {
      ...game.state,
      roll: { dice: 4, legalTokenIndexes: [0, 1] },
    };
    const context = buildAutoMoveContext("2p", state, positions, left);
    expect(context).toBeTruthy();
    expect([0, 1]).toContain(pickSmartAutoToken(context!));
  });
});
