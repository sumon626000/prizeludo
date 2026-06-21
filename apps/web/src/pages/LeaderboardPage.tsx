import {
  Bot,
  Check,
  LoaderCircle,
  Pencil,
  Plus,
  Settings2,
  ShieldCheck,
  Trash2,
  Trophy,
  UsersRound,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { apiRequest } from "../lib/api";
import { resolvedAvatar } from "../lib/avatar";
import { avatarOptions } from "../lib/avatars";
import { socket } from "../lib/socket";
import type {
  BotAdminSnapshot,
  BotPlayer,
  LeaderboardPeriod,
  LeaderboardSnapshot,
} from "../types";

const AVATARS = avatarOptions;

interface BotForm {
  name: string;
  avatar: string;
  winRate: string;
  useGlobalWinRate: boolean;
  actionDelayMinMs: string;
  actionDelayMaxMs: string;
  isActive: boolean;
}

const EMPTY_BOT: BotForm = {
  name: "",
  avatar: AVATARS[0]!,
  winRate: "70",
  useGlobalWinRate: true,
  actionDelayMinMs: "900",
  actionDelayMaxMs: "2200",
  isActive: true,
};

function money(value: string) {
  return `৳${Number(value).toLocaleString()}`;
}

export function LeaderboardPage() {
  const { i18n } = useTranslation();
  const { user } = useAuth();
  const bn = i18n.language === "bn";
  const isAdmin = Boolean(user?.isAdmin || user?.isSubAdmin);
  const [period, setPeriod] = useState<LeaderboardPeriod>("all");
  const [snapshot, setSnapshot] = useState<LeaderboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<"ranking" | "bots">("ranking");
  const [admin, setAdmin] = useState<BotAdminSnapshot | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BotForm>(EMPTY_BOT);
  const [busy, setBusy] = useState("");

  const copy = {
    title: bn ? "লিডারবোর্ড" : "Leaderboard",
    subtitle: bn
      ? "আসল ফলাফল ও স্পষ্টভাবে চিহ্নিত প্রচারণামূলক প্লেয়ার"
      : "Real results with clearly labelled promotional players",
    daily: bn ? "দৈনিক" : "Daily",
    weekly: bn ? "সাপ্তাহিক" : "Weekly",
    monthly: bn ? "মাসিক" : "Monthly",
    all: bn ? "সর্বকাল" : "All-time",
    wins: bn ? "জয়" : "wins",
    losses: bn ? "হার" : "losses",
    empty: bn ? "এই সময়ে কোনো ফলাফল নেই" : "No results in this period",
    yourRank: bn ? "আপনার র‍্যাঙ্ক" : "Your rank",
    real: bn ? "আসল" : "Real",
    promo: bn ? "BOT / PROMO" : "BOT / PROMO",
    topPlayers: bn ? "সেরা ৫০ খেলোয়াড়" : "Top 50 players",
    scrollHint: bn ? "স্ক্রল করে দেখুন" : "Scroll to see all",
    bots: bn ? "বট নিয়ন্ত্রণ" : "Bot control",
    ranking: bn ? "র‍্যাঙ্কিং" : "Ranking",
    settings: bn ? "গ্লোবাল সেটিংস" : "Global settings",
    enabled: bn ? "বট ইঞ্জিন চালু" : "Bot engine enabled",
    globalRate: bn ? "গ্লোবাল দক্ষতা %" : "Global skill %",
    minDelay: bn ? "সর্বনিম্ন delay" : "Minimum delay",
    maxDelay: bn ? "সর্বোচ্চ delay" : "Maximum delay",
    save: bn ? "সংরক্ষণ" : "Save",
    newBot: bn ? "নতুন বট" : "New bot",
    name: bn ? "নাম" : "Name",
    useGlobal: bn ? "গ্লোবাল দক্ষতা ব্যবহার" : "Use global skill",
    active: bn ? "চালু" : "Active",
    create: bn ? "তৈরি করুন" : "Create",
    update: bn ? "আপডেট করুন" : "Update",
    deleteConfirm: bn
      ? "এই bot মুছবেন? ব্যবহৃত bot হলে archive হবে।"
      : "Delete this bot? Used bots will be archived.",
  };

  const loadLeaderboard = useCallback(async () => {
    try {
      setError("");
      const result = await apiRequest<LeaderboardSnapshot>(
        `/api/leaderboard?period=${period}`,
      );
      setSnapshot(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load.");
    } finally {
      setLoading(false);
    }
  }, [period]);

  const loadAdmin = useCallback(async () => {
    if (!isAdmin) return;
    setAdmin(await apiRequest<BotAdminSnapshot>("/api/bots/admin"));
  }, [isAdmin]);

  useEffect(() => {
    setLoading(true);
    void loadLeaderboard();
  }, [loadLeaderboard]);

  useEffect(() => {
    if (view === "bots") void loadAdmin();
  }, [loadAdmin, view]);

  useEffect(() => {
    const refresh = () => {
      void loadLeaderboard();
      if (isAdmin) void loadAdmin();
    };
    socket.on("leaderboard:update", refresh);
    socket.on("bot:update", refresh);
    socket.on("home:winner", refresh);
    return () => {
      socket.off("leaderboard:update", refresh);
      socket.off("bot:update", refresh);
      socket.off("home:winner", refresh);
    };
  }, [isAdmin, loadAdmin, loadLeaderboard]);

  const editBot = (bot: BotPlayer) => {
    setEditingId(bot.id);
    setForm({
      name: bot.name,
      avatar: bot.avatar,
      winRate: String(bot.winRate),
      useGlobalWinRate: bot.useGlobalWinRate,
      actionDelayMinMs: String(bot.actionDelayMinMs),
      actionDelayMaxMs: String(bot.actionDelayMaxMs),
      isActive: bot.isActive,
    });
  };

  const submitBot = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("bot");
    try {
      const body = {
        name: form.name,
        avatar: form.avatar,
        winRate: Number(form.winRate),
        useGlobalWinRate: form.useGlobalWinRate,
        actionDelayMinMs: Number(form.actionDelayMinMs),
        actionDelayMaxMs: Number(form.actionDelayMaxMs),
        isActive: form.isActive,
      };
      await apiRequest(
        editingId ? `/api/bots/admin/${editingId}` : "/api/bots/admin",
        {
          method: editingId ? "PATCH" : "POST",
          body: JSON.stringify(body),
        },
      );
      setEditingId(null);
      setForm(EMPTY_BOT);
      await Promise.all([loadAdmin(), loadLeaderboard()]);
    } finally {
      setBusy("");
    }
  };

  const saveSettings = async () => {
    if (!admin) return;
    setBusy("settings");
    try {
      const result = await apiRequest<BotAdminSnapshot>(
        "/api/bots/admin/settings",
        {
          method: "PUT",
          body: JSON.stringify(admin.settings),
        },
      );
      setAdmin(result);
    } finally {
      setBusy("");
    }
  };

  const removeBot = async (botId: string) => {
    if (!window.confirm(copy.deleteConfirm)) return;
    setBusy(`delete-${botId}`);
    try {
      await apiRequest(`/api/bots/admin/${botId}`, { method: "DELETE" });
      await Promise.all([loadAdmin(), loadLeaderboard()]);
    } finally {
      setBusy("");
    }
  };

  return (
    <main className="page leaderboard-page leaderboard-page--premium">
      <header className="leaderboard-header glass">
        <span>
          <Trophy size={15} />
          <i>
            <strong>{copy.title}</strong>
            <small>{copy.subtitle}</small>
          </i>
        </span>
        {isAdmin && (
          <button
            onClick={() =>
              setView((current) =>
                current === "ranking" ? "bots" : "ranking",
              )
            }
          >
            {view === "ranking" ? <Bot size={14} /> : <Trophy size={14} />}
            {view === "ranking" ? copy.bots : copy.ranking}
          </button>
        )}
      </header>

      {view === "ranking" ? (
        <>
          <nav className="leaderboard-periods glass">
            {(["daily", "weekly", "monthly", "all"] as const).map(
              (value) => (
                <button
                  className={period === value ? "active" : ""}
                  key={value}
                  onClick={() => setPeriod(value)}
                >
                  {copy[value]}
                </button>
              ),
            )}
          </nav>

          {snapshot?.currentPlayerRank && (
            <div className="leaderboard-own-rank glass">
              <ShieldCheck size={13} />
              <span>{copy.yourRank}</span>
              <strong>#{snapshot.currentPlayerRank}</strong>
            </div>
          )}

          <section className="leaderboard-list glass">
            <header className="leaderboard-list__header">
              <span><Trophy size={13} /> {copy.topPlayers}</span>
              <small>
                {copy.wins} / earnings · {copy.scrollHint}
              </small>
            </header>
            <div className="leaderboard-list__body">
              {loading && <LoaderCircle className="spin" size={24} />}
              {error && <p>{error}</p>}
              {!loading && !error && snapshot?.entries.length === 0 && (
                <p>{copy.empty}</p>
              )}
              {snapshot?.entries.map((entry) => (
                <article
                  className={[
                    entry.rank <= 5 ? "top-five" : "",
                    entry.isCurrentPlayer ? "current" : "",
                  ].filter(Boolean).join(" ")}
                  key={`${entry.source}-${entry.id}`}
                >
                  <b>#{entry.rank}</b>
                  <img src={resolvedAvatar(entry.avatar, entry.id)} alt="" />
                  <span>
                    <strong>{entry.name}</strong>
                    <small className="leaderboard-row__stats">
                      <span>
                        {entry.wins} {copy.wins}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {entry.losses} {copy.losses}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{entry.winRate}%</span>
                    </small>
                  </span>
                  <i>{money(entry.earnings)}</i>
                  <em className={entry.source}>
                    {entry.isPromotional ? copy.promo : copy.real}
                  </em>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : (
        <section className="bot-admin">
          {!admin ? (
            <div className="bot-admin-loading glass">
              <LoaderCircle className="spin" size={24} />
            </div>
          ) : (
            <>
              <div className="bot-settings glass">
                <header>
                  <Settings2 size={15} /> {copy.settings}
                </header>
                <label className="bot-switch">
                  <input
                    type="checkbox"
                    checked={admin.settings.enabled}
                    onChange={(event) =>
                      setAdmin((current) =>
                        current
                          ? {
                              ...current,
                              settings: {
                                ...current.settings,
                                enabled: event.target.checked,
                              },
                            }
                          : current,
                      )
                    }
                  />
                  {copy.enabled}
                </label>
                <label>
                  {copy.globalRate}
                  <input
                    type="range"
                    min="1"
                    max="100"
                    value={admin.settings.globalWinRate}
                    onChange={(event) =>
                      setAdmin((current) =>
                        current
                          ? {
                              ...current,
                              settings: {
                                ...current.settings,
                                globalWinRate: Number(event.target.value),
                              },
                            }
                          : current,
                      )
                    }
                  />
                  <b>{admin.settings.globalWinRate}%</b>
                </label>
                <label>
                  {copy.minDelay}
                  <input
                    type="number"
                    min="500"
                    max="5000"
                    value={admin.settings.actionDelayMinMs}
                    onChange={(event) =>
                      setAdmin((current) =>
                        current
                          ? {
                              ...current,
                              settings: {
                                ...current.settings,
                                actionDelayMinMs: Number(event.target.value),
                              },
                            }
                          : current,
                      )
                    }
                  />
                </label>
                <label>
                  {copy.maxDelay}
                  <input
                    type="number"
                    min="500"
                    max="10000"
                    value={admin.settings.actionDelayMaxMs}
                    onChange={(event) =>
                      setAdmin((current) =>
                        current
                          ? {
                              ...current,
                              settings: {
                                ...current.settings,
                                actionDelayMaxMs: Number(event.target.value),
                              },
                            }
                          : current,
                      )
                    }
                  />
                </label>
                <button onClick={saveSettings} disabled={busy === "settings"}>
                  <Check size={13} /> {copy.save}
                </button>
              </div>

              <form className="bot-editor glass" onSubmit={submitBot}>
                <header>
                  <Bot size={15} />
                  {editingId ? copy.update : copy.newBot}
                  {editingId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        setForm(EMPTY_BOT);
                      }}
                    >
                      <Plus size={13} /> {copy.newBot}
                    </button>
                  )}
                </header>
                <label>
                  {copy.name}
                  <input
                    required
                    minLength={3}
                    value={form.name}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                  />
                </label>
                <div className="bot-avatars">
                  {AVATARS.map((avatar) => (
                    <button
                      className={form.avatar === avatar ? "active" : ""}
                      key={avatar}
                      type="button"
                      onClick={() =>
                        setForm((current) => ({ ...current, avatar }))
                      }
                    >
                      <img src={avatar} alt="" />
                    </button>
                  ))}
                </div>
                <label className="bot-switch">
                  <input
                    type="checkbox"
                    checked={form.useGlobalWinRate}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        useGlobalWinRate: event.target.checked,
                      }))
                    }
                  />
                  {copy.useGlobal}
                </label>
                {!form.useGlobalWinRate && (
                  <label>
                    {copy.globalRate}
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={form.winRate}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          winRate: event.target.value,
                        }))
                      }
                    />
                  </label>
                )}
                <div className="bot-delay-fields">
                  <label>
                    {copy.minDelay}
                    <input
                      type="number"
                      min="500"
                      max="5000"
                      value={form.actionDelayMinMs}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          actionDelayMinMs: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    {copy.maxDelay}
                    <input
                      type="number"
                      min="500"
                      max="10000"
                      value={form.actionDelayMaxMs}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          actionDelayMaxMs: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
                <label className="bot-switch">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        isActive: event.target.checked,
                      }))
                    }
                  />
                  {copy.active}
                </label>
                <button disabled={busy === "bot"}>
                  {busy === "bot" ? (
                    <LoaderCircle className="spin" size={13} />
                  ) : editingId ? (
                    <Check size={13} />
                  ) : (
                    <Plus size={13} />
                  )}
                  {editingId ? copy.update : copy.create}
                </button>
              </form>

              <div className="bot-list glass">
                <header>
                  <UsersRound size={15} />
                  {admin.bots.length} bots
                </header>
                <div>
                  {admin.bots.map((bot) => (
                    <article key={bot.id}>
                      <img src={bot.avatar} alt="" />
                      <span>
                        <strong>{bot.name}</strong>
                        <small>
                          #{bot.gameId} · {bot.effectiveWinRate}% ·{" "}
                          {bot.isActive ? copy.active : "Inactive"}
                        </small>
                      </span>
                      <button onClick={() => editBot(bot)}>
                        <Pencil size={13} />
                      </button>
                      <button
                        disabled={busy === `delete-${bot.id}`}
                        onClick={() => void removeBot(bot.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </article>
                  ))}
                </div>
              </div>
            </>
          )}
        </section>
      )}
    </main>
  );
}
