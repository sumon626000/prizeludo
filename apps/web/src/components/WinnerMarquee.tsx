import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { HomeWinner } from "../types";

export function WinnerMarquee({
  winners,
  speedSeconds,
}: {
  winners: HomeWinner[];
  speedSeconds: number;
}) {
  const { t } = useTranslation();
  if (winners.length === 0) {
    return (
      <div className="winner-marquee glass">
        <Sparkles size={13} />
        <span>{t("waitingForWinners")}</span>
      </div>
    );
  }

  const items = [...winners, ...winners];
  return (
    <div className="winner-marquee glass">
      <Sparkles size={13} />
      <div className="winner-marquee__viewport">
        <div
          className="winner-marquee__track"
          style={{ "--marquee-speed": `${speedSeconds}s` } as React.CSSProperties}
        >
          {items.map((winner, index) => (
            <span key={`${winner.id}-${index}`}>
              <strong>{winner.name}</strong> ৳{Number(winner.amount).toLocaleString()}
              {winner.isPromotional && <small>{t("promo")}</small>}
              <i>•</i>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
