import {
  Activity,
  Camera,
  ChevronLeft,
  ChevronRight,
  Copy,
  Crown,
  Flame,
  Gamepad2,
  Gift,
  LogOut,
  LifeBuoy,
  Mail,
  MessageCircle,
  Pencil,
  Phone,
  Save,
  Send,
  Share2,
  ShieldCheck,
  Target,
  Trophy,
  UserRound,
  WalletCards,
  X,
  KeyRound,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { apiRequest, apiUpload } from "../lib/api";
import { resolvedAvatar } from "../lib/avatar";
import type {
  HistoryType,
  PlayerStats,
  ProfileOverview,
  ReferralHistoryItem,
  TournamentHistoryItem,
  TransactionHistoryItem,
  TransferHistoryItem,
} from "../types";

type ProfileView = "profile" | "stats" | "activity" | "support";
type HistoryItem =
  | TournamentHistoryItem
  | TransactionHistoryItem
  | ReferralHistoryItem
  | TransferHistoryItem;

interface SupportTicket {
  id: string;
  subject: string;
  message: string;
  status: "open" | "in_progress" | "resolved";
  adminReply: string | null;
  createdAt: string;
  updatedAt: string;
}

const historyTypes: HistoryType[] = [
  "tournament",
  "deposit",
  "withdraw",
  "refer",
  "transfer",
];

function formatDate(value: string, language: string) {
  return new Intl.DateTimeFormat(language === "bn" ? "bn-BD" : "en-US", {
    day: "numeric",
    month: "short",
    year: "2-digit",
  }).format(new Date(value));
}

function money(value: string | number) {
  return `৳${Number(value).toLocaleString()}`;
}

export function ProfilePage() {
  const { i18n, t } = useTranslation();
  const {
    user,
    refresh,
    logout,
    claimAdmin,
    adminClaimAvailable,
  } = useAuth();
  const [view, setView] = useState<ProfileView>("profile");
  const [overview, setOverview] = useState<ProfileOverview | null>(null);
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    avatar: "",
  });
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [historyType, setHistoryType] =
    useState<HistoryType>("tournament");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historySummary, setHistorySummary] = useState<{
    totalReferCount: number;
    totalReferIncome: string;
  } | null>(null);
  const [historyPage, setHistoryPage] = useState(0);

  useEffect(() => {
    if (!user) return;
    Promise.all([
      apiRequest<ProfileOverview>("/api/profile"),
      apiRequest<{ stats: PlayerStats }>("/api/profile/stats"),
    ])
      .then(([profileResult, statsResult]) => {
        setOverview(profileResult);
        setStats(statsResult.stats);
        setForm({
          name: profileResult.user.name,
          email: profileResult.user.email ?? "",
          phone: profileResult.user.phone ?? "",
          avatar: profileResult.user.avatar,
        });
      })
      .catch((caught) =>
        setError(
          caught instanceof Error ? caught.message : "Profile load failed.",
        ),
      );
  }, [user?.id]);

  useEffect(() => {
    if (!user || view !== "activity") return;
    setHistoryPage(0);
    setHistorySummary(null);
    apiRequest<
      | { items: HistoryItem[] }
      | {
          items: ReferralHistoryItem[];
          totalReferCount: number;
          totalReferIncome: string;
        }
    >(`/api/profile/history/${historyType}`)
      .then((result) => {
        setHistory(result.items);
        if ("totalReferCount" in result) {
          setHistorySummary({
            totalReferCount: result.totalReferCount,
            totalReferIncome: result.totalReferIncome,
          });
        }
      })
      .catch((caught) =>
        setError(
          caught instanceof Error ? caught.message : "History load failed.",
        ),
      );
  }, [historyType, user?.id, view]);

  useEffect(() => {
    if (!user || view !== "support") return;
    apiRequest<{ tickets: SupportTicket[] }>("/api/support")
      .then((result) => setTickets(result.tickets))
      .catch((caught) =>
        setError(
          caught instanceof Error ? caught.message : "Support load failed.",
        ),
      );
  }, [user?.id, view]);

  if (!user) return <Navigate to="/" replace />;

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

  const saveProfile = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await apiRequest("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone,
          ...(form.avatar !== overview?.user.avatar
            ? { avatar: form.avatar }
            : {}),
        }),
      });
      await refresh();
      const next = await apiRequest<ProfileOverview>("/api/profile");
      setOverview(next);
      setEditing(false);
      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setMessage(t("profileSaved"));
    });
  };

  const changePassword = () => {
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError(t("passwordMismatch"));
      return;
    }
    void run(async () => {
      await apiRequest("/api/profile/password", {
        method: "POST",
        body: JSON.stringify({
          ...(overview?.hasPassword
            ? { currentPassword: passwordForm.currentPassword }
            : {}),
          newPassword: passwordForm.newPassword,
        }),
      });
      const next = await apiRequest<ProfileOverview>("/api/profile");
      setOverview(next);
      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setMessage(t("passwordUpdated"));
    });
  };

  const uploadAvatar = (file: File) => {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("PNG, JPEG, or WebP image নির্বাচন করুন।");
      return;
    }
    if (file.size > 768 * 1024) {
      setError("Profile image 768 KB-এর মধ্যে হতে হবে।");
      return;
    }
    void run(async () => {
      await apiUpload("/api/profile/avatar", file);
      await refresh();
      const next = await apiRequest<ProfileOverview>("/api/profile");
      setOverview(next);
      setForm((current) => ({ ...current, avatar: next.user.avatar }));
      setMessage(
        i18n.language === "bn"
          ? "প্রোফাইল ছবি আপলোড হয়েছে।"
          : "Profile image uploaded.",
      );
    });
  };

  const createTicket = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const data = new FormData(formElement);
    void run(async () => {
      await apiRequest("/api/support", {
        method: "POST",
        body: JSON.stringify({
          subject: String(data.get("subject")),
          message: String(data.get("message")),
        }),
      });
      const result = await apiRequest<{ tickets: SupportTicket[] }>(
        "/api/support",
      );
      setTickets(result.tickets);
      formElement.reset();
      setMessage(
        i18n.language === "bn"
          ? "Support ticket তৈরি হয়েছে।"
          : "Support ticket created.",
      );
    });
  };

  const pageSize = 3;
  const pageCount = Math.max(1, Math.ceil(history.length / pageSize));
  const visibleHistory = useMemo(
    () =>
      history.slice(
        historyPage * pageSize,
        historyPage * pageSize + pageSize,
      ),
    [history, historyPage],
  );

  const renderHistoryItem = (item: HistoryItem) => {
    if (historyType === "tournament") {
      const row = item as TournamentHistoryItem;
      return (
        <>
          <span className={`history-result ${row.result}`}>
            {t(row.result)}
          </span>
          <div>
            <strong>{row.title}</strong>
            <small>
              {t(row.gameMode)} · {t("joinFee")} {money(row.joinFee)}
            </small>
          </div>
          <span>
            <strong>{money(row.prizeEarned)}</strong>
            <small>{formatDate(row.date, i18n.language)}</small>
          </span>
        </>
      );
    }
    if (historyType === "refer") {
      const row = item as ReferralHistoryItem;
      return (
        <>
          <span className="history-avatar">{row.name.slice(0, 1)}</span>
          <div>
            <strong>{row.name}</strong>
            <small>ID {row.gameId} · {money(row.depositAmount)}</small>
          </div>
          <span>
            <strong>+{money(row.commissionEarned)}</strong>
            <small>{formatDate(row.joinedAt, i18n.language)}</small>
          </span>
        </>
      );
    }
    if (historyType === "transfer") {
      const row = item as TransferHistoryItem;
      return (
        <>
          <span className={`history-result ${row.direction}`}>
            {t(row.direction === "incoming" ? "received" : "sent")}
          </span>
          <div>
            <strong>{row.otherParty?.name ?? t("unknownPlayer")}</strong>
            <small>
              ID {row.otherParty?.gameId ?? "-----"} · {t("commission")}{" "}
              {money(row.commissionAmount)}
            </small>
          </div>
          <span>
            <strong>{money(row.amount)}</strong>
            <small>{formatDate(row.createdAt, i18n.language)}</small>
          </span>
        </>
      );
    }
    const row = item as TransactionHistoryItem;
    return (
      <>
        <span className={`history-result ${row.status}`}>
          {t(row.status)}
        </span>
        <div>
          <strong>{money(row.amount)}</strong>
          <small>
            {row.method || t("notSet")}
            {historyType === "deposit" &&
              ` · ${t("bonus")} ${money(row.bonusAmount)}`}
          </small>
        </div>
        <span>
          <strong>{t(historyType)}</strong>
          <small>{formatDate(row.createdAt, i18n.language)}</small>
        </span>
      </>
    );
  };

  return (
    <main className="page profile-page profile-dashboard profile-page--premium">
      <nav className="profile-view-tabs glass">
        {(["profile", "stats", "activity", "support"] as const).map((item) => (
          <button
            className={view === item ? "active" : ""}
            key={item}
            onClick={() => setView(item)}
          >
            {item === "profile" && <UserRound size={16} />}
            {item === "stats" && <Target size={16} />}
            {item === "activity" && <Activity size={16} />}
            {item === "support" && <LifeBuoy size={16} />}
            {t(item)}
          </button>
        ))}
      </nav>

      {view === "profile" && (
        <section className={`profile-panel glass${editing ? " profile-panel--editing" : ""}`}>
          {!editing ? (
            <>
              <div className="profile-summary">
                <div className="profile-avatar-wrap">
                  <img src={resolvedAvatar(user.avatar, user.gameId)} alt="" />
                  {user.isAdmin && <Crown size={16} />}
                </div>
                <div>
                  <small>{user.isAdmin ? t("admin") : t("player")}</small>
                  <h1>{user.name}</h1>
                  <button
                    onClick={() =>
                      void navigator.clipboard.writeText(user.gameId)
                    }
                  >
                    ID {user.gameId} <Copy size={11} />
                  </button>
                </div>
                <button
                  className="profile-edit-button"
                  onClick={() => setEditing(true)}
                >
                  <Pencil size={14} />
                </button>
              </div>

              <div className="profile-contact-grid">
                <div>
                  <Phone size={13} />
                  <span>
                    <small>{t("phone")}</small>
                    <strong>{user.phone || t("notSet")}</strong>
                  </span>
                </div>
                <div>
                  <Mail size={13} />
                  <span>
                    <small>{t("email")}</small>
                    <strong>{user.email || t("notSet")}</strong>
                  </span>
                </div>
              </div>

              <div className="balance-grid profile-balances">
                <div>
                  <small>{t("mainBalance")}</small>
                  <strong>{money(user.mainBalance)}</strong>
                </div>
                <div>
                  <small>{t("winnerBalance")}</small>
                  <strong>{money(user.winnerBalance)}</strong>
                </div>
              </div>

              <Link className="referral-code-card" to="/refer">
                <span>
                  <Gift size={15} />
                  <small>{t("yourReferralCode")}</small>
                </span>
                <strong>{user.referCode}</strong>
                <Copy size={14} />
              </Link>

              <div className="profile-footer-links">
                <div className="profile-footer-socials">
                  <a
                    className={!overview?.social.telegram ? "disabled" : ""}
                    href={overview?.social.telegram || undefined}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Telegram"
                    title="Telegram"
                  >
                    <Send size={14} />
                  </a>
                  <a
                    className={!overview?.social.whatsapp ? "disabled" : ""}
                    href={overview?.social.whatsapp || undefined}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="WhatsApp"
                    title="WhatsApp"
                  >
                    <MessageCircle size={14} />
                  </a>
                  <a
                    className={!overview?.social.facebook ? "disabled" : ""}
                    href={overview?.social.facebook || undefined}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Facebook"
                    title="Facebook"
                  >
                    <Share2 size={14} />
                  </a>
                </div>
                <div className="profile-footer-legal">
                  <Link to="/terms">{t("terms")}</Link>
                  <Link to="/privacy">{t("privacy")}</Link>
                </div>
              </div>

              <div className="profile-actions">
                {adminClaimAvailable && !user.isAdmin && !user.isGuest && (
                  <button
                    className="claim-button"
                    disabled={busy}
                    onClick={() => void run(claimAdmin)}
                  >
                    <ShieldCheck size={15} /> {t("claimAdmin")}
                  </button>
                )}
                <button
                  className="logout-button"
                  disabled={busy}
                  onClick={() => void run(logout)}
                >
                  <LogOut size={15} /> {t("logout")}
                </button>
              </div>
            </>
          ) : (
            <div className="profile-edit-scroll">
              <form className="profile-edit-form" onSubmit={saveProfile}>
                <div className="profile-edit-title">
                  <strong>{t("editProfile")}</strong>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      setPasswordForm({
                        currentPassword: "",
                        newPassword: "",
                        confirmPassword: "",
                      });
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="avatar-picker">
                <label className="avatar-upload-button">
                  <Camera size={18} />
                  <span>
                    {i18n.language === "bn"
                      ? "নিজের ছবি আপলোড"
                      : "Upload your photo"}
                  </span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) uploadAvatar(file);
                      event.target.value = "";
                    }}
                  />
                </label>
                {overview?.avatarOptions.map((avatar) => (
                  <button
                    type="button"
                    className={form.avatar === avatar ? "active" : ""}
                    key={avatar}
                    onClick={() => setForm({ ...form, avatar })}
                  >
                    <img src={avatar} alt="" />
                  </button>
                ))}
              </div>
              <div className="profile-input-grid">
                <label>
                  <span>{t("name")}</span>
                  <input
                    value={form.name}
                    onChange={(event) =>
                      setForm({ ...form, name: event.target.value })
                    }
                    required
                  />
                </label>
                <label>
                  <span>{t("email")}</span>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(event) =>
                      setForm({ ...form, email: event.target.value })
                    }
                  />
                </label>
                <label className="profile-phone-input">
                  <span>{t("phone")}</span>
                  <input
                    value={form.phone}
                    onChange={(event) =>
                      setForm({ ...form, phone: event.target.value })
                    }
                    required
                  />
                </label>
              </div>

              {!user.isGuest && (
                <section className="profile-security">
                  <div className="profile-security__head">
                    <KeyRound size={16} />
                    <strong>{t("passwordSecurity")}</strong>
                  </div>
                  <small className="profile-security__hint">{t("passwordHint")}</small>
                  <div className="profile-security__form">
                    {overview?.hasPassword && (
                      <label>
                        <span>{t("currentPassword")}</span>
                        <input
                          type="password"
                          autoComplete="current-password"
                          value={passwordForm.currentPassword}
                          onChange={(event) =>
                            setPasswordForm({
                              ...passwordForm,
                              currentPassword: event.target.value,
                            })
                          }
                        />
                      </label>
                    )}
                    <label>
                      <span>{t("newPassword")}</span>
                      <input
                        type="password"
                        autoComplete="new-password"
                        minLength={8}
                        maxLength={72}
                        value={passwordForm.newPassword}
                        onChange={(event) =>
                          setPasswordForm({
                            ...passwordForm,
                            newPassword: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      <span>{t("confirmPassword")}</span>
                      <input
                        type="password"
                        autoComplete="new-password"
                        minLength={8}
                        maxLength={72}
                        value={passwordForm.confirmPassword}
                        onChange={(event) =>
                          setPasswordForm({
                            ...passwordForm,
                            confirmPassword: event.target.value,
                          })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="profile-password-button"
                      disabled={busy}
                      onClick={() => changePassword()}
                    >
                      <ShieldCheck size={14} />
                      {overview?.hasPassword ? t("updatePassword") : t("setPassword")}
                    </button>
                  </div>
                </section>
              )}

              <button className="profile-save-button" disabled={busy}>
                <Save size={14} /> {t("saveChanges")}
              </button>
            </form>
            </div>
          )}
        </section>
      )}

      {view === "stats" && (
        <section className="stats-panel">
          <div
            className="win-rate-ring glass"
            style={
              {
                "--win-rate": `${stats?.winRate ?? 0}%`,
              } as CSSProperties
            }
          >
            <div>
              <strong>{stats?.winRate ?? 0}%</strong>
              <small>{t("winRate")}</small>
            </div>
          </div>
          <div className="stats-grid">
            {[
              [Gamepad2, "totalGames", stats?.totalGames ?? 0],
              [Trophy, "totalWins", stats?.totalWins ?? 0],
              [X, "totalLosses", stats?.totalLosses ?? 0],
              [WalletCards, "totalEarnings", money(stats?.totalEarnings ?? 0)],
              [Crown, "currentRank", `#${stats?.currentRank || "-"}`],
              [Flame, "highestStreak", stats?.highestWinStreak ?? 0],
            ].map(([Icon, label, value]) => {
              const StatIcon = Icon as typeof Gamepad2;
              return (
                <article className="stat-card glass" key={String(label)}>
                  <StatIcon size={17} />
                  <strong>{String(value)}</strong>
                  <small>{t(String(label))}</small>
                </article>
              );
            })}
          </div>
          <div className="best-finish glass">
            <Trophy size={18} />
            <span>
              <small>{t("bestTournamentFinish")}</small>
              <strong>
                {stats?.bestTournamentFinish
                  ? `#${stats.bestTournamentFinish}`
                  : t("notAvailable")}
              </strong>
            </span>
          </div>
        </section>
      )}

      {view === "activity" && (
        <section className="activity-panel">
          <nav className="history-tabs glass">
            {historyTypes.map((type) => (
              <button
                className={historyType === type ? "active" : ""}
                key={type}
                onClick={() => setHistoryType(type)}
              >
                {t(type)}
              </button>
            ))}
          </nav>

          {historySummary && (
            <div className="refer-summary">
              <span>{t("totalRefers")} {historySummary.totalReferCount}</span>
              <strong>
                {t("referIncome")} {money(historySummary.totalReferIncome)}
              </strong>
            </div>
          )}

          <div className="history-timeline">
            {visibleHistory.length === 0 ? (
              <div className="history-empty glass">{t("noHistory")}</div>
            ) : (
              visibleHistory.map((item) => (
                <article className="history-item glass" key={item.id}>
                  {renderHistoryItem(item)}
                </article>
              ))
            )}
          </div>

          <div className="history-pagination">
            <button
              disabled={historyPage === 0}
              onClick={() => setHistoryPage((page) => page - 1)}
            >
              <ChevronLeft size={15} />
            </button>
            <span>
              {historyPage + 1}/{pageCount}
            </span>
            <button
              disabled={historyPage >= pageCount - 1}
              onClick={() => setHistoryPage((page) => page + 1)}
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </section>
      )}

      {view === "support" && (
        <section className="support-center">
          <form className="support-compose glass" onSubmit={createTicket}>
            <span className="support-kicker">
              <LifeBuoy size={15} />
              {i18n.language === "bn" ? "Player support" : "Player support"}
            </span>
            <h1>
              {i18n.language === "bn"
                ? "কীভাবে সাহায্য করতে পারি?"
                : "How can we help?"}
            </h1>
            <input
              name="subject"
              minLength={3}
              maxLength={180}
              placeholder={
                i18n.language === "bn" ? "সমস্যার বিষয়" : "Issue subject"
              }
              required
            />
            <textarea
              name="message"
              minLength={5}
              maxLength={5000}
              placeholder={
                i18n.language === "bn"
                  ? "সমস্যাটি বিস্তারিত লিখুন"
                  : "Describe the issue"
              }
              required
            />
            <button disabled={busy}>
              <Send size={14} />
              {i18n.language === "bn" ? "Ticket পাঠান" : "Send ticket"}
            </button>
          </form>

          <div className="support-ticket-list">
            {tickets.length === 0 && (
              <div className="history-empty glass">
                {i18n.language === "bn"
                  ? "এখনও কোনো support ticket নেই।"
                  : "No support tickets yet."}
              </div>
            )}
            {tickets.map((ticket) => (
              <article className="support-ticket glass" key={ticket.id}>
                <header>
                  <span className={`support-status ${ticket.status}`}>
                    {ticket.status.replace("_", " ")}
                  </span>
                  <small>{formatDate(ticket.createdAt, i18n.language)}</small>
                </header>
                <h2>{ticket.subject}</h2>
                <p>{ticket.message}</p>
                {ticket.adminReply && (
                  <blockquote>
                    <strong>
                      {i18n.language === "bn"
                        ? "Support reply"
                        : "Support reply"}
                    </strong>
                    {ticket.adminReply}
                  </blockquote>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {(error || message) && (
        <p className={error ? "profile-toast error" : "profile-toast"}>
          {error || message}
        </p>
      )}
    </main>
  );
}
