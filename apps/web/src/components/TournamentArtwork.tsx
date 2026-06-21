import { tournamentArtworkUrl } from "../lib/tournament-artwork";

export function TournamentArtwork({
  tournamentId,
  title,
  logoUrl,
}: {
  tournamentId: string;
  title: string;
  logoUrl: string;
}) {
  return (
    <div className="tournament-artwork">
      <img
        className="tournament-artwork__scene"
        src={tournamentArtworkUrl(tournamentId)}
        alt={`${title} tournament artwork`}
        loading="lazy"
        decoding="async"
      />
      <span className="tournament-artwork__shade" />
      <span className="tournament-artwork__brand" aria-hidden="true">
        <img src={logoUrl || "/prizejito-logo.png"} alt="" />
        <strong>PRIZEJITO</strong>
      </span>
    </div>
  );
}
