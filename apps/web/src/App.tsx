import { lazy, Suspense, useEffect, useState } from "react";
import { Megaphone, ShieldAlert } from "lucide-react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { AppHeader } from "./components/AppHeader";
import { AuthModal } from "./components/AuthModal";
import { BottomNav } from "./components/BottomNav";
import { BgGameIcons } from "./components/BgGameIcons";
import { ForestBackground } from "./components/ForestBackground";
import { SiteAmbientLayer } from "./components/SiteAmbientLayer";
import { NotificationCenter } from "./components/NotificationCenter";
import { OfflineOverlay } from "./components/OfflineOverlay";
import { PwaInstallPrompt } from "./components/PwaInstallPrompt";
import { useAuth } from "./context/AuthContext";
import { socket } from "./lib/socket";
import { useHomeFeed } from "./hooks/useHomeFeed";
import { applyTheme, type ThemePayload } from "./lib/theme-presets";
import type { RealtimeEnvelope, RealtimeState } from "./types";

const HomePage = lazy(() =>
  import("./pages/HomePage").then((module) => ({ default: module.HomePage })),
);
const GamePage = lazy(() =>
  import("./pages/GamePage").then((module) => ({ default: module.GamePage })),
);
const FxCasinoPage = lazy(() =>
  import("./pages/FxCasinoPage").then((module) => ({
    default: module.FxCasinoPage,
  })),
);
const LegalPage = lazy(() =>
  import("./pages/LegalPage").then((module) => ({ default: module.LegalPage })),
);
const LeaderboardPage = lazy(() =>
  import("./pages/LeaderboardPage").then((module) => ({
    default: module.LeaderboardPage,
  })),
);
const ProfilePage = lazy(() =>
  import("./pages/ProfilePage").then((module) => ({
    default: module.ProfilePage,
  })),
);
const ReferPage = lazy(() =>
  import("./pages/ReferPage").then((module) => ({ default: module.ReferPage })),
);
const TournamentPage = lazy(() =>
  import("./pages/TournamentPage").then((module) => ({
    default: module.TournamentPage,
  })),
);
const WalletPage = lazy(() =>
  import("./pages/WalletPage").then((module) => ({ default: module.WalletPage })),
);
const AdminPage = lazy(() =>
  import("./pages/AdminPage").then((module) => ({ default: module.AdminPage })),
);

function envelopePayload<T>(value: RealtimeEnvelope<T> | T): T {
  return value &&
    typeof value === "object" &&
    "payload" in value
    ? (value as RealtimeEnvelope<T>).payload
    : (value as T);
}

