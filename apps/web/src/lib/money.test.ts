import { describe, expect, it } from "vitest";
import { parseMoneyAmount } from "./money";

describe("money helpers", () => {
  it("parses plain and Bengali amounts", () => {
    expect(parseMoneyAmount("500")).toBe(500);
    expect(parseMoneyAmount("৫০০")).toBe(500);
    expect(parseMoneyAmount("500.25")).toBe(500.25);
  });

  it("rejects invalid amounts", () => {
    expect(parseMoneyAmount("")).toBeNull();
    expect(parseMoneyAmount("abc")).toBeNull();
    expect(parseMoneyAmount("0")).toBeNull();
  });
});
