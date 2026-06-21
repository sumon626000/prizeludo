import {
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Eye,
  Gift,
  Save,
  Settings2,
  ShieldCheck,
  Trash2,
  WalletCards,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiBlob, apiRequest } from "../lib/api";
import {
  PaymentGatewaySettings,
  type PaymentGatewaySettingsValue,
} from "./PaymentGatewaySettings";

type AdminSection = "queue" | "settings" | "offers";
type QueueType = "deposit" | "withdraw";

interface QueueUser {
  id?: string;
  gameId: string;
  name: string;
  phone?: string | null;
}

interface TransactionQueueItem {
  transaction: {
    id: string;
    type: "deposit" | "withdraw";
    amount: string;
    bonusAmount: string;
    status: "pending" | "approved";
    method: string | null;
    relatedDocumentId: string | null;
    createdAt: string;
    metadata?: { accountLastFour?: string | null };
  };
  user: QueueUser;
}

interface AdminSettings extends PaymentGatewaySettingsValue {
  depositMin: number;
  depositMax: number;
  withdrawMin: number;
  transferMin: number;
  transferCommissionPercent: number;
  referralCommissionPercent: number;
}

interface AdminOffer {
  id: string;
  amount: string;
  bonusPercent: string;
  isActive: boolean;
  sortOrder: number;
}

