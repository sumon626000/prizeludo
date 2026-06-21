import { useTranslation } from "react-i18next";

export interface PaymentGatewaySettingsValue {
  uddoktaPayEnabled: boolean;
  uddoktaPayBaseUrl: string;
  uddoktaPayApiKeyConfigured: boolean;
  ziniPayEnabled: boolean;
  ziniPayBaseUrl: string;
  ziniPayApiKeyConfigured: boolean;
  manualDepositEnabled: boolean;
  manualMethods: Array<{
    name: string;
    account: string;
    instructions?: string;
  }>;
  withdrawMethods: string[];
}

interface PaymentGatewaySettingsProps {
  value: PaymentGatewaySettingsValue;
  uddoktaApiKey: string;
  ziniApiKey: string;
  onChange: (value: PaymentGatewaySettingsValue) => void;
  onUddoktaApiKeyChange: (value: string) => void;
  onZiniApiKeyChange: (value: string) => void;
}

export function PaymentGatewaySettings({
  value,
  uddoktaApiKey,
  ziniApiKey,
  onChange,
  onUddoktaApiKeyChange,
  onZiniApiKeyChange,
}: PaymentGatewaySettingsProps) {
  const { t } = useTranslation();

  return (
    <div className="payment-gateway-settings">
      <header className="payment-gateway-settings__head">
        <strong>{t("paymentGateways")}</strong>
        <small>{t("paymentGatewaysHint")}</small>
      </header>

      <article className="payment-gateway-card">
        <label className="payment-gateway-card__toggle">
          <input
            type="checkbox"
            checked={value.uddoktaPayEnabled}
            onChange={(event) =>
              onChange({ ...value, uddoktaPayEnabled: event.target.checked })
            }
          />
          <strong>{t("uddoktaPay")}</strong>
        </label>
        <input
          value={value.uddoktaPayBaseUrl}
          onChange={(event) =>
            onChange({ ...value, uddoktaPayBaseUrl: event.target.value })
          }
          placeholder={t("uddoktaBaseUrl")}
        />
        <input
          type="password"
          value={uddoktaApiKey}
          onChange={(event) => onUddoktaApiKeyChange(event.target.value)}
          placeholder={
            value.uddoktaPayApiKeyConfigured
              ? t("apiKeyConfigured")
              : t("uddoktaApiKey")
          }
        />
      </article>

      <article className="payment-gateway-card payment-gateway-card--zini">
        <label className="payment-gateway-card__toggle">
          <input
            type="checkbox"
            checked={value.ziniPayEnabled}
            onChange={(event) =>
              onChange({ ...value, ziniPayEnabled: event.target.checked })
            }
          />
          <strong>{t("ziniPay")}</strong>
          {value.ziniPayApiKeyConfigured && (
            <span className="payment-gateway-card__badge">{t("apiKeyConfigured")}</span>
          )}
        </label>
        <p className="payment-gateway-card__hint">{t("ziniPayAdminHint")}</p>
        <input
          value={value.ziniPayBaseUrl}
          onChange={(event) =>
            onChange({ ...value, ziniPayBaseUrl: event.target.value })
          }
          placeholder={t("ziniPayBaseUrl")}
        />
        <input
          type="password"
          value={ziniApiKey}
          onChange={(event) => onZiniApiKeyChange(event.target.value)}
          placeholder={
            value.ziniPayApiKeyConfigured
              ? t("ziniPayLicenseKeyReplace")
              : t("ziniPayLicenseKey")
          }
          autoComplete="off"
        />
        <small className="payment-gateway-card__urls">
          {t("ziniPayCallbackUrls", {
            returnUrl: "https://prizejito.com/wallet?payment=return",
            webhookUrl: "https://api.prizejito.com/api/wallet/zinipay/webhook",
          })}
        </small>
      </article>

      {false && (
      <article className="payment-gateway-card payment-gateway-card--manual">
        <label className="payment-gateway-card__toggle">
          <input
            type="checkbox"
            checked={value.manualDepositEnabled}
            onChange={(event) =>
              onChange({
                ...value,
                manualDepositEnabled: event.target.checked,
              })
            }
          />
          <strong>{t("manual")}</strong>
        </label>
        <div className="wallet-admin-methods">
          {value.manualMethods.map((method, index) => (
            <div key={`${method.name}-${index}`}>
              <input
                value={method.name}
                placeholder={t("method")}
                onChange={(event) => {
                  const methods = [...value.manualMethods];
                  methods[index] = { ...method, name: event.target.value };
                  onChange({ ...value, manualMethods: methods });
                }}
              />
              <input
                value={method.account}
                placeholder={t("accountNumber")}
                onChange={(event) => {
                  const methods = [...value.manualMethods];
                  methods[index] = {
                    ...method,
                    account: event.target.value,
                  };
                  onChange({ ...value, manualMethods: methods });
                }}
              />
            </div>
          ))}
          {value.manualMethods.length < 8 && (
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...value,
                  manualMethods: [
                    ...value.manualMethods,
                    { name: "", account: "" },
                  ],
                })
              }
            >
              + {t("addMethod")}
            </button>
          )}
        </div>
      </article>
      )}

      <article className="payment-gateway-card payment-gateway-card--manual">
        <strong>{t("withdrawMethods")}</strong>
        <div className="wallet-admin-methods wallet-admin-methods--chips">
          {value.withdrawMethods.map((method, index) => (
            <div key={`${method}-${index}`}>
              <input
                value={method}
                placeholder={t("method")}
                onChange={(event) => {
                  const methods = [...value.withdrawMethods];
                  methods[index] = event.target.value;
                  onChange({ ...value, withdrawMethods: methods });
                }}
              />
              <button
                type="button"
                aria-label={t("delete")}
                onClick={() =>
                  onChange({
                    ...value,
                    withdrawMethods: value.withdrawMethods.filter(
                      (_, itemIndex) => itemIndex !== index,
                    ),
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
          {value.withdrawMethods.length < 12 && (
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...value,
                  withdrawMethods: [...value.withdrawMethods, ""],
                })
              }
            >
              + {t("addMethod")}
            </button>
          )}
        </div>
      </article>
    </div>
  );
}