export default function App() {
  const [authOpen, setAuthOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [maintenance, setMaintenance] = useState({
    enabled: false,
    message: "",
  });
  const [notice, setNotice] = useState<{
    title: string;
    message: string;
  } | null>(null);
  const { loading, user, refresh: refreshAuth } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const immersiveMode =
    location.pathname.startsWith("/game/") ||
    location.pathname.startsWith("/games/");
  const gameMode = immersiveMode;
  const adminMode = location.pathname.startsWith("/admin");
  const tournamentMode = location.pathname.startsWith("/tournaments");
  const homeFeed = useHomeFeed(Boolean(user));

  useEffect(() => {
    socket.disconnect();
    socket.connect();
    return () => {
      socket.disconnect();
    };
  }, [user?.id]);

  useEffect(() => {
    const onState = (
      event: RealtimeEnvelope<RealtimeState> | RealtimeState,
    ) => {
      const state = envelopePayload(event);
      setMaintenance(state.maintenance);
      applyTheme(state.theme);
      if (state.user) void refreshAuth();
    };
    const onMaintenance = (
      event:
        | RealtimeEnvelope<{ enabled: boolean; message: string }>
        | { enabled: boolean; message: string },
    ) => setMaintenance(envelopePayload(event));
    const onNotice = (
      event:
        | RealtimeEnvelope<{ title: string; message: string }>
        | { title: string; message: string },
    ) => setNotice(envelopePayload(event));
    const onTheme = (settings: ThemePayload) => {
      applyTheme(settings);
      void homeFeed.refresh();
    };
    const resync = () => socket.emit("system:resync");
    socket.on("system:state", onState);
    socket.on("admin:maintenance", onMaintenance);
    socket.on("admin:notice", onNotice);
    socket.on("admin:theme-update", onTheme);
    socket.on("connect", resync);
    return () => {
      socket.off("system:state", onState);
      socket.off("admin:maintenance", onMaintenance);
      socket.off("admin:notice", onNotice);
      socket.off("admin:theme-update", onTheme);
      socket.off("connect", resync);
    };
  }, [homeFeed.refresh, refreshAuth]);

  useEffect(() => {
    if (loading || user) return;
    setNotificationsOpen(false);
    void homeFeed.refresh();
    if (
      ["/profile", "/wallet", "/refer", "/admin"].some((path) =>
        location.pathname.startsWith(path),
      )
    ) {
      navigate("/", { replace: true });
    }
  }, [homeFeed.refresh, loading, location.pathname, navigate, user]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 8_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (homeFeed.snapshot?.settings.siteName) {
      document.title = homeFeed.snapshot.settings.siteName;
    }
  }, [homeFeed.snapshot?.settings.siteName]);

  const requireLogin = (action?: () => void) => {
    if (!user) {
      setAuthOpen(true);
      return;
    }
    action?.();
  };

  if (loading) {
    return (
      <div className="app-shell app-shell--premium app-shell--loading">
        <SiteAmbientLayer />
        <ForestBackground />
        <BgGameIcons />
        <img src="/prizejito-logo.png" alt="PrizeJito.com" />
      </div>
    );
  }

  const premiumShell = !gameMode && !adminMode;

  return (
    <div className={`app-shell ${premiumShell ? "app-shell--premium" : ""}`}>
      {!gameMode && <SiteAmbientLayer />}
      {!gameMode && <ForestBackground />}
      {!gameMode && <BgGameIcons />}
      <div
        className={`app-surface ${gameMode ? "app-surface--game" : ""} ${adminMode ? "app-surface--admin" : ""} ${tournamentMode ? "app-surface--tournaments" : ""}`}
      >
        {!gameMode && !adminMode && (
          <AppHeader
            onLogin={() => setAuthOpen(true)}
            onNotifications={() =>
              user
                ? setNotificationsOpen(true)
                : setAuthOpen(true)
            }
            unreadCount={homeFeed.snapshot?.unreadNotifications ?? 0}
          />
        )}
        <Suspense fallback={<main className="page-loading">Loading...</main>}>
        <Routes>
          <Route
            path="/"
            element={
              <HomePage
                snapshot={homeFeed.snapshot}
                loading={homeFeed.loading}
                error={homeFeed.error}
                onOpenTournaments={() => navigate("/tournaments")}
                onOpenTradeJito={() =>
                  requireLogin(() => navigate("/games/fx-casino"))
                }
                onRefresh={homeFeed.refresh}
              />
            }
          />
          <Route
            path="/tournaments"
            element={
              <TournamentPage
                authenticated={Boolean(user)}
                onProtected={() => setAuthOpen(true)}
                logoUrl={
                  homeFeed.snapshot?.settings.logoUrl || "/prizejito-logo.png"
                }
              />
            }
          />
          <Route path="/game/:matchId" element={<GamePage />} />
          <Route path="/games/fx-casino" element={<FxCasinoPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route
            path="/leaders"
            element={<LeaderboardPage />}
          />
          <Route
            path="/wallet"
            element={
              user ? (
                <WalletPage />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/refer"
            element={
              user ? (
                <ReferPage />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/profile"
            element={
              user ? (
                <ProfilePage />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route path="/terms" element={<LegalPage document="terms" />} />
          <Route path="/privacy" element={<LegalPage document="privacy" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
        {!gameMode && !adminMode && (
          <BottomNav
            authenticated={Boolean(user)}
            onProtected={() => setAuthOpen(true)}
          />
        )}
      </div>
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
      <NotificationCenter
        open={notificationsOpen && Boolean(user)}
        onClose={() => setNotificationsOpen(false)}
        onChanged={() => void homeFeed.refresh()}
      />
      <PwaInstallPrompt
        logoUrl={homeFeed.snapshot?.settings.logoUrl || "/prizejito-logo.png"}
        siteName={homeFeed.snapshot?.settings.siteName || "PrizeJito.com"}
      />
      <OfflineOverlay
        logoUrl={homeFeed.snapshot?.settings.logoUrl || "/prizejito-logo.png"}
      />
      {notice && (
        <button
          className="realtime-notice"
          onClick={() => setNotice(null)}
          aria-label="Dismiss notice"
        >
          <Megaphone size={18} />
          <span>
            <strong>{notice.title}</strong>
            <small>{notice.message}</small>
          </span>
        </button>
      )}
      {maintenance.enabled && (
        <div className="maintenance-overlay" role="alertdialog" aria-modal="true">
          <div className="glass">
            <ShieldAlert size={40} />
            <h1>Maintenance</h1>
            <p>{maintenance.message}</p>
          </div>
        </div>
      )}
    </div>
  );
}
