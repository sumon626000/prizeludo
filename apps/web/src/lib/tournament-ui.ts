import type { TournamentSummary } from "../types";

const MIXED_AUTO_TEMPLATE_KEY = "mixed-auto-16p-4p";

export function isMixedAutoLobby(
  tournament: Pick<
    TournamentSummary,
    "recurringTemplateKey" | "playerType"
  >,
) {
  return (
    tournament.recurringTemplateKey === MIXED_AUTO_TEMPLATE_KEY &&
    tournament.playerType === "mixed"
  );
}

export function isTournamentCountdownLocked(
  tournament: Pick<TournamentSummary, "countdownEndsAt">,
) {
  return Boolean(tournament.countdownEndsAt);
}

export function canLeaveTournament(
  tournament: Pick<
    TournamentSummary,
    "status" | "countdownEndsAt" | "isShowcase"
  >,
) {
  return (
    tournament.status === "waiting" &&
    !tournament.isShowcase &&
    !isTournamentCountdownLocked(tournament)
  );
}

export function isJoinedTournament(
  tournament: Pick<TournamentSummary, "currentEntryStatus" | "isCurrent">,
) {
  return (
    tournament.isCurrent === true ||
    tournament.currentEntryStatus === "joined"
  );
}

export function sortTournamentsForUser(tournaments: TournamentSummary[]) {
  const joined = tournaments.filter(isJoinedTournament);
  const others = tournaments.filter((item) => !isJoinedTournament(item));
  return [...joined, ...others];
}

export function canLeaveGame(
  tournament: Pick<TournamentSummary, "status" | "countdownEndsAt">,
  matchStatus: "waiting" | "active" | "completed" | "cancelled",
) {
  if (
    tournament.status === "waiting" &&
    isTournamentCountdownLocked(tournament)
  ) {
    return false;
  }
  if (
    tournament.status === "active" &&
    matchStatus !== "completed" &&
    matchStatus !== "cancelled"
  ) {
    return false;
  }
  return true;
}

export function formatBracketRoundLabel(
  round: number,
  totalRounds: number,
  language: string,
): string {
  const bn = language === "bn";
  if (round === totalRounds) return bn ? "ফাইনাল" : "Final";
  if (round === totalRounds - 1 && totalRounds > 2) {
    return bn ? "সেমি" : "Semi";
  }
  if (round === totalRounds - 2 && totalRounds > 3) {
    return bn ? "কোয়ার্টার" : "Quarter";
  }
  return bn ? `রাউন্ড ${round}` : `Round ${round}`;
}
