import { Save, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../lib/api";

export type TradeJitoAdminSettings = {
  enabled: boolean;
  minStake: number;
  maxStake: number;
  defaultStake: number;
  winBiasTrend: number;
  winBiasCounterTrend: number;
  winBiasNeutral: number;
  winMultiplier: number;
  winCommissionPercent: number;
};

export function TradeJitoAdminSection() {
  const [settings, setSettings] = useState<TradeJitoAdminSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const result = await apiRequest<{ settings: TradeJitoAdminSettings }>(
      "/api/trade-jito/admin/settings",
    );
    setSettings(result.settings);
  }, []);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const updateField = <K extends keyof TradeJitoAdminSettings>(
    key: K,
    value: TradeJitoAdminSettings[K],
  ) => {
    setSettings((current) => (current ? { ...current, [key]: value } : current));
  };

  const save = () => {
    if (!settings) return;
    setBusy(true);
    setMessage("");
    setError("");
    void apiRequest<{ settings: TradeJitoAdminSettings }>(
      "/api/trade-jito/admin/settings",
      {
        method: "PATCH",
        body: JSON.stringify(settings),
      },
    )
      .then((result) => {
        setSettings(result.settings);
        setMessage("Trade Jito settings saved.");
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Save failed.");
      })
      .finally(() => setBusy(false));
  };

  if (!settings) {
    return null;
  }

  return (
    <article className="admin-panel">
      <header>
        <h2>
          <TrendingUp size={18} /> Trade Jito control panel
        </h2>
        <p>
          Win rate, commission, stake limits এবং game on/off — Ludo বা অন্য
          feature-এ প্রভাব ফেলবে না।
        </p>
      </header>

      <label className="admin-toggle-row">
        <span>
          <strong>Game enabled</strong>
          <small>Home page ও /games/fx-casino খোলা যাবে কিনা</small>
        </span>
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(event) => updateField("enabled", event.target.checked)}
        />
      </label>

      <div className="admin-settings-grid compact">
        <label>
          <span>Minimum stake (৳)</span>
          <input
            type="number"
            min={1}
            step={1}
            value={settings.minStake}
            onChange={(event) =>
              updateField("minStake", Number(event.target.value))
            }
          />
        </label>
        <label>
          <span>Maximum stake (৳)</span>
          <input
            type="number"
            min={1}
            step={1}
            value={settings.maxStake}
            onChange={(event) =>
              updateField("maxStake", Number(event.target.value))
            }
          />
        </label>
        <label>
          <span>Default stake (৳)</span>
          <input
            type="number"
            min={1}
            step={1}
            value={settings.defaultStake}
            onChange={(event) =>
              updateField("defaultStake", Number(event.target.value))
            }
          />
        </label>
        <label>
          <span>Win payout multiplier</span>
          <input
            type="number"
            min={1}
            max={10}
            step={0.1}
            value={settings.winMultiplier}
            onChange={(event) =>
              updateField("winMultiplier", Number(event.target.value))
            }
          />
          <small>উদাহরণ: 2 = stake-এর 2 গুণ (win-এ)</small>
        </label>
        <label>
          <span>Win commission (%)</span>
          <input
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={settings.winCommissionPercent}
            onChange={(event) =>
              updateField("winCommissionPercent", Number(event.target.value))
            }
          />
          <small>শুধু profit অংশ থেকে কাটা হবে</small>
        </label>
        <label>
          <span>Win % with trend</span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={settings.winBiasTrend}
            onChange={(event) =>
              updateField("winBiasTrend", Number(event.target.value))
            }
          />
          <small>BUY + uptrend / SELL + downtrend</small>
        </label>
        <label>
          <span>Win % against trend</span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={settings.winBiasCounterTrend}
            onChange={(event) =>
              updateField("winBiasCounterTrend", Number(event.target.value))
            }
          />
        </label>
        <label>
          <span>Neutral win %</span>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={settings.winBiasNeutral}
            onChange={(event) =>
              updateField("winBiasNeutral", Number(event.target.value))
            }
          />
        </label>
      </div>

      <div className="admin-inline-actions">
        <button className="primary-button" disabled={busy} onClick={save}>
          <Save size={15} /> Save Trade Jito settings
        </button>
      </div>
      {message ? <p className="admin-success">{message}</p> : null}
      {error ? <p className="admin-error">{error}</p> : null}
    </article>
  );
}
