import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  BadgeCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Copy,
  CreditCard,
  Gift,
  History,
  Landmark,
  LoaderCircle,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Swords,
  Trophy,
  Upload,
  WalletCards,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { WalletAdminPanel } from "../components/WalletAdminPanel";
import { apiRequest, apiUpload, API_URL } from "../lib/api";
import { parseMoneyAmount } from "../lib/money";
import { socket } from "../lib/socket";
import type {
  DepositOffer,
  WalletOverview,
  WalletTransaction,
  WalletTransactionType,
} from "../types";

type WalletView =
  | "overview"
  | "deposit"
  | "withdraw"
  | "transfer"
  | "history"
  | "admin";

const walletViews: Array<{
  id: WalletView;
  icon: typeof WalletCards;
}> = [
  { id: "overview", icon: WalletCards },
  { id: "deposit", icon: ArrowDownToLine },
  { id: "withdraw", icon: ArrowUpFromLine },
  { id: "transfer", icon: ArrowLeftRight },
  { id: "history", icon: History },
  { id: "admin", icon: ShieldCheck },
];

function money(value: string | number) {
  return `৳${Number(value).toLocaleString()}`;
}

function limitPlaceholder(min?: string | number, max?: string | number) {
  return `${Math.round(Number(min ?? 0))}-${Math.round(Number(max ?? 0))}`;
}

function isValidWithdrawAccount(value: string) {
  return /^01[0-9]{9}$/.test(value.replace(/\s/g, ""));
}

const withdrawMethodsFallback = ["bKash", "Nagad", "Rocket"];

