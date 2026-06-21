import { describe, expect, it } from "vitest";
import {
  applyDiceRoll,
  applyTokenMove,
  applyTurnMiss,
  createInitialGame,
  eliminatePlayer,
  getGameModeRules,
  getLegalTokenIndexes,
} from "./game-engine.js";

describe("server-authoritative Ludo engine", () => {
  it("implements distinct Classic, Quick, and Master rules", () => {
    expect(getGameModeRules("classic")).toMatchObject({
      releaseRolls: [6],
      finishPosition: 57,
      turnSeconds: 10,
    });
    expect(getGameModeRules("quick")).toMatchObject({
      releaseRolls: [1, 2, 3, 4, 5, 6],
      finishPosition: 29,
      turnSeconds: 10,
    });
    expect(getGameModeRules("master")).toMatchObject({
      releaseRolls: [5, 6],
      requiresCaptureForHome: true,
      turnSeconds: 10,
    });
  });

  it("resets the move timer after a legal dice roll", () => {
    const initial = createInitialGame(["a", "b"], "2p", "classic");
    const rolledAt = new Date("2026-06-18T12:00:00.000Z");
    const rolled = applyDiceRoll(
      initial.state,
      initial.tokenPositions,
      "a",
      "a",
      6,
      rolledAt,
    );
    expect(rolled.state.turnDeadline).toBe("2026-06-18T12:00:10.000Z");
    expect(rolled.state.turnStartedAt).toBe(rolledAt.toISOString());
  });

  it("releases Classic tokens only on six and caps consecutive sixes at two", () => {
    const initial = createInitialGame(["a", "b"], "2p", "classic");
    expect(
      getLegalTokenIndexes(initial.state, initial.tokenPositions, "a", 5),
    ).toEqual([]);
    const firstRoll = applyDiceRoll(
      initial.state,
      initial.tokenPositions,
      "a",
      "a",
      6,
    );
    const firstMove = applyTokenMove(
      firstRoll.state,
      initial.tokenPositions,
      "a",
      "a",
      0,
    );
    expect(firstMove.currentTurn).toBe("a");
    const secondRoll = applyDiceRoll(
      firstMove.state,
      firstMove.tokenPositions,
      "a",
      "a",
      6,
    );
    const secondMove = applyTokenMove(
      secondRoll.state,
      firstMove.tokenPositions,
      "a",
      "a",
      0,
    );
    expect(secondMove.currentTurn).toBe("b");
  });

  it("kills on open cells but protects safe stars", () => {
    const initial = createInitialGame(["a", "b"], "2p", "classic");
    initial.tokenPositions.a = [4, -1, -1, -1];
    initial.tokenPositions.b = [31, -1, -1, -1];
    const roll = applyDiceRoll(
      initial.state,
      initial.tokenPositions,
      "a",
      "a",
      1,
    );
    const moved = applyTokenMove(
      roll.state,
      initial.tokenPositions,
      "a",
      "a",
      0,
    );
    expect(moved.killedUserIds).toEqual(["b"]);
    expect(moved.state.lastAction.killedTokens).toEqual([
      { userId: "b", tokenIndex: 0, from: 31 },
    ]);
    expect(moved.tokenPositions.b?.[0]).toBe(-1);

    const safe = createInitialGame(["a", "b"], "2p", "classic");
    safe.tokenPositions.a = [7, -1, -1, -1];
    safe.tokenPositions.b = [34, -1, -1, -1];
    const safeRoll = applyDiceRoll(
      safe.state,
      safe.tokenPositions,
      "a",
      "a",
      1,
    );
    const safeMove = applyTokenMove(
      safeRoll.state,
      safe.tokenPositions,
      "a",
      "a",
      0,
    );
    expect(safeMove.killedUserIds).toEqual([]);
    expect(safeMove.tokenPositions.b?.[0]).toBe(34);
  });

  it("treats two opponent tokens on one cell as a protected blockade", () => {
    const initial = createInitialGame(["a", "b"], "2p", "classic");
    initial.tokenPositions.a = [4, -1, -1, -1];
    initial.tokenPositions.b = [31, 31, -1, -1];

    expect(
      getLegalTokenIndexes(initial.state, initial.tokenPositions, "a", 1),
    ).toEqual([]);

    const moved = applyTokenMove(
      {
        ...initial.state,
        roll: { dice: 1, legalTokenIndexes: [0] },
      },
      initial.tokenPositions,
      "a",
      "a",
      0,
    );
    expect(moved.killedUserIds).toEqual([]);
    expect(moved.tokenPositions.b).toEqual([31, 31, -1, -1]);
  });

  it("requires a Master capture before entering the home lane", () => {
    const initial = createInitialGame(["a", "b"], "2p", "master");
    initial.tokenPositions.a = [51, -1, -1, -1];
    expect(
      getLegalTokenIndexes(initial.state, initial.tokenPositions, "a", 1),
    ).toEqual([]);
    initial.state.captures.a = 1;
    expect(
      getLegalTokenIndexes(initial.state, initial.tokenPositions, "a", 1),
    ).toEqual([0]);
  });

  it("opens the Master home gate when every token is trapped near it", () => {
    const initial = createInitialGame(["a", "b"], "2p", "master");
    initial.tokenPositions.a = [46, 47, 48, 51];
    expect(
      getLegalTokenIndexes(initial.state, initial.tokenPositions, "a", 1),
    ).toContain(3);
  });

  it("eliminates on the third miss and applies leave penalties", () => {
    const initial = createInitialGame(["a", "b"], "2p", "classic");
    const missed = applyTurnMiss(
      initial.state,
      initial.tokenPositions,
      "a",
      "a",
      2,
    );
    expect(missed.eliminated).toBe(true);
    expect(missed.state.phase).toBe("completed");
    expect(missed.state.placements).toEqual(["b"]);

    const four = createInitialGame(["a", "b", "c", "d"], "4p", "classic");
    const first = eliminatePlayer(
      four.state,
      four.tokenPositions,
      "a",
      "a",
      "leave",
    );
    expect(first.state.phase).toBe("active");
    const second = eliminatePlayer(
      first.state,
      first.tokenPositions,
      first.currentTurn,
      "b",
      "leave",
    );
    expect(second.state.phase).toBe("active");
    const third = eliminatePlayer(
      second.state,
      second.tokenPositions,
      second.currentTurn,
      "c",
      "leave",
    );
    expect(third.state.phase).toBe("completed");
    expect(third.state.placements).toEqual(["d"]);
  });
});
