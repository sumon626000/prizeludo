import { ArrowLeft } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { apiRequest } from "../lib/api";
import { socket } from "../lib/socket";

type BridgeMessage = {
  source?: string;
  type?: string;
  requestId?: string;
  payload?: Record<string, unknown>;
};

type TradeJitoPublicSettings = {
  enabled: boolean;
  minStake: number;
  maxStake: number;
  defaultStake: number;
  winMultiplier: number;
};

function readWalletBalance(user: {
  mainBalance?: string | number;
  winnerBalance?: string | number;
} | null) {
  return Number(user?.mainBalance ?? 0) + Number(user?.winnerBalance ?? 0);
}

function formatWalletBalance(value: number) {
  return value.toLocaleString("en-BD", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function FxCasinoPage() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const { loading, user, refresh } = useAuth();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [gameSettings, setGameSettings] = useState<TradeJitoPublicSettings | null>(
    null,
  );
  const bn = i18n.language === "bn";
  const balance = readWalletBalance(user);

  const pushBalanceToGame = useCallback((nextBalance: number) => {
    iframeRef.current?.contentWindow?.postMessage(
      {
        source: "trade-jito-host",
        type: "balance",
        balance: String(nextBalance),
      },
      window.location.origin,
    );
  }, []);

  const pushSettingsToGame = useCallback((settings: TradeJitoPublicSettings) => {
    iframeRef.current?.contentWindow?.postMessage(
      {
        source: "trade-jito-host",
        type: "settings",
        settings,
      },
      window.location.origin,
    );
  }, []);

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
    void apiRequest<{ settings: TradeJitoPublicSettings }>("/api/trade-jito/settings")
      .then((result) => {
        setGameSettings(result.settings);
        pushSettingsToGame(result.settings);
      })
      .catch(() => {
        setGameSettings({
          enabled: true,
          minStake: 10,
          maxStake: 10_000,
          defaultStake: 10,
          winMultiplier: 2,
        });
      });
  }, [pushSettingsToGame]);

  useEffect(() => {
    pushBalanceToGame(balance);
  }, [balance, pushBalanceToGame]);

  useEffect(() => {
    const onWalletUpdate = () => {
      void refresh().catch(() => undefined);
    };
    const onTradeSettings = (settings: TradeJitoPublicSettings) => {
      setGameSettings(settings);
      pushSettingsToGame(settings);
    };
    socket.on("wallet:update", onWalletUpdate);
    socket.on("balance:update", onWalletUpdate);
    socket.on("trade-jito:settings", onTradeSettings);
    return () => {
      socket.off("wallet:update", onWalletUpdate);
      socket.off("balance:update", onWalletUpdate);
      socket.off("trade-jito:settings", onTradeSettings);
    };
  }, [pushSettingsToGame, refresh]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<BridgeMessage>) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.source !== "trade-jito" || !data.requestId || !data.type) {
        return;
      }

      void (async () => {
        try {
          if (data.type === "trade-jito:settings") {
            const result = await apiRequest<{ settings: TradeJitoPublicSettings }>(
              "/api/trade-jito/settings",
            );
            setGameSettings(result.settings);
            pushSettingsToGame(result.settings);
            reply(data.requestId!, { ok: true, settings: result.settings });
            return;
          }

          if (data.type === "trade-jito:balance") {
            const result = await apiRequest<{ balance: string }>(
              "/api/trade-jito/balance",
            );
            const nextBalance = Number(result.balance);
            pushBalanceToGame(nextBalance);
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
            pushBalanceToGame(Number(result.balance));
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
            pushBalanceToGame(Number(result.balance));
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
  }, [pushBalanceToGame, pushSettingsToGame, refresh, reply]);

  const handleIframeLoad = () => {
    void (async () => {
      try {
        const [settingsResult, balanceResult] = await Promise.all([
          apiRequest<{ settings: TradeJitoPublicSettings }>("/api/trade-jito/settings"),
          apiRequest<{ balance: string }>("/api/trade-jito/balance"),
        ]);
        setGameSettings(settingsResult.settings);
        pushSettingsToGame(settingsResult.settings);
        pushBalanceToGame(Number(balanceResult.balance));
        await refresh();
      } catch {
        if (gameSettings) pushSettingsToGame(gameSettings);
        pushBalanceToGame(balance);
      }
    })();
  };

  if (!loading && !user) {
    return <Navigate to="/" replace />;
  }

  if (gameSettings && !gameSettings.enabled) {
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
            {formatWalletBalance(balance)}
          </small>
        </div>
      </header>
      <iframe
        ref={iframeRef}
        className="fx-casino-page__frame"
        src="/games/fx-casino/index.html?embedded=prizejito&autostart=1"
        title="Trade Jito"
        allow="autoplay"
        onLoad={handleIframeLoad}
      />
    </main>
  );
}