function shortDate(value: string, language: string) {
  return new Intl.DateTimeFormat(language === "bn" ? "bn-BD" : "en-US", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function transactionSign(transaction: WalletTransaction) {
  if (
    transaction.type === "deposit" ||
    transaction.type === "prize" ||
    transaction.type === "refer" ||
    transaction.type === "bonus" ||
    transaction.type === "tournament_refund" ||
    transaction.direction === "incoming"
  ) {
    return "+";
  }
  return "-";
}

function transactionTone(transaction: WalletTransaction) {
  return transactionSign(transaction) === "+" ? "positive" : "negative";
}

export function WalletPage() {
  const { i18n, t } = useTranslation();
  const bn = i18n.language === "bn";
  const { user, refresh } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<WalletView>(() => {
    const tab = searchParams.get("tab");
    if (tab && walletViews.some((v) => v.id === tab)) return tab as WalletView;
    return "overview";
  });
  const [overview, setOverview] = useState<WalletOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selectedOffer, setSelectedOffer] = useState<DepositOffer | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositMode, setDepositMode] = useState<"auto" | "manual">("auto");
  const [manualMethod, setManualMethod] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [withdrawForm, setWithdrawForm] = useState({
    amount: "",
    method: "",
    accountNumber: "",
  });
  const [depositFieldError, setDepositFieldError] = useState("");
  const [withdrawFieldError, setWithdrawFieldError] = useState("");
  const [transferFieldError, setTransferFieldError] = useState("");
  const [transferForm, setTransferForm] = useState({
    gameId: "",
    amount: "",
  });
  const [receiver, setReceiver] = useState<{
    id: string;
    gameId: string;
    name: string;
    avatar: string;
  } | null>(null);
  const [receiverError, setReceiverError] = useState("");
  const [historyType, setHistoryType] = useState<
    WalletTransactionType | "all"
  >("all");
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const [historyItems, setHistoryItems] = useState<WalletTransaction[]>([]);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  const loadOverview = useCallback(async () => {
    const result = await apiRequest<WalletOverview>("/api/wallet");
    setOverview(result);
    setManualMethod((current) =>
      current || result.methods.manualMethods[0]?.name || "",
    );
  }, []);

  useEffect(() => {
    loadOverview().catch((caught) =>
      setError(caught instanceof Error ? caught.message : "Wallet load failed."),
    );
  }, [loadOverview]);

  useEffect(() => {
    const payment = searchParams.get("payment");
    if (!payment) return;

    if (payment === "return") {
      const invoiceId =
        searchParams.get("invoice_id") ??
        searchParams.get("invoiceId") ??
        searchParams.get("invoice");
      if (invoiceId) {
        const params = new URLSearchParams({ invoice_id: invoiceId });
        window.location.replace(
          `${API_URL}/api/wallet/zinipay/return?${params.toString()}`,
        );
        return;
      }
      setError(t("paymentFailed"));
      setSearchParams({}, { replace: true });
      return;
    }

    setMessage(
      payment === "success"
        ? t("paymentSuccess")
        : payment === "cancelled"
          ? t("paymentCancelled")
          : t("paymentFailed"),
    );
    setSearchParams({}, { replace: true });
    void loadOverview();
    void refresh();
  }, [loadOverview, refresh, searchParams, setSearchParams, t]);

  useEffect(() => {
    if (!overview?.methods.manual) {
      setDepositMode("auto");
    }
  }, [overview?.methods.manual]);

  useEffect(() => {
    const reload = () => {
      void loadOverview();
      setHistoryRefreshKey((current) => current + 1);
    };
    socket.on("wallet:update", reload);
    socket.on("balance:update", reload);
    socket.on("wallet:settings", reload);
    return () => {
      socket.off("wallet:update", reload);
      socket.off("balance:update", reload);
      socket.off("wallet:settings", reload);
    };
  }, [loadOverview]);

  useEffect(() => {
    if (view !== "history") return;
    const query = new URLSearchParams({
      page: String(historyPage),
      pageSize: "3",
    });
    if (historyType !== "all") query.set("type", historyType);
    if (historyFrom) query.set("from", historyFrom);
    if (historyTo) query.set("to", `${historyTo}T23:59:59.999Z`);
    apiRequest<{
      items: WalletTransaction[];
      total: number;
    }>(`/api/wallet/history?${query}`)
      .then((result) => {
        setHistoryItems(result.items);
        setHistoryTotal(result.total);
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "History failed."),
      );
  }, [historyFrom, historyPage, historyRefreshKey, historyTo, historyType, view]);

  useEffect(() => {
    setReceiver(null);
    setReceiverError("");
    if (!transferForm.gameId) return;
    if (!/^\d{5}$/.test(transferForm.gameId)) {
      if (transferForm.gameId.length >= 5) setReceiverError(t("receiverRequired"));
      return;
    }
    const timer = window.setTimeout(() => {
      apiRequest<{
        receiver: {
          id: string;
          gameId: string;
          name: string;
          avatar: string;
        };
      }>(`/api/wallet/transfer/receiver/${transferForm.gameId}`)
        .then((result) => {
          setReceiver(result.receiver);
          setReceiverError("");
        })
        .catch(() => {
          setReceiver(null);
          setReceiverError(t("receiverRequired"));
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [t, transferForm.gameId]);

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

  const chooseOffer = (offer: DepositOffer) => {
    setSelectedOffer(offer);
    setDepositAmount(offer.amount);
  };

  const submitDeposit = (event: FormEvent) => {
    event.preventDefault();
    setDepositFieldError("");
    const amount = Number(depositAmount);
    const depositMin = Number(overview?.limits.depositMin ?? 0);
    const depositMax = Number(overview?.limits.depositMax ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      setDepositFieldError(t("enterValidAmount"));
      return;
    }
    if (amount < depositMin) {
      setDepositFieldError(t("amountTooLow"));
      return;
    }
    if (amount > depositMax) {
      setDepositFieldError(t("amountTooHigh"));
      return;
    }
    if (depositMode === "auto" && !overview?.methods.ziniPay) {
      setDepositFieldError(t("selectPaymentProvider"));
      return;
    }
    void run(async () => {
      if (depositMode === "auto") {
        const result = await apiRequest<{ paymentUrl: string }>(
          "/api/wallet/deposit/auto",
          {
            method: "POST",
            body: JSON.stringify({
              amount: depositAmount,
              provider: "zinipay",
              ...(selectedOffer ? { offerId: selectedOffer.id } : {}),
            }),
          },
        );
        if (!result.paymentUrl) {
          throw new Error(t("paymentRedirectFailed"));
        }
        window.location.href = result.paymentUrl;
        return;
      }
      if (!proofFile || !manualMethod) {
        throw new Error(t("proofAndMethodRequired"));
      }
      const upload = await apiUpload<{ document: { id: string } }>(
        "/api/wallet/documents/manual_deposit_proof",
        proofFile,
      );
      await apiRequest("/api/wallet/deposit/manual", {
        method: "POST",
        body: JSON.stringify({
          amount: depositAmount,
          method: manualMethod,
          documentId: upload.document.id,
          ...(selectedOffer ? { offerId: selectedOffer.id } : {}),
        }),
      });
      await loadOverview();
      setProofFile(null);
      setMessage(t("depositPending"));
      setView("overview");
    });
  };

  const submitWithdrawal = (event: FormEvent) => {
    event.preventDefault();
    setWithdrawFieldError("");
    const amount = Number(withdrawForm.amount);
    const withdrawMin = Number(overview?.limits.withdrawMin ?? 0);
    const winnerBalance = Number(overview?.user.winnerBalance ?? 0);
    if (!withdrawForm.method) {
      setWithdrawFieldError(t("selectPaymentMethod"));
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setWithdrawFieldError(t("enterValidAmount"));
      return;
    }
    if (amount < withdrawMin) {
      setWithdrawFieldError(t("amountTooLow"));
      return;
    }
    if (amount > winnerBalance) {
      setWithdrawFieldError(t("winnerBalanceRequired"));
      return;
    }
    if (!isValidWithdrawAccount(withdrawForm.accountNumber)) {
      setWithdrawFieldError(t("invalidAccountNumber"));
      return;
    }
    void run(async () => {
      await apiRequest("/api/wallet/withdraw", {
        method: "POST",
        body: JSON.stringify(withdrawForm),
      });
      await Promise.all([loadOverview(), refresh()]);
      setWithdrawForm({ amount: "", method: "", accountNumber: "" });
      setMessage(t("withdrawPending"));
      setView("overview");
    });
  };

  const withdrawMethods =
    overview?.methods.withdrawMethods.length
      ? overview.methods.withdrawMethods
      : [...withdrawMethodsFallback];

  const cancelWithdraw = (withdrawalId: string) => {
    if (
      !window.confirm(
        bn
          ? "Withdraw cancel করলে টাকা Winner Balance-এ ফিরে যাবে। নিশ্চিত?"
          : "Cancel this withdrawal and refund your winner balance?",
      )
    ) {
      return;
    }
    void run(async () => {
      await apiRequest(`/api/wallet/withdraw/${withdrawalId}/cancel`, {
        method: "POST",
        body: "{}",
      });
      await Promise.all([loadOverview(), refresh()]);
      setHistoryRefreshKey((current) => current + 1);
      setMessage(t("withdrawCancelled"));
    });
  };

  const transactionStatusLabel = (item: WalletTransaction) => {
    if (
      item.type === "withdraw" &&
      item.status === "rejected" &&
      item.failureReason === "Cancelled by user"
    ) {
      return t("cancelled");
    }
    return t(item.status);
  };

  const commission = useMemo(() => {
    const amount = Number(transferForm.amount) || 0;
    return (
      (amount * (overview?.limits.transferCommissionPercent ?? 0)) /
      100
    );
  }, [overview?.limits.transferCommissionPercent, transferForm.amount]);

  const submitTransfer = (event: FormEvent) => {
    event.preventDefault();
    setTransferFieldError("");
    const amount = parseMoneyAmount(transferForm.amount);
    const transferMin = Number(overview?.limits.transferMin ?? 0);
    const mainBalance = Number(overview?.user.mainBalance ?? 0);
    if (amount === null) {
      setTransferFieldError(t("enterValidAmount"));
      return;
    }
    if (transferMin > 0 && amount < transferMin) {
      setTransferFieldError(t("amountTooLow"));
      return;
    }
    const totalDebit = amount + commission;
    if (totalDebit > mainBalance) {
      setTransferFieldError(t("transferInsufficientBalance"));
      return;
    }
    void run(async () => {
      if (!receiver) throw new Error(t("receiverRequired"));
      await apiRequest("/api/wallet/transfer", {
        method: "POST",
        body: JSON.stringify({
          gameId: transferForm.gameId,
          amount: String(amount),
        }),
      });
      await Promise.all([loadOverview(), refresh()]);
      setTransferForm({ gameId: "", amount: "" });
      setReceiver(null);
      setMessage(t("transferSuccess"));
      setView("overview");
    });
  };

  const historyPageCount = Math.max(1, Math.ceil(historyTotal / 3));
  const depositRange = limitPlaceholder(
    overview?.limits.depositMin,
    overview?.limits.depositMax,
  );
  const withdrawRange = limitPlaceholder(
    overview?.limits.withdrawMin,
    overview?.limits.depositMax,
  );
  const transferMin = Number(overview?.limits.transferMin ?? 0);
  const visibleWalletViews = walletViews.filter(
    (item) => item.id !== "admin" || user?.isAdmin || user?.isSubAdmin,
  );

  return (
    <main className="page wallet-page wallet-page--premium">
      <header className="wallet-page-head">
        <h1>{t("myWallet")}</h1>
      </header>
      <nav
        className={`wallet-tabs glass ${
          visibleWalletViews.length === 6 ? "wallet-tabs-admin" : ""
        }`}
      >
        {visibleWalletViews.map(({ id, icon: Icon }) => (
          <button
            className={view === id ? "active" : ""}
            key={id}
            onClick={() => setView(id)}
          >
            <Icon size={14} />
            <span>{t(id)}</span>
          </button>
        ))}
      </nav>

      {view === "overview" && (
        <section className="wallet-panel wallet-overview glass">
          <div className="wallet-balance-grid">
            <article className="wallet-balance wallet-balance-main glass">
              <span><CircleDollarSign size={16} /> {t("mainBalance")}</span>
              <strong>{money(overview?.user.mainBalance ?? 0)}</strong>
              <small>{t("depositAndTransferBalance")}</small>
            </article>
            <article className="wallet-balance wallet-balance-winner glass">
              <span><Trophy size={16} /> {t("winnerBalance")}</span>
              <strong>{money(overview?.user.winnerBalance ?? 0)}</strong>
              <small>{t("withdrawablePrizeBalance")}</small>
            </article>
          </div>

          <div className="wallet-quick-actions">
            {walletViews.slice(1, 4).map(({ id, icon: Icon }) => (
              <button key={id} onClick={() => setView(id)}>
                <Icon size={18} />
                <span>{t(id)}</span>
              </button>
            ))}
          </div>

          <Link className="referral-code-card wallet-referral-card" to="/refer">
            <span>
              <Gift size={15} />
              <small>{t("yourReferralCode")}</small>
            </span>
            <strong>{overview?.user.referCode ?? user?.referCode}</strong>
            <Copy size={14} />
          </Link>

          <div className="wallet-recent">
            <div className="wallet-section-title">
              <span><Clock3 size={14} /> {t("recentTransactions")}</span>
              <button onClick={() => setView("history")}>{t("viewAll")}</button>
            </div>
            <div className="wallet-transaction-list">
              {(overview?.recentTransactions ?? []).slice(0, 3).map((item) => (
                <article
                  className={`wallet-transaction ${transactionTone(item)}`}
                  key={item.id}
                >
                  <span className={`wallet-transaction-icon ${item.type}`}>
                    {item.type === "deposit" && <ArrowDownToLine size={14} />}
                    {item.type === "withdraw" && <ArrowUpFromLine size={14} />}
                    {item.type === "transfer" && <ArrowLeftRight size={14} />}
                    {item.type === "prize" && <Trophy size={14} />}
                    {(item.type === "refer" || item.type === "bonus") && (
                      <Gift size={14} />
                    )}
                    {(item.type === "tournament_fee" ||
                      item.type === "tournament_refund") && (
                      <Swords size={14} />
                    )}
                  </span>
                  <span>
                    <strong>{t(item.type)}</strong>
                    <small>{shortDate(item.createdAt, i18n.language)}</small>
                  </span>
                  <span className={`wallet-transaction-amount ${transactionTone(item)}`}>
                    <strong>
                      {transactionSign(item)}{money(item.amount)}
                    </strong>
                    <small className={item.status}>{transactionStatusLabel(item)}</small>
                  </span>
                </article>
              ))}
              {(overview?.recentTransactions.length ?? 0) === 0 && (
                <div className="wallet-empty">{t("noTransactions")}</div>
              )}
            </div>
          </div>
        </section>
      )}

      {view === "deposit" && (
        <section className="wallet-panel wallet-deposit glass">
          <div className="wallet-section-title">
            <span><Sparkles size={15} /> {t("bonusOffers")}</span>
            <small>
              {money(overview?.limits.depositMin ?? 0)}-
              {money(overview?.limits.depositMax ?? 0)}
            </small>
          </div>
          <div className="deposit-offer-grid">
            {(overview?.offers ?? []).map((offer) => (
              <button
                className={selectedOffer?.id === offer.id ? "active" : ""}
                key={offer.id}
                onClick={() => chooseOffer(offer)}
              >
                <span>{money(offer.amount)}</span>
                <strong>+{offer.bonusPercent}%</strong>
                <small>{t("get")} {money(offer.totalAmount)}</small>
              </button>
            ))}
          </div>
          <form className="wallet-form" onSubmit={submitDeposit}>
            {overview?.methods.manual && (
              <div className="wallet-mode-switch">
                <button
                  type="button"
                  className={depositMode === "auto" ? "active" : ""}
                  disabled={!overview?.methods.ziniPay}
                  onClick={() => setDepositMode("auto")}
                >
                  <CreditCard size={14} /> ZiniPay
                </button>
                <button
                  type="button"
                  className={depositMode === "manual" ? "active" : ""}
                  onClick={() => setDepositMode("manual")}
                >
                  <Landmark size={14} /> {t("manual")}
                </button>
              </div>
            )}
            <label>
              <span>{t("amount")}</span>
              <input
                inputMode="decimal"
                value={depositAmount}
                placeholder={depositRange}
                onChange={(event) => {
                  setDepositAmount(event.target.value);
                  setSelectedOffer(null);
                  setDepositFieldError("");
                }}
                required
              />
            </label>
            {depositFieldError && (
              <p className="wallet-field-error" role="alert">
                {depositFieldError}
              </p>
            )}
            {depositMode === "manual" && (
              <div className="manual-deposit-fields">
                <div className="wallet-payment-brands">
                  <span className="wallet-payment-brands__label">
                    {t("paymentMethods")}
                  </span>
                  <div className="wallet-payment-brands__grid">
                    {["bKash", "Nagad", "Rocket", "Upay"].map((brand) => (
                      <button
                        type="button"
                        key={brand}
                        className={
                          manualMethod.toLowerCase().includes(brand.toLowerCase())
                            ? "active"
                            : ""
                        }
                        onClick={() => {
                          const match = overview?.methods.manualMethods.find(
                            (method) =>
                              method.name
                                .toLowerCase()
                                .includes(brand.toLowerCase()),
                          );
                          setManualMethod(match?.name ?? brand);
                        }}
                      >
                        {brand}
                      </button>
                    ))}
                  </div>
                </div>
                <select
                  value={manualMethod}
                  onChange={(event) => setManualMethod(event.target.value)}
                  required
                >
                  <option value="">{t("selectMethod")}</option>
                  {overview?.methods.manualMethods.map((method) => (
                    <option key={method.name} value={method.name}>
                      {method.name} - {method.account}
                    </option>
                  ))}
                </select>
                <label className="wallet-file-input">
                  <Upload size={14} />
                  <span>{proofFile?.name || t("paymentScreenshot")}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) =>
                      setProofFile(event.target.files?.[0] ?? null)
                    }
                    required
                  />
                </label>
              </div>
            )}
            <button
              className="wallet-primary-button"
              disabled={
                busy ||
                !depositAmount ||
                (depositMode === "auto" && !overview?.methods.ziniPay) ||
                (depositMode === "manual" &&
                  (!overview?.methods.manualMethods.length || !proofFile))
              }
            >
              {busy ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />}
              {depositMode === "auto" ? t("payNow") : t("submitDeposit")}
            </button>
            {depositMode === "manual" &&
              !overview?.methods.manualMethods.length && (
                <small className="wallet-hint">{t("manualNotConfigured")}</small>
              )}
          </form>
        </section>
      )}

      {view === "withdraw" && (
        <section className="wallet-panel wallet-withdraw glass">
          <form className="wallet-form withdraw-form" onSubmit={submitWithdrawal}>
            <p className="wallet-min-note">
              {t("minimumWithdrawNote", {
                amount: money(overview?.limits.withdrawMin ?? 0),
              })}
            </p>
            <div className="wallet-withdrawable">
              <span>{t("availableToWithdraw")}</span>
              <strong>{money(overview?.user.winnerBalance ?? 0)}</strong>
            </div>
            <label>
              <span>{t("amount")}</span>
              <input
                inputMode="decimal"
                value={withdrawForm.amount}
                placeholder={withdrawRange}
                onChange={(event) => {
                  setWithdrawForm({
                    ...withdrawForm,
                    amount: event.target.value,
                  });
                  setWithdrawFieldError("");
                }}
                required
              />
            </label>
            <div className="wallet-method-checkboxes">
              <span>{t("method")}</span>
              <div>
                {withdrawMethods.map((method) => (
                  <label
                    className={withdrawForm.method === method ? "active" : ""}
                    key={method}
                  >
                    <input
                      type="radio"
                      name="withdrawMethod"
                      value={method}
                      checked={withdrawForm.method === method}
                      onChange={() => {
                        setWithdrawForm({ ...withdrawForm, method });
                        setWithdrawFieldError("");
                      }}
                    />
                    <span>{method}</span>
                  </label>
                ))}
              </div>
            </div>
            <label>
              <span>{t("accountNumber")}</span>
              <input
                inputMode="numeric"
                value={withdrawForm.accountNumber}
                placeholder={t("enterPersonalNumber")}
                onChange={(event) => {
                  setWithdrawForm({
                    ...withdrawForm,
                    accountNumber: event.target.value.replace(/\D/g, ""),
                  });
                  setWithdrawFieldError("");
                }}
                required
              />
            </label>
            {withdrawFieldError && (
              <p className="wallet-field-error" role="alert">
                {withdrawFieldError}
              </p>
            )}
            <button
              className="wallet-primary-button"
              disabled={busy}
            >
              <ArrowUpFromLine size={15} /> {t("requestWithdraw")}
            </button>
          </form>
        </section>
      )}

      {view === "transfer" && (
        <section className="wallet-panel wallet-transfer glass">
          <form className="wallet-form" onSubmit={submitTransfer}>
            <div className="wallet-form-heading">
              <Send size={22} />
              <span>
                <strong>{t("balanceTransfer")}</strong>
                <small>{t("mainBalanceOnly")}</small>
              </span>
            </div>
            <label>
              <span>{t("receiverGameId")}</span>
              <div className="wallet-search-input">
                <Search size={15} />
                <input
                  inputMode="numeric"
                  maxLength={5}
                  value={transferForm.gameId}
                  onChange={(event) =>
                    setTransferForm({
                      ...transferForm,
                      gameId: event.target.value.replace(/\D/g, ""),
                    })
                  }
                  required
                />
              </div>
            </label>
            <div
              className={`wallet-receiver ${receiver ? "found" : ""} ${
                receiverError ? "missing" : ""
              }`}
            >
              {receiver ? (
                <>
                  <img src={receiver.avatar} alt="" />
                  <span>
                    <strong>{receiver.name}</strong>
                    <small>ID {receiver.gameId}</small>
                  </span>
                  <BadgeCheck size={18} />
                </>
              ) : (
                <span>{receiverError || t("enterFiveDigitId")}</span>
              )}
            </div>
            <label>
              <span>{t("amount")}</span>
              <input
                inputMode="decimal"
                value={transferForm.amount}
                onChange={(event) => {
                  setTransferFieldError("");
                  setTransferForm({
                    ...transferForm,
                    amount: event.target.value,
                  });
                }}
                placeholder={
                  transferMin > 0
                    ? t("minimumTransferNote", {
                        amount: money(transferMin),
                      })
                    : t("amount")
                }
                required
              />
              {transferFieldError && (
                <small className="wallet-field-error">{transferFieldError}</small>
              )}
            </label>
            <div className="transfer-summary">
              <span>
                {t("commission")} ({overview?.limits.transferCommissionPercent ?? 0}%)
                <strong>{money(commission)}</strong>
              </span>
              <span>
                {t("totalDeduction")}
                <strong>{money((Number(transferForm.amount) || 0) + commission)}</strong>
              </span>
            </div>
            <button
              className="wallet-primary-button"
              disabled={busy || !receiver || !transferForm.amount}
            >
              <ArrowLeftRight size={15} /> {t("confirmTransfer")}
            </button>
          </form>
        </section>
      )}

      {view === "history" && (
        <section className="wallet-panel wallet-history glass">
          <div className="wallet-history-filters">
            <select
              value={historyType}
              onChange={(event) => {
                setHistoryType(
                  event.target.value as WalletTransactionType | "all",
                );
                setHistoryPage(0);
              }}
            >
              <option value="all">{t("all")}</option>
              <option value="deposit">{t("deposit")}</option>
              <option value="withdraw">{t("withdraw")}</option>
              <option value="transfer">{t("transfer")}</option>
              <option value="prize">{t("prize")}</option>
              <option value="refer">{t("refer")}</option>
              <option value="bonus">{t("bonus")}</option>
              <option value="tournament_fee">{t("tournament_fee")}</option>
              <option value="tournament_refund">{t("tournament_refund")}</option>
            </select>
            <label>
              <CalendarDays size={13} />
              <input
                type="date"
                value={historyFrom}
                onChange={(event) => {
                  setHistoryFrom(event.target.value);
                  setHistoryPage(0);
                }}
              />
            </label>
            <label>
              <CalendarDays size={13} />
              <input
                type="date"
                value={historyTo}
                onChange={(event) => {
                  setHistoryTo(event.target.value);
                  setHistoryPage(0);
                }}
              />
            </label>
          </div>
          <div className="wallet-history-list">
            {historyItems.map((item) => (
              <article
                className={`wallet-history-item ${transactionTone(item)}`}
                key={item.id}
              >
                <span className={`wallet-transaction-icon ${item.type}`}>
                  {item.type === "deposit" && <ArrowDownToLine size={15} />}
                  {item.type === "withdraw" && <ArrowUpFromLine size={15} />}
                  {item.type === "transfer" && <ArrowLeftRight size={15} />}
                  {item.type === "prize" && <Trophy size={15} />}
                  {(item.type === "refer" || item.type === "bonus") && (
                    <Gift size={15} />
                  )}
                  {(item.type === "tournament_fee" ||
                    item.type === "tournament_refund") && (
                    <Swords size={15} />
                  )}
                </span>
                <span>
                  <strong>
                    {t(item.type)}
                    {item.otherParty ? ` · ${item.otherParty.name}` : ""}
                  </strong>
                  <small>
                    {shortDate(item.createdAt, i18n.language)}
                    {item.method ? ` · ${item.method}` : ""}
                  </small>
                </span>
                <span className={`wallet-transaction-amount ${transactionTone(item)}`}>
                  <strong>
                    {transactionSign(item)}{money(item.amount)}
                  </strong>
                  <small className={item.status}>{transactionStatusLabel(item)}</small>
                  {item.type === "withdraw" && item.status === "pending" && (
                    <button
                      type="button"
                      className="wallet-cancel-withdraw"
                      disabled={busy}
                      onClick={() => cancelWithdraw(item.id)}
                    >
                      {t("cancelWithdraw")}
                    </button>
                  )}
                </span>
              </article>
            ))}
            {historyItems.length === 0 && (
              <div className="wallet-empty">{t("noTransactions")}</div>
            )}
          </div>
          <div className="wallet-pagination">
            <button
              disabled={historyPage === 0}
              onClick={() => setHistoryPage((page) => page - 1)}
            >
              <ChevronLeft size={15} />
            </button>
            <span>{historyPage + 1}/{historyPageCount}</span>
            <button
              disabled={historyPage >= historyPageCount - 1}
              onClick={() => setHistoryPage((page) => page + 1)}
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </section>
      )}

      {view === "admin" && (
        <WalletAdminPanel onChanged={loadOverview} />
      )}

      {(error || message) && (
        <p className={error ? "wallet-toast error" : "wallet-toast"}>
          {error || message}
        </p>
      )}
    </main>
  );
}
