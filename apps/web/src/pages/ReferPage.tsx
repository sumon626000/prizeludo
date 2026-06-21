import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Copy,
  Gift,
  Share2,
  Sparkles,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { apiRequest } from "../lib/api";
import type { ReferralSnapshot } from "../types";

function money(value: string | number): string {
  return `৳${Number(value).toLocaleString()}`;
}

export function ReferPage() {
  const { i18n, t } = useTranslation();
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<ReferralSnapshot | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const inviteLink = useMemo(
    () =>
      user
        ? `${window.location.origin}/?ref=${encodeURIComponent(user.referCode)}`
        : "",
    [user],
  );

  useEffect(() => {
    if (!user) return;
    apiRequest<ReferralSnapshot>("/api/profile/history/refer")
      .then((result) => {
        setSnapshot(result);
        setError("");
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "Referral failed."),
      );
  }, [user]);

  if (!user) return <Navigate to="/" replace />;

  const copyLink = async () => {
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  };

  const copyCode = async () => {
    await navigator.clipboard.writeText(user.referCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  };

  const shareLink = async () => {
    if (navigator.share) {
      await navigator.share({
        title: "PrizeJito.com",
        text: t("referralShareText"),
        url: inviteLink,
      });
      return;
    }
    await copyLink();
  };

  const totalDeposits =
    snapshot?.items.reduce(
      (total, item) => total + Number(item.depositAmount),
      0,
    ) ?? 0;

  return (
    <main className="page refer-page refer-page--premium">
      <section className="refer-hero glass">
        <div className="refer-code-row">
          <span className="refer-hero__spark">
            <Sparkles size={16} />
          </span>
          <div className="refer-code-row__body">
            <small>{t("yourReferralCode")}</small>
            <strong className="refer-code-row__code">{user.referCode}</strong>
          </div>
          <button
            type="button"
            className="refer-code-row__copy"
            onClick={() => void copyCode()}
            aria-label={t("copyLink")}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
        </div>
        <p className="refer-hero__intro">{t("referralIntro")}</p>
        <div className="refer-link">
          <span>{inviteLink}</span>
          <button
            type="button"
            onClick={() => void copyLink()}
            aria-label={t("copyLink")}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
        </div>
        <button
          className="primary-button refer-share"
          type="button"
          onClick={() => void shareLink()}
        >
          <Share2 size={15} /> {t("shareInvite")}
        </button>
      </section>

      <section className="refer-metrics">
        <article className="glass">
          <UsersRound size={16} />
          <span>{t("totalRefers")}</span>
          <strong>{snapshot?.totalReferCount ?? 0}</strong>
        </article>
        <article className="glass">
          <WalletCards size={16} />
          <span>{t("referredDeposits")}</span>
          <strong>{money(totalDeposits)}</strong>
        </article>
        <article className="glass">
          <Gift size={16} />
          <span>{t("allTimeCommission")}</span>
          <strong>{money(snapshot?.totalReferIncome ?? 0)}</strong>
        </article>
      </section>

      <section className="refer-history glass">
        <header>
          <div>
            <small>{t("referralNetwork")}</small>
            <h2>{t("referredPlayers")}</h2>
          </div>
          <span>{snapshot?.items.length ?? 0}</span>
        </header>
        {error && <p className="form-error">{error}</p>}
        {!snapshot && !error && <p className="empty-state">{t("working")}</p>}
        {snapshot?.items.map((item) => (
          <article className="refer-player" key={item.id}>
            <span className="refer-player__avatar">
              {item.name.slice(0, 1).toUpperCase()}
            </span>
            <div className="refer-player__identity">
              <strong>{item.name}</strong>
              <small>
                ID {item.gameId} ·{" "}
                {new Intl.DateTimeFormat(
                  i18n.language === "bn" ? "bn-BD" : "en-US",
                  { dateStyle: "medium" },
                ).format(new Date(item.joinedAt))}
              </small>
            </div>
            <div className="refer-player__money">
              <span>{money(item.depositAmount)}</span>
              <strong>+{money(item.commissionEarned)}</strong>
            </div>
          </article>
        ))}
        {snapshot?.items.length === 0 && (
          <p className="empty-state">{t("noReferralsYet")}</p>
        )}
      </section>
    </main>
  );
}
