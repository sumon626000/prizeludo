import {
  applyDiceRoll,
  applyTokenMove,
  createInitialGame,
  type BoardType,
  type GameMode,
} from "../apps/api/src/services/game-engine.ts";

const modes: GameMode[] = ["classic", "quick", "master"];
const boards: BoardType[] = ["2p", "4p"];
const gamesPerCombination = Number(process.argv[2] ?? 100);
const maxActions = 20_000;

function makeRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
    return value / 0x1_0000_0000;
  };
}

function simulateGame(boardType: BoardType, gameMode: GameMode, seed: number) {
  const playerCount = boardType === "4p" ? 4 : 2;
  const players = Array.from(
    { length: playerCount },
    (_, index) => `${boardType}-${gameMode}-${seed}-${index}`,
  );
  const random = makeRandom(seed);
  let nowMs = Date.UTC(2026, 0, 1);
  let { state, tokenPositions } = createInitialGame(
    players,
    boardType,
    gameMode,
    new Date(nowMs),
  );
  let currentTurn: string | null = players[0]!;
  let actions = 0;

  while (state.phase === "active" && actions < maxActions) {
    nowMs += 100;
    if (!state.roll) {
      const dice = 1 + Math.floor(random() * 6);
      const rolled = applyDiceRoll(
        state,
        tokenPositions,
        currentTurn!,
        currentTurn!,
        dice,
        new Date(nowMs),
      );
      state = rolled.state;
      currentTurn = rolled.currentTurn;
      actions += 1;
      if (rolled.autoPassed) continue;
    }

    const legal = state.roll?.legalTokenIndexes ?? [];
    const tokenIndex = legal[Math.floor(random() * legal.length)];
    if (tokenIndex === undefined || !currentTurn) {
      throw new Error(`Invalid legal move state for ${boardType}/${gameMode}`);
    }
    const moved = applyTokenMove(
      state,
      tokenPositions,
      currentTurn,
      currentTurn,
      tokenIndex,
      new Date(nowMs),
    );
    state = moved.state;
    tokenPositions = moved.tokenPositions;
    currentTurn = moved.currentTurn;
    actions += 1;
  }

  if (state.phase !== "completed") {
    throw new Error(
      `${boardType}/${gameMode} seed ${seed} exceeded ${maxActions} actions`,
    );
  }
  const expectedPlacements = boardType === "4p" ? 2 : 2;
  if (
    state.placements.length === 0 ||
    state.placements.length > expectedPlacements ||
    new Set(state.placements).size !== state.placements.length ||
    state.placements.some((userId) => !players.includes(userId))
  ) {
    throw new Error(`Invalid placements for ${boardType}/${gameMode}`);
  }
  return actions;
}

const startedAt = performance.now();
let totalGames = 0;
let totalActions = 0;
let seed = 1;
for (const boardType of boards) {
  for (const gameMode of modes) {
    for (let index = 0; index < gamesPerCombination; index += 1) {
      totalActions += simulateGame(boardType, gameMode, seed);
      totalGames += 1;
      seed += 1;
    }
  }
}

const durationMs = performance.now() - startedAt;
console.log(
  JSON.stringify(
    {
      totalGames,
      totalActions,
      durationMs: Math.round(durationMs),
      gamesPerSecond: Number((totalGames / (durationMs / 1_000)).toFixed(2)),
    },
    null,
    2,
  ),
);
