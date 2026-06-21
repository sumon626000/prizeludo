import { describe, expect, it } from "vitest";
import {
  buildRoundGroups,
  getTournamentRoundName,
  getTournamentTotalRounds,
} from "./tournament.service.js";

describe("tournament bracket helpers", () => {
  it.each([
    [2, "2p", 1],
    [4, "2p", 2],
    [8, "2p", 3],
    [16, "2p", 4],
    [32, "2p", 5],
    [64, "2p", 6],
    [2, "4p", 1],
    [4, "4p", 1],
    [8, "4p", 2],
    [16, "4p", 3],
    [32, "4p", 4],
    [64, "4p", 5],
  ] as const)(
    "builds %i-player %s tournaments with %i rounds",
    (players, boardType, rounds) => {
      expect(getTournamentTotalRounds(players, boardType)).toBe(rounds);
    },
  );

  it("groups two-player and four-player rounds without dropping players", () => {
    const players = Array.from({ length: 10 }, (_, index) => `player-${index}`);
    expect(buildRoundGroups(players, "2p")).toEqual([
      ["player-0", "player-1"],
      ["player-2", "player-3"],
      ["player-4", "player-5"],
      ["player-6", "player-7"],
      ["player-8", "player-9"],
    ]);
    expect(buildRoundGroups(players, "4p")).toEqual([
      ["player-0", "player-1", "player-2", "player-3"],
      ["player-4", "player-5", "player-6", "player-7"],
      ["player-8", "player-9"],
    ]);
  });

  it.each([16, 32, 64] as const)(
    "progresses %i-player brackets to one final match without duplicates",
    (playerCount) => {
      for (const boardType of ["2p", "4p"] as const) {
        if (boardType === "4p" && playerCount < 4) continue;
        let participants = Array.from(
          { length: playerCount },
          (_, index) => `${boardType}-player-${index}`,
        );
        const rounds = getTournamentTotalRounds(playerCount, boardType);

        for (let round = 1; round <= rounds; round += 1) {
          const groups = buildRoundGroups(participants, boardType);
          expect(groups.flat()).toEqual(participants);
          expect(new Set(groups.flat()).size).toBe(participants.length);

          if (round === rounds) {
            expect(groups).toHaveLength(1);
            break;
          }
          participants = groups.flatMap((group) =>
            group.slice(0, boardType === "4p" ? 2 : 1),
          );
        }
      }
    },
  );

  it("names final and earlier rounds for 2p and 4p brackets", () => {
    expect(getTournamentRoundName(6, 6, "2p")).toBe("Final");
    expect(getTournamentRoundName(5, 6, "2p")).toBe("Semi Final");
    expect(getTournamentRoundName(4, 6, "2p")).toBe("Quarter Final");
    expect(getTournamentRoundName(5, 5, "4p")).toBe("Final Board");
    expect(getTournamentRoundName(4, 5, "4p")).toBe("Semi Final Board");
    expect(getTournamentRoundName(3, 5, "4p")).toBe("Quarter Final Board");
  });
});
