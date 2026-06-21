import { describe, expect, it } from "vitest";
import {
  TOURNAMENT_ARTWORK_COUNT,
  tournamentArtworkIndex,
  tournamentArtworkUrl,
} from "./tournament-artwork";

describe("tournament artwork selection", () => {
  it("returns a stable artwork for the same tournament", () => {
    expect(tournamentArtworkIndex("tournament-123")).toBe(
      tournamentArtworkIndex("tournament-123"),
    );
  });

  it("always selects one of the prepared artworks", () => {
    for (let index = 0; index < 500; index += 1) {
      const artwork = tournamentArtworkIndex(`tournament-${index}`);
      expect(artwork).toBeGreaterThanOrEqual(1);
      expect(artwork).toBeLessThanOrEqual(TOURNAMENT_ARTWORK_COUNT);
    }
  });

  it("builds a public SVG asset URL", () => {
    expect(tournamentArtworkUrl("abc")).toMatch(
      /^\/tournament-artworks\/tournament-\d{3}\.svg$/,
    );
  });
});
