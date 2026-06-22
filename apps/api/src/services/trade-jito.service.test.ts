import { describe, expect, it, vi } from "vitest";
import { resolveTradeOutcome } from "./trade-jito.service.js";

describe("trade jito service", () => {
  it("favors trend-aligned trades", () => {
    const random = vi.spyOn(Math, "random");
    random.mockReturnValue(0.1);
    expect(resolveTradeOutcome("BUY", "UPTREND")).toBe("WIN");
    expect(resolveTradeOutcome("SELL", "DOWNTREND")).toBe("WIN");
    random.mockRestore();
  });
});
