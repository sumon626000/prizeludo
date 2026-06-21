export const TOURNAMENT_ARTWORK_COUNT = 100;

export function tournamentArtworkIndex(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % TOURNAMENT_ARTWORK_COUNT + 1;
}

export function tournamentArtworkUrl(seed: string) {
  const index = String(tournamentArtworkIndex(seed)).padStart(3, "0");
  return `/tournament-artworks/tournament-${index}.svg`;
}
