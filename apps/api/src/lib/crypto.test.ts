import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  rollFairDice,
} from "./crypto.js";

describe("cryptographic helpers", () => {
  it("produces an unbiased six-sided dice distribution", () => {
    const sampleSize = 120_000;
    const expected = sampleSize / 6;
    const counts = Array.from({ length: 6 }, () => 0);

    for (let index = 0; index < sampleSize; index += 1) {
      const value = rollFairDice();
      counts[value - 1] = (counts[value - 1] ?? 0) + 1;
    }

    const chiSquared = counts.reduce(
      (total, count) => total + (count - expected) ** 2 / expected,
      0,
    );

    expect(counts.every((count) => count > 0)).toBe(true);
    expect(chiSquared).toBeLessThan(30);
  });

  it("encrypts sensitive wallet values with authenticated encryption", () => {
    const encrypted = encryptSecret("1234567890123");

    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toContain("1234567890123");
    expect(decryptSecret(encrypted)).toBe("1234567890123");
  });
});
