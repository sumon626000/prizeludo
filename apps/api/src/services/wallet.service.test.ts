import { describe, expect, it } from "vitest";
import { moneyToCents, normalizeMoneyInput } from "./wallet.service.js";

describe("wallet money helpers", () => {
  it("normalizes Bengali digits and spaced amounts", () => {
    expect(normalizeMoneyInput("৫০০")).toBe("500");
    expect(moneyToCents("৫০০")).toBe(50_000);
    expect(moneyToCents("500.50")).toBe(50_050);
  });

  it("rejects invalid transfer amounts", () => {
    expect(() => moneyToCents("abc")).toThrow(/সঠিক টাকার পরিমাণ দিন/);
    expect(() => moneyToCents("0")).toThrow(/সঠিক টাকার পরিমাণ দিন/);
  });
});
