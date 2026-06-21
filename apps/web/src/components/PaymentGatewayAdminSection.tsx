import { Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiRequest } from "../lib/api";
import {
  PaymentGatewaySettings,
  type PaymentGatewaySettingsValue,
} from "./PaymentGatewaySettings";

type WalletAdminSettings = PaymentGatewaySettingsValue & {
  depositMin: number;
  depositMax: number;
  withdrawMin: number;
  transferMin: number;
  transferCommissionPercent: number;
  referralCommissionPercent: number;
};

export function PaymentGatewayAdminSection({
  onSaved,
}: {
  onSaved?: () => void;
}) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<PaymentGatewaySettingsValue | null>(
    null,
  );
  const [uddoktaApiKey, setUddoktaApiKey] = useState("");
  const [ziniApiKey, setZiniApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const result = await apiRequest<{ settings: WalletAdminSettings }>(
      "/api/wallet/admin/settings",
    );
    setSettings(result.settings);
  }, []);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const save = () => {
    if (!settings) return;
    setBusy(true);
    setMessage("");
    void apiRequest<{ settings: WalletAdminSettings }>(
      "/api/wallet/admin/settings",
      {
        method: "PATCH",
        body: JSON.stringify({
          uddoktaPayEnabled: settings.uddoktaPayEnabled,
          uddoktaPayBaseUrl: settings.uddoktaPayBaseUrl,
          ...(uddoktaApiKey ? { uddoktaPayApiKey: uddoktaApiKey } : {}),
          ziniPayEnabled: settings.ziniPayEnabled,
          ziniPayBaseUrl: settings.ziniPayBaseUrl,
          ...(ziniApiKey ? { ziniPayApiKey: ziniApiKey } : {}),
          manualDepositEnabled: settings.manualDepositEnabled,
          manualMethods: settings.manualMethods,
          withdrawMethods: settings.withdrawMethods,
        }),
      },
    )
      .then((result) => {
        setSettings(result.settings);
        setUddoktaApiKey("");
        setZiniApiKey("");
        setMessage(t("settingsSaved"));
        void onSaved?.();
      })
      .catch((caught) => {
        setMessage(caught instanceof Error ? caught.message : "Save failed.");
      })
      .finally(() => setBusy(false));
  };

  if (!settings) {
    return null;
  }

  return (
    <article className="admin-panel payment-gateway-admin">
      <header>
        <span>
          <small>{t("ziniPay")}</small>
          <h2>{t("paymentGateways")}</h2>
        </span>
        <button disabled={busy} onClick={save}>
          <Save size={14} /> {t("saveSettings")}
        </button>
      </header>
      <PaymentGatewaySettings
        value={settings}
        uddoktaApiKey={uddoktaApiKey}
        ziniApiKey={ziniApiKey}
        onChange={setSettings}
        onUddoktaApiKeyChange={setUddoktaApiKey}
        onZiniApiKeyChange={setZiniApiKey}
      />
      {message && <p className="admin-inline-message">{message}</p>}
    </article>
  );
}
