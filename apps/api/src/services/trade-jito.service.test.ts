import { describe, expect, it, vi } from "vitest";
import {
  calculateWinPayoutCents,
  resolveTradeOutcome,
} from "./trade-jito.service.js";

const baseSettings = {
  winBiasTrend: 70,
  winBiasCounterTrend: 30,
  winBiasNeutral: 52,
  winMultiplier: 2,
  winCommissionPercent: 0,
};

describe("trade jito service", () => {
  it("favors trend-aligned trades", () => {
    const random = vi.spyOn(Math, "random");
    random.mockReturnValue(0.1);
    expect(resolveTradeOutcome("BUY", "UPTREND", baseSettings)).toBe("WIN");
    expect(resolveTradeOutcome("SELL", "DOWNTREND", baseSettings)).toBe("WIN");
    random.mockRestore();
  });

  it("applies commission only on profit", () => {
    expect(
      calculateWinPayoutCents(10_00, {
        winMultiplier: 2,
        winCommissionPercent: 10,
      }),
    ).toBe(19_00);
  });
});
