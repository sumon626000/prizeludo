import { describe, expect, it } from "vitest";
import {
  canLeaveGame,
  canLeaveTournament,
  sortTournamentsForUser,
} from "./tournament-ui";
import type { TournamentSummary } from "../types";

function tournament(
  overrides: Partial<TournamentSummary> = {},
): TournamentSummary {
  return {
    id: "t1",
    title: "Test",
    playerCount: 4,
    boardType: "4p",
    gameMode: "classic",
    type: "paid",
    joinFee: "50",
    prizePool: "500",
    adminCommission: "10",
    prizeFirst: "70",
    prizeSecond: "30",
    playerType: "real",
    isShowcase: false,
    status: "waiting",
    countdownDuration: 60,
    countdownEndsAt: null,
    startsAt: null,
    currentRound: 0,
    totalRounds: 2,
    betweenRoundSeconds: 60,
    nextRoundAt: null,
    completedAt: null,
    collectedFees: "0",
    adminRevenue: "0",
    ...overrides,
  };
}

describe("tournament UI helpers", () => {
  it("blocks tournament leave once countdown starts", () => {
    expect(canLeaveTournament(tournament())).toBe(true);
    expect(
      canLeaveTournament(
        tournament({ countdownEndsAt: new Date().toISOString() }),
      ),
    ).toBe(false);
  });

  it("blocks game leave during countdown and active matches", () => {
    expect(canLeaveGame(tournament(), "waiting")).toBe(true);
    expect(
      canLeaveGame(
        tournament({ countdownEndsAt: new Date().toISOString() }),
        "waiting",
      ),
    ).toBe(false);
    expect(canLeaveGame(tournament({ status: "active" }), "active")).toBe(
      false,
    );
    expect(canLeaveGame(tournament({ status: "active" }), "completed")).toBe(
      true,
    );
  });

  it("sorts joined tournaments first", () => {
    const joined = tournament({
      id: "joined",
      currentEntryStatus: "joined",
      isCurrent: true,
    });
    const other = tournament({ id: "other" });
    expect(sortTournamentsForUser([other, joined]).map((item) => item.id)).toEqual(
      ["joined", "other"],
    );
  });
});
