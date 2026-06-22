import {
  ArrowRight,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { GamingIcon } from "../components/icons";
import type { HomeSnapshot, LeaderboardPlayer } from "../types";

const liveModes = ["Time", "Time", "Quick", "Quick", "Classic", "Time", "Speed"];
const liveSeconds = [16, 16, 4, 32, 50, 1, 40];
const liveAmounts = [100, 190, 300, 500, 930, 1250, 2160, 2930, 3650, 3800];
const liveFirstNames = [
  "Arafat",
  "Arif",
  "Ashik",
  "Asif",
  "Bappy",
  "Bijoy",
  "Emon",
  "Fahim",
  "Farhan",
  "Hasan",
  "Hridoy",
  "Imran",
  "Jahid",
  "Karim",
  "Mamun",
  "Masud",
  "Mehedi",
  "Mim",
  "Naim",
  "Nayem",
  "Nila",
  "Nishat",
  "Rafi",
  "Rahim",
  "Rakib",
  "Rasel",
  "Ratul",
  "Rifat",
  "Sabbir",
  "Sadia",
  "Shakib",
  "Sumon",
  "Tania",
  "Tamim",
];
const liveLastNames = [
  "Ahmed",
  "Akter",
  "Alam",
  "Begum",
  "Chowdhury",
  "Hasan",
  "Hossain",
  "Islam",
  "Jahan",
  "Khan",
  "Mia",
  "Molla",
  "Noor",
  "Rahman",
  "Sarker",
  "Sheikh",
  "Sultana",
  "Uddin",
  "Vai",
  "Zaman",
  "Fardin",
  "Mahin",
  "Nabil",
  "Raihan",
  "Sakib",
  "Sami",
  "Siam",
  "Tahsin",
  "Toma",
  "Yasin",
];
const liveNamePool = liveFirstNames
  .flatMap((firstName) => liveLastNames.map((lastName) => `${firstName} ${lastName}`))
  .slice(0, 1000);

interface LiveBoardRow {
  id: string;
  name: string;
  mode: string;
  seconds: number;
  amount: number;
}

function compactMoney(value: number) {
  if (value >= 1000) return `৳${(value / 1000).toFixed(value >= 10000 ? 1 : 0)}K`;
  return `৳${value.toLocaleString()}`;
}

function liveUserName(player: LeaderboardPlayer) {
  const base = player.name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 7) || "Player";
  const suffix = player.id.replace(/\D/g, "").slice(-3) || String(player.name.length * 37).slice(0, 3);
  return `${base}${suffix}`;
}

function liveWinAmount(player: LeaderboardPlayer, index: number) {
  const earnings = Number(player.earnings) || 0;
  const amount = Math.max(100, Math.min(3800, Math.round(earnings / 10 / 10) * 10));
  return index % 10 < 7 ? amount : -Math.min(amount, 190);
}

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildLiveBoardRows(
  players: LeaderboardPlayer[],
  serverTime: string,
  tick: number,
): LiveBoardRow[] {
  const seed = hashText(`${serverTime.slice(0, 16)}-${tick}`);
  const rows: LiveBoardRow[] = players.slice(0, 8).map((player, index) => ({
    id: `real-${player.id}-${tick}`,
    name: liveUserName(player),
    mode: liveModes[index % liveModes.length] ?? "Quick",
    seconds: liveSeconds[index % liveSeconds.length] ?? 16,
    amount: liveWinAmount(player, index),
  }));

  for (let index = 0; rows.length < 24; index += 1) {
    const value = (seed + index * 97 + tick * 37) >>> 0;
    const positive = rows.length % 10 < 7;
    const baseAmount = liveAmounts[(value + rows.length) % liveAmounts.length] ?? 190;
    rows.push({
      id: `fake-${tick}-${index}-${value}`,
      name: `${liveNamePool[value % liveNamePool.length] ?? "Ratul Islam"}${String((value % 900) + 100)}`,
      mode: liveModes[(value + index) % liveModes.length] ?? "Quick",
      seconds: (value % 54) + 4,
      amount: positive ? baseAmount : -Math.min(baseAmount, 190),
    });
  }

  return rows;
}

