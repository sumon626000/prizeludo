import { Clock3, Crown, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HomeTournament } from "../types";
import { TournamentArtwork } from "./TournamentArtwork";

function useCountdown(target: string | null, serverTime: string) {
  const offset = useMemo(
    () => new Date(serverTime).getTime() - Date.now(),
    [serverTime],
  );
  const calculate = () =>
    target
      ? Math.max(0, new Date(target).getTime() - (Date.now() + offset))
      : 0;
  const [remaining, setRemaining] = useState(calculate);

  useEffect(() => {
    setRemaining(calculate());
    const timer = setInterval(() => setRemaining(calculate()), 1_000);
    return () => clearInterval(timer);
  }, [offset, target]);

  const totalSeconds = Math.floor(remaining / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function TournamentCard({
  tournament,
  serverTime,
  logoUrl,
  onOpen,
}: {
  tournament: HomeTournament;
  serverTime: string;
  logoUrl: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const countdown = useCountdown(
    tournament.countdownEndsAt ?? tournament.startsAt,
    serverTime,
  );

  return (
    <button className="tournament-card glass" onClick={onOpen}>
      <TournamentArtwork
        tournamentId={tournament.id}
        title={tournament.title}
        logoUrl={logoUrl}
      />
      <span className="tournament-card__badges">
        <i>{t(tournament.gameMode)}</i>
        <i>{t(tournament.type)}</i>
      </span>
      <strong>{tournament.title}</strong>
      <span className="tournament-card__prize">
        <Crown size={13} /> ৳{Number(tournament.prizePool).toLocaleString()}
      </span>
      <span className="tournament-card__meta">
        <small>
          <UsersRound size={11} />
          {tournament.joinedCount}/{tournament.playerCount}
        </small>
        <small>
          <Clock3 size={11} /> {countdown}
        </small>
      </span>
      <span className="tournament-card__fee">
        {t("joinFee")} ৳{Number(tournament.joinFee).toLocaleString()}
      </span>
    </button>
  );
}