export function WalletAdminPanel({
  onChanged,
}: {
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [section, setSection] = useState<AdminSection>("queue");
  const [queueType, setQueueType] = useState<QueueType>("deposit");
  const [queue, setQueue] = useState<TransactionQueueItem[]>([]);
  const [queuePage, setQueuePage] = useState(0);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [ziniApiKey, setZiniApiKey] = useState("");
  const [offers, setOffers] = useState<AdminOffer[]>([]);
  const [selectedOffer, setSelectedOffer] = useState<AdminOffer | null>(null);
  const [offerForm, setOfferForm] = useState({
    amount: "",
    bonusPercent: "",
    isActive: true,
    sortOrder: 0,
  });
  const [previewUrl, setPreviewUrl] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadQueue = useCallback(async () => {
    const result = await apiRequest<{ items: TransactionQueueItem[] }>(
      `/api/wallet/admin/queue/${queueType}`,
    );
    setQueue(result.items);
    setQueuePage(0);
  }, [queueType]);

  const loadSettings = useCallback(async () => {
    const result = await apiRequest<{ settings: AdminSettings }>(
      "/api/wallet/admin/settings",
    );
    setSettings(result.settings);
  }, []);

  const loadOffers = useCallback(async () => {
    const result = await apiRequest<{ offers: AdminOffer[] }>(
      "/api/wallet/admin/offers",
    );
    setOffers(result.offers);
  }, []);

  useEffect(() => {
    if (section === "queue") void loadQueue();
    if (section === "settings") void loadSettings();
    if (section === "offers") void loadOffers();
  }, [loadOffers, loadQueue, loadSettings, section]);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  };

  const showDocument = (documentId: string) => {
    void run(async () => {
      const blob = await apiBlob(`/api/wallet/documents/${documentId}`);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));
    });
  };

  const review = (
    item: TransactionQueueItem,
    action: "approve" | "reject" | "paid",
  ) => {
    const reason =
      action === "reject"
        ? window.prompt(t("rejectionReason"))?.trim()
        : undefined;
    if (action === "reject" && !reason) return;
    void run(async () => {
      if (item.transaction.type === "deposit") {
        await apiRequest(
          `/api/wallet/admin/deposits/${item.transaction.id}/review`,
          {
            method: "POST",
            body: JSON.stringify({
              approve: action === "approve",
              ...(reason ? { reason } : {}),
            }),
          },
        );
      } else {
        await apiRequest(
          `/api/wallet/admin/withdrawals/${item.transaction.id}/review`,
          {
            method: "POST",
            body: JSON.stringify({
              status:
                action === "approve" || action === "paid"
                  ? "paid"
                  : "rejected",
              ...(reason ? { reason } : {}),
            }),
          },
        );
      }
      await Promise.all([loadQueue(), onChanged()]);
      setMessage(t("adminActionSaved"));
    });
  };

  const showDetails = (item: TransactionQueueItem) => {
    void run(async () => {
      if (item.transaction.type === "withdraw") {
        const result = await apiRequest<{
          withdrawal: {
            method: string | null;
            metadata: { accountNumber: string | null };
          };
        }>(`/api/wallet/admin/withdrawals/${item.transaction.id}`);
        setDetail(
          `${result.withdrawal.method ?? ""} · ${result.withdrawal.metadata.accountNumber ?? ""}`,
        );
      } else if (item.transaction.relatedDocumentId) {
        setDetail(`${item.transaction.method ?? ""} · ৳${item.transaction.amount}`);
        showDocument(item.transaction.relatedDocumentId);
      }
    });
  };

  const saveSettings = () => {
    if (!settings) return;
    void run(async () => {
      const result = await apiRequest<{ settings: AdminSettings }>(
        "/api/wallet/admin/settings",
        {
          method: "PATCH",
          body: JSON.stringify({
            depositMin: settings.depositMin,
            depositMax: settings.depositMax,
            withdrawMin: settings.withdrawMin,
            transferMin: settings.transferMin,
            transferCommissionPercent:
              settings.transferCommissionPercent,
            referralCommissionPercent: settings.referralCommissionPercent,
            uddoktaPayEnabled: settings.uddoktaPayEnabled,
            uddoktaPayBaseUrl: settings.uddoktaPayBaseUrl,
            ...(apiKey ? { uddoktaPayApiKey: apiKey } : {}),
            ziniPayEnabled: settings.ziniPayEnabled,
            ziniPayBaseUrl: settings.ziniPayBaseUrl,
            ...(ziniApiKey ? { ziniPayApiKey: ziniApiKey } : {}),
            manualDepositEnabled: settings.manualDepositEnabled,
            manualMethods: settings.manualMethods,
            withdrawMethods: settings.withdrawMethods,
          }),
        },
      );
      setSettings(result.settings);
      setApiKey("");
      setZiniApiKey("");
      await onChanged();
      setMessage(t("settingsSaved"));
    });
  };

  const selectOffer = (offer: AdminOffer | null) => {
    setSelectedOffer(offer);
    setOfferForm(
      offer
        ? {
            amount: offer.amount,
            bonusPercent: offer.bonusPercent,
            isActive: offer.isActive,
            sortOrder: offer.sortOrder,
          }
        : {
            amount: "",
            bonusPercent: "",
            isActive: true,
            sortOrder: offers.length + 1,
          },
    );
  };

  const saveOffer = () => {
    void run(async () => {
      await apiRequest(
        selectedOffer
          ? `/api/wallet/admin/offers/${selectedOffer.id}`
          : "/api/wallet/admin/offers",
        {
          method: selectedOffer ? "PATCH" : "POST",
          body: JSON.stringify({
            amount: offerForm.amount,
            bonusPercent: Number(offerForm.bonusPercent),
            isActive: offerForm.isActive,
            sortOrder: offerForm.sortOrder,
          }),
        },
      );
      await Promise.all([loadOffers(), onChanged()]);
      selectOffer(null);
      setMessage(t("offerSaved"));
    });
  };

  const removeOffer = () => {
    if (!selectedOffer || !window.confirm(t("deleteOfferConfirm"))) return;
    void run(async () => {
      await apiRequest(`/api/wallet/admin/offers/${selectedOffer.id}`, {
        method: "DELETE",
      });
      await Promise.all([loadOffers(), onChanged()]);
      selectOffer(null);
    });
  };

  const queuePageCount = Math.max(1, Math.ceil(queue.length / 3));
  const visibleQueue = useMemo(
    () => queue.slice(queuePage * 3, queuePage * 3 + 3),
    [queue, queuePage],
  );

  return (
    <section className="wallet-panel wallet-admin-panel">
      <nav className="wallet-admin-tabs">
        {([
          ["queue", WalletCards],
          ["settings", Settings2],
          ["offers", Gift],
        ] as const).map(([id, Icon]) => (
          <button
            className={section === id ? "active" : ""}
            key={id}
            onClick={() => setSection(id)}
          >
            <Icon size={14} /> {t(id)}
          </button>
        ))}
      </nav>

      {section === "queue" && (
        <>
          <div className="wallet-admin-queue-types">
            {(["deposit", "withdraw"] as const).map((type) => (
              <button
                className={queueType === type ? "active" : ""}
                key={type}
                onClick={() => setQueueType(type)}
              >
                {t(type)}
              </button>
            ))}
          </div>
          <div className="wallet-admin-list">
            {visibleQueue.map((item) => {
              const id = item.transaction.id;
              const status = item.transaction.status;
              const amount = item.transaction.amount;
              return (
                <article className="wallet-admin-item" key={id}>
                  <span>
                    <strong>{item.user.name}</strong>
                    <small>
                      ID {item.user.gameId}
                      {item.transaction.method
                        ? ` · ${item.transaction.method}`
                        : ""}
                      {item.transaction.metadata?.accountLastFour
                        ? ` · ****${item.transaction.metadata.accountLastFour}`
                        : ""}
                    </small>
                    <strong className="wallet-admin-item__amount">
                      ৳{Number(amount || 0).toLocaleString("en-BD")}
                    </strong>
                  </span>
                  <button onClick={() => showDetails(item)}>
                    <Eye size={13} />
                  </button>
                  <div>
                    {status === "pending" && (
                      <button onClick={() => review(item, "approve")}>
                        <BadgeCheck size={12} />{" "}
                        {item.transaction.type === "withdraw"
                          ? t("markPaid")
                          : t("approve")}
                      </button>
                    )}
                    <button onClick={() => review(item, "reject")}>
                      <X size={12} /> {t("reject")}
                    </button>
                  </div>
                </article>
              );
            })}
            {visibleQueue.length === 0 && (
              <div className="wallet-empty">{t("queueEmpty")}</div>
            )}
          </div>
          <div className="wallet-pagination">
            <button
              disabled={queuePage === 0}
              onClick={() => setQueuePage((page) => page - 1)}
            >
              <ChevronLeft size={15} />
            </button>
            <span>{queuePage + 1}/{queuePageCount}</span>
            <button
              disabled={queuePage >= queuePageCount - 1}
              onClick={() => setQueuePage((page) => page + 1)}
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </>
      )}

      {section === "settings" && settings && (
        <div className="wallet-admin-settings">
          <div className="wallet-admin-setting-grid">
            {([
              ["depositMin", "depositMin"],
              ["depositMax", "depositMax"],
              ["withdrawMin", "withdrawMin"],
              ["transferMin", "transferMin"],
              ["transferCommissionPercent", "transferCommission"],
              ["referralCommissionPercent", "referralCommission"],
            ] as const).map(([key, label]) => (
              <label key={key}>
                <span>{t(label)}</span>
                <input
                  type="number"
                  value={settings[key]}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      [key]: Number(event.target.value),
                    })
                  }
                />
              </label>
            ))}
          </div>
          <PaymentGatewaySettings
            value={settings}
            uddoktaApiKey={apiKey}
            ziniApiKey={ziniApiKey}
            onChange={(gatewaySettings) =>
              setSettings({ ...settings, ...gatewaySettings })
            }
            onUddoktaApiKeyChange={setApiKey}
            onZiniApiKeyChange={setZiniApiKey}
          />
          <button
            className="wallet-primary-button"
            disabled={busy}
            onClick={saveSettings}
          >
            <Save size={14} /> {t("saveSettings")}
          </button>
        </div>
      )}

      {section === "offers" && (
        <div className="wallet-admin-offers">
          <div className="wallet-admin-offer-list">
            {offers.map((offer) => (
              <button
                className={selectedOffer?.id === offer.id ? "active" : ""}
                key={offer.id}
                onClick={() => selectOffer(offer)}
              >
                <strong>৳{offer.amount}</strong>
                <span>+{offer.bonusPercent}%</span>
                <small>{offer.isActive ? t("active") : t("inactive")}</small>
              </button>
            ))}
            <button onClick={() => selectOffer(null)}>
              <strong>+</strong>
              <span>{t("newOffer")}</span>
            </button>
          </div>
          <div className="wallet-admin-offer-form">
            <input
              value={offerForm.amount}
              placeholder={t("amount")}
              onChange={(event) =>
                setOfferForm({ ...offerForm, amount: event.target.value })
              }
            />
            <input
              value={offerForm.bonusPercent}
              placeholder={`${t("bonus")} %`}
              onChange={(event) =>
                setOfferForm({
                  ...offerForm,
                  bonusPercent: event.target.value,
                })
              }
            />
            <label>
              <input
                type="checkbox"
                checked={offerForm.isActive}
                onChange={(event) =>
                  setOfferForm({
                    ...offerForm,
                    isActive: event.target.checked,
                  })
                }
              />
              {t("active")}
            </label>
            <button disabled={busy} onClick={saveOffer}>
              <Save size={13} /> {t("save")}
            </button>
            {selectedOffer && (
              <button disabled={busy} onClick={removeOffer}>
                <Trash2 size={13} /> {t("delete")}
              </button>
            )}
          </div>
        </div>
      )}

      {detail && <p className="wallet-admin-detail">{detail}</p>}
      {previewUrl && (
        <div className="wallet-document-preview">
          <button onClick={() => setPreviewUrl("")}><X size={15} /></button>
          <img src={previewUrl} alt="" />
        </div>
      )}
      {(error || message) && (
        <p className={error ? "wallet-toast error" : "wallet-toast"}>
          {error || message}
        </p>
      )}
    </section>
  );
}
