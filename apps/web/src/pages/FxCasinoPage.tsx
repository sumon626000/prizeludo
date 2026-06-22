import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { apiRequest } from "../lib/api";

type BridgeMessage = {
  source?: string;
  type?: string;
  requestId?: string;
  payload?: Record<string, unknown>;
};

export function FxCasinoPage() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const { loading, user, refresh } = useAuth();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bn = i18n.language === "bn";
  const balance =
    Number(user?.mainBalance ?? 0) + Number(user?.winnerBalance ?? 0);

  const reply = useCallback(
    (requestId: string, body: Record<string, unknown>) => {
      iframeRef.current?.contentWindow?.postMessage(
        { requestId, ...body },
        window.location.origin,
      );
    },
    [],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent<BridgeMessage>) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.source !== "trade-jito" || !data.requestId || !data.type) {
        return;
      }

      void (async () => {
        try {
          if (data.type === "trade-jito:balance") {
            const result = await apiRequest<{ balance: string }>(
              "/api/trade-jito/balance",
            );
            reply(data.requestId!, { ok: true, balance: result.balance });
            return;
          }

          if (data.type === "trade-jito:open") {
            const result = await apiRequest<{
              tradeId: string;
              outcome: "WIN" | "LOSS";
              balance: string;
            }>("/api/trade-jito/open", {
              method: "POST",
              body: JSON.stringify(data.payload ?? {}),
            });
            await refresh();
            reply(data.requestId!, { ok: true, ...result });
            return;
          }

          if (data.type === "trade-jito:settle") {
            const result = await apiRequest<{
              outcome: "WIN" | "LOSS";
              payout: string;
              balance: string;
            }>("/api/trade-jito/settle", {
              method: "POST",
              body: JSON.stringify(data.payload ?? {}),
            });
            await refresh();
            reply(data.requestId!, { ok: true, ...result });
            return;
          }

          reply(data.requestId!, {
            ok: false,
            message: "Unknown trade bridge request.",
          });
        } catch (error) {
          reply(data.requestId!, {
            ok: false,
            message:
              error instanceof Error ? error.message : "Trade request failed.",
          });
        }
      })();
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [refresh, reply]);

  if (!loading && !user) {
    return <Navigate to="/" replace />;
  }

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
        <div className="fx-casino-page__meta">
          <strong>Trade Jito</strong>
          <small>
            {bn ? "লাইভ ব্যালেন্স" : "Live balance"}: ৳
            {balance.toLocaleString("en-BD", {
              minimumFractionDigits: 0,
              maximumFractionDigits: 2,
            })}
          </small>
        </div>
      </header>
      <iframe
        ref={iframeRef}
        className="fx-casino-page__frame"
        src="/games/fx-casino/index.html?embedded=prizejito&autostart=1"
        title="Trade Jito"
        allow="autoplay"
      />
    </main>
  );
}