export function HomePage({
  snapshot,
  loading,
  error,
  onOpenTournaments,
  onRefresh,
}: {
  snapshot: HomeSnapshot | null;
  loading: boolean;
  error: string;
  onOpenTournaments: () => void;
  onRefresh: () => Promise<void>;
}) {
  const { i18n, t } = useTranslation();
  const [comingSoon, setComingSoon] = useState("");
  const [liveTick, setLiveTick] = useState(0);

  useEffect(() => {
    if (!comingSoon) return;
    const timer = window.setTimeout(() => setComingSoon(""), 2400);
    return () => window.clearTimeout(timer);
  }, [comingSoon]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setLiveTick((value) => (value + 1) % 1000);
    }, 9000);
    return () => window.clearInterval(timer);
  }, []);

  const liveRows = useMemo(
    () =>
      snapshot
        ? buildLiveBoardRows(snapshot.leaderboard, snapshot.serverTime, liveTick)
        : [],
    [liveTick, snapshot],
  );
  const paidToday = liveRows.reduce(
    (total, row) => total + Math.max(0, row.amount),
    0,
  ) * 43;
  const liveGames = Math.max(322, liveRows.length * 31 + 220);
  const onlinePlayers = snapshot
    ? 1000 + ((hashText(snapshot.serverTime) + liveTick * 13) % 900)
    : 1000;
  const gameVisibility = snapshot?.settings.games ?? {
    carrom: false,
    hockey: false,
    pool: false,
  };
  if (loading && !snapshot) {
    return (
      <main className="page home-page home-page--loading">
        <img src="/prizejito-logo.png" alt={t("appName")} />
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className="page home-page home-page--error">
        <p>{error}</p>
        <button className="primary-button" onClick={() => void onRefresh()}>
          {t("tryAgain")}
        </button>
      </main>
    );
  }

  const openProtectedTournament = () => {
    onOpenTournaments();
  };

  return (
    <main className="page home-page home-dashboard home-page--premium">
      <section className="home-hero-banner glass">
        <div className="home-hero-banner__mesh" aria-hidden="true" />
        <div className="home-hero-banner__visual" aria-hidden="true">
          <GamingIcon name="game-controller" size={42} motion="float" />
        </div>
        <div className="home-hero-banner__content">
          <div className="home-hero-banner__topline">
            <span className="home-hero-banner__brand">
              {snapshot.settings.siteName.toUpperCase()}
            </span>
            <span className="home-hero-banner__live">
              <i aria-hidden="true" />
              {onlinePlayers.toLocaleString()}{" "}
              {i18n.language === "bn" ? "অনলাইন" : "online"}
            </span>
          </div>
          <div className="home-hero-banner__copy">
            <h1>{t("heroHeadline")}</h1>
            <p>{t("tagline")}</p>
          </div>
        </div>
        <div className="home-hero-banner__logo-wrap">
          <span className="home-hero-banner__ring" aria-hidden="true" />
          <img
            className="home-hero-banner__logo"
            src={snapshot.settings.logoUrl || "/prizejito-logo.png"}
            alt=""
          />
        </div>
      </section>

      <div className="home-quick-actions">
        <button
          type="button"
          className="home-play-cta primary-button"
          onClick={openProtectedTournament}
        >
          <span className="home-play-cta__icon" aria-hidden="true">
            <GamingIcon name="start-play" size={20} motion="shine" />
          </span>
          <span className="home-play-cta__label">{t("playStart")}</span>
          <span className="home-play-cta__arrow" aria-hidden="true">
            <ArrowRight size={16} />
          </span>
        </button>
      </div>

      <section className="home-game-hub" aria-label="Games">
        <header className="home-game-hub__header">
          <span>
            <Sparkles size={14} />
            {i18n.language === "bn" ? "গেমস" : "Games"}
          </span>
          <small>
            {i18n.language === "bn" ? "টুর্নামেন্টে যোগ দিন" : "Join tournaments"}
          </small>
        </header>

        <button
          type="button"
          className="game-category game-category--featured game-category--ludo glass"
          onClick={onOpenTournaments}
        >
          <span className="game-category__icon" aria-hidden="true">
            <GamingIcon name="ludo-dice" size={28} motion="shine" />
          </span>
          <span className="game-category__copy">
            <strong>Ludo</strong>
            <small>{i18n.language === "bn" ? "এখন খেলুন" : "Play now"}</small>
          </span>
          <em className="game-category__badge">
            {i18n.language === "bn" ? "লাইভ" : "Live"}
          </em>
        </button>

        <div className="home-game-categories home-game-categories--soon">
          {gameVisibility.carrom && (
          <button
            type="button"
            className="game-category game-category--soon game-category--carrom glass"
            onClick={() => setComingSoon("Carrom")}
          >
            <span className="game-category__icon" aria-hidden="true">
              <GamingIcon name="carrom-coin" size={24} motion="float" />
            </span>
            <span className="game-category__copy">
              <strong>Carrom</strong>
              <small>{i18n.language === "bn" ? "শীঘ্রই" : "Soon"}</small>
            </span>
          </button>
          )}
          {gameVisibility.hockey && (
          <button
            type="button"
            className="game-category game-category--soon game-category--hockey glass"
            onClick={() => setComingSoon("Ice Hockey")}
          >
            <span className="game-category__icon" aria-hidden="true">
              <GamingIcon name="carrom-striker" size={24} motion="float" />
            </span>
            <span className="game-category__copy">
              <strong>Ice Hockey</strong>
              <small>{i18n.language === "bn" ? "শীঘ্রই" : "Soon"}</small>
            </span>
          </button>
          )}
          {gameVisibility.pool && (
          <button
            type="button"
            className="game-category game-category--soon game-category--pool glass"
            onClick={() => setComingSoon("Pool Game")}
          >
            <span className="game-category__icon" aria-hidden="true">
              <GamingIcon name="pool-ball" size={24} motion="shine" />
            </span>
            <span className="game-category__copy">
              <strong>Pool</strong>
              <small>{i18n.language === "bn" ? "শীঘ্রই" : "Soon"}</small>
            </span>
          </button>
          )}
        </div>
      </section>

      <section className="home-section leaderboard-section live-win-board glass">
          <header className="live-win-board__header live-win-board__header--premium">
            <span>
              <i aria-hidden="true" /> {t("liveWin")}
            </span>
            <strong>
              <TrendingUp size={11} /> 70% <small>{t("winRate")}</small>
            </strong>
          </header>
          <div className="live-win-board__stats">
            <span><small>Online</small><strong>{onlinePlayers.toLocaleString()}</strong></span>
            <span><small>Paid Today</small><strong>{compactMoney(paidToday)}</strong></span>
            <span><small>Live Games</small><strong>{liveGames}</strong></span>
          </div>
          <div className="live-win-board__rows" aria-live="polite">
            <div className="live-win-board__scroller">
            {liveRows.map((row) => {
              const positive = row.amount >= 0;
              return (
              <article className={positive ? "win" : "loss"} key={row.id}>
                <span className="live-win-board__avatar" aria-hidden="true">
                  {row.name.trim().slice(0, 1).toUpperCase()}
                </span>
                <span className="live-dot" />
                <strong>{row.name}</strong>
                <span className="live-win-board__legacy">
                  <strong>{row.name}</strong>
                  <small>৳{Math.abs(row.amount).toLocaleString()}</small>
                </span>
                <em>{row.mode}</em>
                <small>{row.seconds}s</small>
                <b>
                  <TrendingUp size={10} /> {positive ? "+" : "-"}৳{Math.abs(row.amount).toLocaleString()}
                </b>
              </article>
              );
            })}
            </div>
          </div>
        </section>

      {comingSoon && (
        <div className="home-coming-soon" role="status">
          <Sparkles size={16} />
          <span><strong>{comingSoon}</strong>{i18n.language === "bn" ? " শীঘ্রই আসছে" : " is coming soon"}</span>
        </div>
      )}

    </main>
  );
}
