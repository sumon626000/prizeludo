import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

export function FxCasinoPage() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const bn = i18n.language === "bn";

  return (
    <main className="fx-casino-page">
      <header className="fx-casino-page__bar glass">
        <button
          type="button"
          className="fx-casino-page__back"
          onClick={() => navigate("/")}
          aria-label={bn ? "হোমে ফিরুন" : "Back to home"}
        >
          <ArrowLeft size={18} />
        </button>
        <span className="fx-casino-page__title">FX Casino</span>
      </header>
      <iframe
        className="fx-casino-page__frame"
        src="/games/fx-casino/index.html"
        title="FX Casino Trading Simulator"
        allow="autoplay"
      />
    </main>
  );
}
