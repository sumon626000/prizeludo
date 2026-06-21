import {
  ArrowLeft,
  Bot,
  CalendarClock,
  Check,
  Clock3,
  Crown,
  Eye,
  Filter,
  Gamepad2,
  LoaderCircle,
  LogIn,
  Pencil,
  Plus,
  Radio,
  ShieldCheck,
  Sparkles,
  Swords,
  Trash2,
  Trophy,
  UserRoundCheck,
  UsersRound,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { TournamentArtwork } from "../components/TournamentArtwork";
import { TournamentBracketTree } from "../components/TournamentBracketTree";
import { useAuth } from "../context/AuthContext";
import { apiRequest } from "../lib/api";
import { resolvedAvatar } from "../lib/avatar";
import {
  canLeaveTournament,
  isMixedAutoLobby,
  sortTournamentsForUser,
} from "../lib/tournament-ui";
import { socket } from "../lib/socket";
import type {
  MatchSnapshot,
  TournamentDetails,
  TournamentMatch,
  TournamentStatus,
  TournamentSummary,
} from "../types";

type TournamentView = "browse" | "bracket" | "admin";

interface TournamentFilters {
  type: "" | "free" | "paid";
  boardType: "" | "2p" | "4p";
  gameMode: "" | "classic" | "quick" | "master";
  status: "" | TournamentStatus;
}

interface TournamentForm {
  title: string;
  playerCount: "2" | "4" | "8" | "16" | "32" | "64";
  boardType: "2p" | "4p";
  gameMode: "classic" | "quick" | "master";
  type: "free" | "paid";
  joinFee: string;
  prizePool: string;
  adminCommission: string;
  prizeFirst: string;
  prizeSecond: string;
  playerType: "real" | "bot" | "mixed";
  countdownDuration: string;
  betweenRoundSeconds: string;
  status: "upcoming" | "waiting";
  startsAt: string;
}

interface GameSettingsForm {
  diceSpeed: "fast" | "normal" | "slow";
  tokenSpeed: "fast" | "normal" | "slow";
  voiceEnabled: boolean;
  voiceProvider: "jitsi";
}

interface ShowcaseSettingsForm {
  enabled: boolean;
  count: 3 | 4 | 5;
  sizes: Array<4 | 8 | 16 | 32 | 64>;
}

interface MixedAutoSettingsForm {
  enabled: boolean;
  countdownSeconds: number;
}

const EMPTY_FILTERS: TournamentFilters = {
  type: "",
  boardType: "",
  gameMode: "",
  status: "",
};

const EMPTY_FORM: TournamentForm = {
  title: "",
  playerCount: "4",
  boardType: "4p",
  gameMode: "classic",
  type: "paid",
  joinFee: "50",
  prizePool: "500",
  adminCommission: "10",
  prizeFirst: "70",
  prizeSecond: "30",
  playerType: "real",
  countdownDuration: "60",
  betweenRoundSeconds: "60",
  status: "waiting",
  startsAt: "",
};

function money(value: string | number) {
  return `৳${Number(value).toLocaleString()}`;
}

function localDateTime(value: string | null, language: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat(language === "bn" ? "bn-BD" : "en-US", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function useCountdown(target: string | null, serverTime: string) {
  const offset = useMemo(
    () => new Date(serverTime).getTime() - Date.now(),
    [serverTime],
  );
  const calculate = useCallback(
    () =>
      target
        ? Math.max(0, new Date(target).getTime() - (Date.now() + offset))
        : 0,
    [offset, target],
  );
  const [remaining, setRemaining] = useState(calculate);

  useEffect(() => {
    setRemaining(calculate());
    const timer = window.setInterval(() => setRemaining(calculate()), 1_000);
    return () => window.clearInterval(timer);
  }, [calculate]);

  const seconds = Math.floor(remaining / 1_000);
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function bracketMatchMarginTop(roundIndex: number, matchIndex: number): number {
  const unit = 42;
  if (matchIndex === 0) {
    const multiplier = 2 ** roundIndex;
    return ((multiplier - 1) * unit) / 2;
  }
  return (2 ** roundIndex) * unit;
}

function bracketRoundLabel(
  round: number,
  totalRounds: number,
  language: string,
): string {
  const bn = language === "bn";
  if (round === totalRounds) return bn ? "ফাইনাল" : "Final";
  if (round === totalRounds - 1 && totalRounds > 2) {
    return bn ? "সেমি" : "Semi";
  }
  if (round === totalRounds - 2 && totalRounds > 3) {
    return bn ? "কোয়ার্টার" : "Quarter";
  }
  return bn ? `রাউন্ড ${round}` : `Round ${round}`;
}

function toLocalInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function TournamentPage({
  authenticated,
  onProtected,
  logoUrl,
}: {
  authenticated: boolean;
  onProtected: () => void;
  logoUrl: string;
}) {
  const { i18n, t } = useTranslation();
  const navigate = useNavigate();
  const { user, refresh } = useAuth();
  const bn = i18n.language === "bn";
  const copy = {
    browse: bn ? "খুঁজুন" : "Browse",
    bracket: bn ? "ব্র্যাকেট" : "Bracket",
    admin: bn ? "পরিচালনা" : "Admin",
    filters: bn ? "ফিল্টার" : "Filters",
    all: bn ? "সব" : "All",
    current: bn ? "আপনার বর্তমান টুর্নামেন্ট" : "Your current tournament",
    slots: bn ? "স্লট" : "Slots",
    timer: bn ? "সময়" : "Timer",
    fee: bn ? "ফি" : "Fee",
    join: bn ? "যোগ দিন" : "Join",
    leave: bn ? "বের হন" : "Leave",
    details: bn ? "বিস্তারিত" : "Details",
    edit: bn ? "সম্পাদনা" : "Edit",
    waiting: bn ? "অপেক্ষমাণ" : "Waiting",
    active: bn ? "লাইভ" : "Live",
    completed: bn ? "সম্পন্ন" : "Completed",
    cancelled: bn ? "বাতিল" : "Cancelled",
    upcoming: bn ? "আসন্ন" : "Upcoming",
    leaveLockedTitle: bn ? "কাউন্টডাউন চলছে" : "Countdown running",
    leaveLockedHint: bn ? "এখন বের হওয়া যাবে না" : "Can't leave yet",
    joined: bn ? "যোগ দিয়েছেন" : "Joined",
    joinedBanner: bn ? "টুর্নামেন্টে যোগ দিয়েছেন" : "Tournament joined",
    players: bn ? "খেলোয়াড়" : "Players",
    match: bn ? "ম্যাচ" : "Match",
    matchReady: bn ? "ম্যাচ চলছে" : "Match live",
    play: bn ? "খেলুন" : "Play",
    spectate: bn ? "দেখুন" : "Spectate",
    connect: bn ? "ম্যাচে কানেক্ট" : "Connect to match",
    noTournament: bn ? "এই ফিল্টারে টুর্নামেন্ট নেই" : "No tournaments match these filters",
    create: bn ? "টুর্নামেন্ট তৈরি" : "Create tournament",
    update: bn ? "পরিবর্তন সংরক্ষণ" : "Save changes",
    result: bn ? "ফলাফল দিন" : "Set result",
    winner: bn ? "বিজয়ী" : "Winner",
    runner: bn ? "রানার-আপ" : "Runner-up",
    waitingRoom: bn ? "পরবর্তী রাউন্ডের অপেক্ষা" : "Waiting for the next round",
    prizeAdded: bn ? "পুরস্কার Winner Balance-এ যোগ হয়েছে" : "Prize added to Winner Balance",
    deleteConfirm: bn ? "টুর্নামেন্টটি মুছে ফেলবেন?" : "Delete this tournament?",
    fillBots: bn ? "Bot দিয়ে পূরণ" : "Fill bots",
    availableNow: bn ? "এখন খেলা যাবে" : "Available now",
    upcomingSection: bn ? "আসন্ন টুর্নামেন্ট" : "Upcoming tournaments",
    loginToJoin: bn ? "লগইন করে যোগ দিন" : "Login to join",
    loginToPreRegister: bn ? "লগইন করে প্রি-রেজিস্টার" : "Login to pre-register",
    viewOnly: bn ? "দেখার মোড — যোগ দিতে লগইন করুন" : "Viewing only — log in to join",
  };
  const [view, setView] = useState<TournamentView>("browse");
  const [filters, setFilters] = useState<TournamentFilters>(EMPTY_FILTERS);
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [serverTime, setServerTime] = useState(new Date().toISOString());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [details, setDetails] = useState<TournamentDetails | null>(null);
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [winnerOpen, setWinnerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TournamentForm>(EMPTY_FORM);
  const [gameSettings, setGameSettings] = useState<GameSettingsForm>({
    diceSpeed: "normal",
    tokenSpeed: "normal",
    voiceEnabled: true,
    voiceProvider: "jitsi",
  });
  const [showcaseSettings, setShowcaseSettings] =
    useState<ShowcaseSettingsForm>({
      enabled: true,
      count: 3,
      sizes: [8, 16, 32],
    });
  const [mixedAutoSettings, setMixedAutoSettings] =
    useState<MixedAutoSettingsForm>({
      enabled: true,
      countdownSeconds: 15,
    });
  const autoConnectingMatch = useRef<string | null>(null);

  const loadList = useCallback(async () => {
    const query = new URLSearchParams();
    if (filters.type) query.set("type", filters.type);
    if (filters.boardType) query.set("boardType", filters.boardType);
    if (filters.gameMode) query.set("gameMode", filters.gameMode);
    if (filters.status) query.set("status", filters.status);
    const result = await apiRequest<{
      tournaments: TournamentSummary[];
      serverTime: string;
    }>(`/api/tournaments${query.size ? `?${query}` : ""}`);
    setTournaments(result.tournaments);
    setServerTime(result.serverTime);
  }, [filters]);

  const loadDetails = useCallback(async (tournamentId: string) => {
    const result = await apiRequest<TournamentDetails>(
      `/api/tournaments/${tournamentId}`,
    );
    setDetails(result);
    setServerTime(result.serverTime);
  }, []);

  const reload = useCallback(async () => {
    await loadList();
    if (selectedId) await loadDetails(selectedId);
  }, [loadDetails, loadList, selectedId]);

  useEffect(() => {
    setLoading(true);
    loadList()
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "Load failed."),
      )
      .finally(() => setLoading(false));
  }, [loadList]);

  useEffect(() => {
    if (!user?.isAdmin) return;
    void Promise.all([
      apiRequest<{ settings: GameSettingsForm }>("/api/games/settings"),
      apiRequest<{ settings: ShowcaseSettingsForm }>(
        "/api/tournaments/admin/showcase/settings",
      ),
      apiRequest<{ settings: MixedAutoSettingsForm }>(
        "/api/tournaments/admin/mixed-auto/settings",
      ),
    ])
      .then(([gameResult, showcaseResult, mixedAutoResult]) => {
        setGameSettings(gameResult.settings);
        setShowcaseSettings(showcaseResult.settings);
        setMixedAutoSettings(mixedAutoResult.settings);
      })
      .catch(() => undefined);
  }, [user?.isAdmin]);

  useEffect(() => {
    if (!selectedId) {
      setDetails(null);
      return;
    }
    socket.emit("tournament:subscribe", selectedId);
    void loadDetails(selectedId).catch((caught) =>
      setError(caught instanceof Error ? caught.message : "Load failed."),
    );
    return () => {
      socket.emit("tournament:unsubscribe", selectedId);
    };
  }, [loadDetails, selectedId]);

  useEffect(() => {
    if (!authenticated || !user || user.isAdmin || !details) return;
    const ownActiveMatch = details.matches.find(
      (match) =>
        match.round === details.tournament.currentRound &&
        match.status === "active" &&
        match.players.some(({ user: player }) => player.id === user.id),
    );
    if (
      !ownActiveMatch ||
      details.currentEntry?.status !== "joined" ||
      autoConnectingMatch.current === ownActiveMatch.id
    ) {
      return;
    }
    autoConnectingMatch.current = ownActiveMatch.id;
    void apiRequest(`/api/tournaments/matches/${ownActiveMatch.id}/connect`, {
      method: "POST",
      body: "{}",
    })
      .then(() => navigate(`/game/${ownActiveMatch.id}`, { replace: true }))
      .catch((caught) => {
        autoConnectingMatch.current = null;
        setError(caught instanceof Error ? caught.message : "Match connection failed.");
      });
  }, [authenticated, details, navigate, user]);

  useEffect(() => {
    const onTournamentUpdate = () => void reload();
    const onReconnect = () => {
      if (selectedId) socket.emit("tournament:subscribe", selectedId);
      void reload();
    };
    const onMatchUpdate = (payload: { matchId?: string }) => {
      if (selectedId) void loadDetails(selectedId);
      if (snapshot && payload.matchId === snapshot.match.id) {
        void openMatch(snapshot.match.id);
      }
    };
    const onWinner = () => {
      setWinnerOpen(true);
      void refresh();
      void reload();
    };
    socket.on("tournament:update", onTournamentUpdate);
    socket.on("tournament:state", onTournamentUpdate);
    socket.on("tournament:join", onTournamentUpdate);
    socket.on("tournament:start", onTournamentUpdate);
    socket.on("tournament:bracket-update", onTournamentUpdate);
    socket.on("tournament:slot-update", onTournamentUpdate);
    socket.on("tournament:round-start", onTournamentUpdate);
    socket.on("lobby:player-waiting", onTournamentUpdate);
    socket.on("lobby:next-round-countdown", onTournamentUpdate);
    socket.on("lobby:round-start", onTournamentUpdate);
    socket.on("lobby:spectate", onTournamentUpdate);
    socket.on("match:update", onMatchUpdate);
    socket.on("winner:celebration", onWinner);
    socket.on("connect", onReconnect);
    return () => {
      socket.off("tournament:update", onTournamentUpdate);
      socket.off("tournament:state", onTournamentUpdate);
      socket.off("tournament:join", onTournamentUpdate);
      socket.off("tournament:start", onTournamentUpdate);
      socket.off("tournament:bracket-update", onTournamentUpdate);
      socket.off("tournament:slot-update", onTournamentUpdate);
      socket.off("tournament:round-start", onTournamentUpdate);
      socket.off("lobby:player-waiting", onTournamentUpdate);
      socket.off("lobby:next-round-countdown", onTournamentUpdate);
      socket.off("lobby:round-start", onTournamentUpdate);
      socket.off("lobby:spectate", onTournamentUpdate);
      socket.off("match:update", onMatchUpdate);
      socket.off("winner:celebration", onWinner);
      socket.off("connect", onReconnect);
    };
  }, [loadDetails, refresh, reload, selectedId, snapshot]);

  useEffect(() => {
    const current = tournaments.find((item) => item.isCurrent);
    if (view === "bracket" && !selectedId && (current || tournaments[0])) {
      setSelectedId((current || tournaments[0])!.id);
    }
  }, [selectedId, tournaments, view]);

  useEffect(() => {
    if (!authenticated) return;
    const joinedCurrent = tournaments.find(
      (item) =>
        item.isCurrent && item.currentEntryStatus === "joined",
    );
    if (joinedCurrent && selectedId !== joinedCurrent.id) {
      setSelectedId(joinedCurrent.id);
    }
  }, [authenticated, selectedId, tournaments]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 2800);
    return () => window.clearTimeout(timer);
  }, [message]);

  const runAction = async (
    key: string,
    action: () => Promise<unknown>,
    success: string,
  ) => {
    setBusy(key);
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(success);
      await refresh();
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Action failed.");
    } finally {
      setBusy("");
    }
  };

  const protectedAction = (action: () => void) => {
    if (!authenticated) {
      onProtected();
      return;
    }
    action();
  };

  const performJoin = (tournament: TournamentSummary) =>
    void runAction(
      `join-${tournament.id}`,
      () =>
        apiRequest(`/api/tournaments/${tournament.id}/join`, {
          method: "POST",
        }),
      bn ? "টুর্নামেন্টে যোগ দিয়েছেন" : "Tournament joined",
    );

  const join = (tournament: TournamentSummary) =>
    protectedAction(() => performJoin(tournament));

  const preRegister = (tournament: TournamentSummary) =>
    protectedAction(() =>
      void runAction(
        `pre-${tournament.id}`,
        () =>
          apiRequest(`/api/tournaments/${tournament.id}/pre-register`, {
            method: "POST",
            body: "{}",
          }),
        bn ? "Pre-registration সম্পন্ন" : "Pre-registration complete",
      ),
    );

  const leave = (tournament: TournamentSummary) =>
    void runAction(
      `leave-${tournament.id}`,
      () =>
        apiRequest(`/api/tournaments/${tournament.id}/leave`, {
          method: "POST",
          body: "{}",
        }),
      bn ? "টুর্নামেন্ট থেকে বের হয়েছেন" : "You left the tournament",
    );

  const openTournament = (id: string) => {
    setSelectedId(id);
    setView("bracket");
    setSnapshot(null);
  };

  const openMatch = async (matchId: string) => {
    navigate(`/game/${matchId}`);
  };

  const connectMatch = (matchId: string) =>
    protectedAction(() =>
      void runAction(
        `connect-${matchId}`,
        () =>
          apiRequest(`/api/tournaments/matches/${matchId}/connect`, {
            method: "POST",
            body: "{}",
          }).then((result) => {
            navigate(`/game/${matchId}`);
            return result;
          }),
        bn ? "ম্যাচে সংযুক্ত হয়েছেন" : "Connected to match",
      ),
    );

  const editTournament = (tournament: TournamentSummary) => {
    setEditingId(tournament.id);
    setForm({
      title: tournament.title,
      playerCount: String(tournament.playerCount) as TournamentForm["playerCount"],
      boardType: tournament.boardType,
      gameMode: tournament.gameMode,
      type: tournament.type,
      joinFee: tournament.joinFee,
      prizePool: tournament.prizePool,
      adminCommission: tournament.adminCommission,
      prizeFirst: tournament.prizeFirst,
      prizeSecond: tournament.prizeSecond,
      playerType: tournament.playerType,
      countdownDuration: String(tournament.countdownDuration),
      betweenRoundSeconds: String(tournament.betweenRoundSeconds),
      status: tournament.status === "upcoming" ? "upcoming" : "waiting",
      startsAt: toLocalInput(tournament.startsAt),
    });
    setView("admin");
  };

  const saveTournament = (event: FormEvent) => {
    event.preventDefault();
    const payload = {
      ...form,
      playerCount: Number(form.playerCount),
      joinFee: form.type === "free" ? 0 : Number(form.joinFee),
      prizePool: Number(form.prizePool),
      adminCommission: Number(form.adminCommission),
      prizeFirst: Number(form.prizeFirst),
      prizeSecond: Number(form.prizeSecond),
      countdownDuration: Number(form.countdownDuration),
      betweenRoundSeconds: Number(form.betweenRoundSeconds),
      startsAt:
        form.status === "upcoming" && form.startsAt
          ? new Date(form.startsAt).toISOString()
          : null,
    };
    void runAction(
      "save",
      () =>
        apiRequest(
          editingId
            ? `/api/tournaments/admin/${editingId}`
            : "/api/tournaments/admin",
          {
            method: editingId ? "PATCH" : "POST",
            body: JSON.stringify(payload),
          },
        ),
      editingId
        ? bn
          ? "টুর্নামেন্ট আপডেট হয়েছে"
          : "Tournament updated"
        : bn
          ? "টুর্নামেন্ট তৈরি হয়েছে"
          : "Tournament created",
    ).then(() => {
      setEditingId(null);
      setForm(EMPTY_FORM);
    });
  };

  const deleteTournament = (tournamentId: string) => {
    if (!window.confirm(copy.deleteConfirm)) return;
    void runAction(
      `delete-${tournamentId}`,
      () =>
        apiRequest(`/api/tournaments/admin/${tournamentId}`, {
          method: "DELETE",
        }),
      bn ? "টুর্নামেন্ট মুছে ফেলা হয়েছে" : "Tournament deleted",
    );
  };

  const fillBots = (tournamentId: string) =>
    void runAction(
      `fill-${tournamentId}`,
      () =>
        apiRequest(`/api/bots/admin/tournaments/${tournamentId}/fill`, {
          method: "POST",
          body: "{}",
        }),
      bn ? "Bot slot যোগ হয়েছে" : "Bot slots filled",
    );

  const saveGameSettings = () =>
    void runAction(
      "game-settings",
      () =>
        apiRequest("/api/games/admin/settings", {
          method: "PATCH",
          body: JSON.stringify(gameSettings),
        }),
      bn ? "গেম সেটিংস সংরক্ষিত" : "Game settings saved",
    );

  const saveShowcaseSettings = () =>
    void runAction(
      "showcase-settings",
      () =>
        apiRequest("/api/tournaments/admin/showcase/settings", {
          method: "PUT",
          body: JSON.stringify({
            ...showcaseSettings,
            sizes: showcaseSettings.sizes.map(String),
          }),
        }),
      bn
        ? "Auto showcase settings সংরক্ষিত"
        : "Auto showcase settings saved",
    );

  const saveMixedAutoSettings = () =>
    void runAction(
      "mixed-auto-settings",
      () =>
        apiRequest("/api/tournaments/admin/mixed-auto/settings", {
          method: "PUT",
          body: JSON.stringify(mixedAutoSettings),
        }),
      bn
        ? "Mixed auto lobby settings সংরক্ষিত"
        : "Mixed auto lobby settings saved",
    );

  const completeMatch = (match: TournamentMatch) => {
    const playerList = match.players
      .map(({ user: player }) => `${player.gameId}: ${player.name}`)
      .join("\n");
    const winnerGameId = window.prompt(
      `${copy.winner} Game ID:\n${playerList}`,
    );
    if (!winnerGameId) return;
    const winner = match.players.find(
      ({ user: player }) => player.gameId === winnerGameId.trim(),
    );
    if (!winner) {
      setError(bn ? "সঠিক winner Game ID দিন" : "Enter a valid winner Game ID");
      return;
    }
    const placements = [winner.user.id];
    if (details?.tournament.boardType === "4p") {
      const runnerGameId = window.prompt(
        `${copy.runner} Game ID:\n${playerList}`,
      );
      const runner = match.players.find(
        ({ user: player }) =>
          player.gameId === runnerGameId?.trim() && player.id !== winner.user.id,
      );
      if (!runner) {
        setError(bn ? "সঠিক runner-up Game ID দিন" : "Enter a valid runner-up Game ID");
        return;
      }
      placements.push(runner.user.id);
    } else {
      const runner = match.players.find(
        ({ user: player }) => player.id !== winner.user.id,
      );
      if (runner) placements.push(runner.user.id);
    }
    void runAction(
      `result-${match.id}`,
      () =>
        apiRequest(`/api/tournaments/admin/matches/${match.id}/complete`, {
          method: "POST",
          body: JSON.stringify({ placements }),
        }),
      bn ? "ম্যাচ ফলাফল সংরক্ষিত" : "Match result saved",
    );
  };

  const currentTournament = tournaments.find((item) => item.isCurrent);
  const visibleTournaments = sortTournamentsForUser(tournaments);
  const upcomingTournaments = visibleTournaments.filter(
    (item) => item.status === "upcoming",
  );
  const availableTournaments = visibleTournaments.filter(
    (item) => item.status !== "upcoming",
  );

  const renderTournamentCard = (tournament: TournamentSummary) => (
    <TournamentListCard
      key={tournament.id}
      tournament={tournament}
      serverTime={serverTime}
      currentLabel={copy.current}
      labels={copy}
      logoUrl={logoUrl}
      busy={busy}
      authenticated={authenticated}
      onOpen={() => openTournament(tournament.id)}
      onJoin={() => join(tournament)}
      onPreRegister={() => preRegister(tournament)}
      onLeave={() => leave(tournament)}
      onEdit={
        user?.isAdmin &&
        (tournament.status === "upcoming" ||
          tournament.status === "waiting")
          ? () => editTournament(tournament)
          : undefined
      }
    />
  );

  return (
    <main className="page tournament-page tournament-page--premium">
      <nav className={`tournament-tabs glass ${user?.isAdmin ? "has-admin" : ""}`}>
        <button
          className={view === "browse" ? "active" : ""}
          onClick={() => setView("browse")}
        >
          <Swords size={15} /> {copy.browse}
        </button>
        <button
          className={view === "bracket" ? "active" : ""}
          onClick={() => setView("bracket")}
        >
          <Trophy size={15} /> {copy.bracket}
        </button>
        {user?.isAdmin && (
          <button
            className={view === "admin" ? "active" : ""}
            onClick={() => setView("admin")}
          >
            <ShieldCheck size={15} /> {copy.admin}
          </button>
        )}
      </nav>

      {view === "browse" && (
        <section className="tournament-browse">
          <div className="tournament-filter glass">
            <span><Filter size={13} /> {copy.filters}</span>
            <select
              value={filters.type}
              onChange={(event) =>
                setFilters((value) => ({
                  ...value,
                  type: event.target.value as TournamentFilters["type"],
                }))
              }
            >
              <option value="">{copy.all} {t("free")}/{t("paid")}</option>
              <option value="free">{t("free")}</option>
              <option value="paid">{t("paid")}</option>
            </select>
            <select
              value={filters.boardType}
              onChange={(event) =>
                setFilters((value) => ({
                  ...value,
                  boardType: event.target.value as TournamentFilters["boardType"],
                }))
              }
            >
              <option value="">{copy.all} board</option>
              <option value="2p">2 Player</option>
              <option value="4p">4 Player</option>
            </select>
            <select
              value={filters.gameMode}
              onChange={(event) =>
                setFilters((value) => ({
                  ...value,
                  gameMode: event.target.value as TournamentFilters["gameMode"],
                }))
              }
            >
              <option value="">{copy.all} mode</option>
              <option value="classic">{t("classic")}</option>
              <option value="quick">{t("quick")}</option>
              <option value="master">{t("master")}</option>
            </select>
            <select
              value={filters.status}
              onChange={(event) =>
                setFilters((value) => ({
                  ...value,
                  status: event.target.value as TournamentFilters["status"],
                }))
              }
            >
              <option value="">{copy.all} status</option>
              <option value="upcoming">{t("upcoming")}</option>
              <option value="waiting">{copy.waiting}</option>
              <option value="active">{copy.active}</option>
              <option value="completed">{copy.completed}</option>
            </select>
            {Object.values(filters).some(Boolean) && (
              <button onClick={() => setFilters(EMPTY_FILTERS)} aria-label="Clear filters">
                <X size={13} />
              </button>
            )}
          </div>
          <div className="tournament-list">
            {loading && (
              <div className="tournament-empty glass">
                <LoaderCircle className="spin" size={24} />
              </div>
            )}
            {!loading && visibleTournaments.length === 0 && (
              <div className="tournament-empty glass">{copy.noTournament}</div>
            )}
            {!loading && availableTournaments.length > 0 && (
              <section className="tournament-list-section">
                <h2><Radio size={14} /> {copy.availableNow}</h2>
                <div className="tournament-list-grid">
                  {availableTournaments.map(renderTournamentCard)}
                </div>
              </section>
            )}
            {!loading && upcomingTournaments.length > 0 && (
              <section className="tournament-list-section tournament-list-section--upcoming">
                <h2><CalendarClock size={14} /> {copy.upcomingSection}</h2>
                <div className="tournament-list-grid">
                  {upcomingTournaments.map(renderTournamentCard)}
                </div>
              </section>
            )}
          </div>
        </section>
      )}

      {view === "bracket" && (
        <TournamentBracket
          details={details}
          snapshot={snapshot}
          userId={user?.id}
          authenticated={authenticated}
          busy={busy}
          labels={copy}
          language={i18n.language}
          onBack={() => {
            setView("browse");
            setSnapshot(null);
          }}
          onOpenMatch={(matchId) => void openMatch(matchId)}
          onConnect={connectMatch}
          onJoin={() => details && join(details.tournament)}
          onPreRegister={() => details && preRegister(details.tournament)}
          onLeave={() => details && leave(details.tournament)}
          onResult={user?.isAdmin ? completeMatch : undefined}
        />
      )}

      {view === "admin" && user?.isAdmin && (
        <TournamentAdmin
          form={form}
          setForm={setForm}
          editingId={editingId}
          tournaments={tournaments}
          busy={busy}
          labels={copy}
          gameSettings={gameSettings}
          setGameSettings={setGameSettings}
          onSaveGameSettings={saveGameSettings}
          showcaseSettings={showcaseSettings}
          setShowcaseSettings={setShowcaseSettings}
          onSaveShowcaseSettings={saveShowcaseSettings}
          mixedAutoSettings={mixedAutoSettings}
          setMixedAutoSettings={setMixedAutoSettings}
          onSaveMixedAutoSettings={saveMixedAutoSettings}
          onSubmit={saveTournament}
          onNew={() => {
            setEditingId(null);
            setForm(EMPTY_FORM);
          }}
          onEdit={editTournament}
          onDelete={deleteTournament}
          onFillBots={fillBots}
        />
      )}

      {(error || message) && (
        <button
          className={`tournament-toast ${error ? "error" : ""}`}
          onClick={() => {
            setError("");
            setMessage("");
          }}
        >
          {error || message}
        </button>
      )}

      {winnerOpen && (
        <div className="winner-celebration" role="dialog" aria-modal="true">
          <div className="winner-confetti" />
          <Crown size={54} />
          <h2>{copy.winner}!</h2>
          <p>{copy.prizeAdded}</p>
          <button onClick={() => setWinnerOpen(false)}>
            <Check size={16} /> OK
          </button>
        </div>
      )}
    </main>
  );
}

function TournamentListCard({
  tournament,
  serverTime,
  currentLabel,
  labels,
  logoUrl,
  busy,
  authenticated,
  onOpen,
  onJoin,
  onPreRegister,
  onLeave,
  onEdit,
}: {
  tournament: TournamentSummary;
  serverTime: string;
  currentLabel: string;
  labels: Record<string, string>;
  logoUrl: string;
  busy: string;
  authenticated: boolean;
  onOpen: () => void;
  onJoin: () => void;
  onPreRegister: () => void;
  onLeave: () => void;
  onEdit?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const countdown = useCountdown(
    tournament.countdownEndsAt ?? tournament.startsAt,
    serverTime,
  );
  const timerText = tournament.status === "active" ? "LIVE" : countdown;
  const joined = tournament.currentEntryStatus === "joined";
  const preRegistered = tournament.currentEntryStatus === "pre_registered";
  const leaveAllowed = canLeaveTournament(tournament);
  const mixedAuto = isMixedAutoLobby(tournament);
  return (
    <article
      data-tournament-type={tournament.type}
      className={`tournament-list-card glass status-${tournament.status} ${
        joined ? "joined" : ""
      } ${tournament.isCurrent ? "current" : ""} ${
        tournament.isShowcase ? "showcase-card" : ""
      }`}
    >
      {joined && (
        <button type="button" className="tournament-joined-ribbon" tabIndex={-1}>
          <UserRoundCheck size={11} /> {labels.joined}
        </button>
      )}
      <TournamentArtwork
        tournamentId={tournament.id}
        title={tournament.title}
        logoUrl={logoUrl}
      />
      <div className="tournament-list-card__head" onClick={onOpen}>
        <span className="tournament-badges">
          {tournament.isShowcase && <i className="showcase">LIVE DEMO</i>}
          {mixedAuto && <i className="mixed-auto">MIXED 16P</i>}
          <i>{t(tournament.gameMode)}</i>
          <i>{t(tournament.type)}</i>
          <i>{tournament.boardType.toUpperCase()}</i>
          <i className={tournament.status}>{labels[tournament.status] || t(tournament.status)}</i>
        </span>
        <strong className="tournament-list-card__title">
          {tournament.title}
        </strong>
        <strong className="tournament-prize-glow">
          <Crown size={16} /> {money(tournament.prizePool)}
        </strong>
      </div>
      <div className="tournament-card-stats">
        <span>
          <UsersRound size={12} />
          <strong>{tournament.joinedCount ?? 0}/{tournament.playerCount}</strong>
          <small>{labels.slots}</small>
        </span>
        <span>
          <Clock3 size={12} />
          <strong>{timerText}</strong>
          <small>{labels.timer}</small>
        </span>
        <span>
          <Gamepad2 size={12} />
          <strong>{tournament.type === "free" ? t("free") : money(tournament.joinFee)}</strong>
          <small>{labels.fee}</small>
        </span>
      </div>
      <div
        className={`tournament-card-actions${
          joined && tournament.status === "waiting" && !leaveAllowed
            ? " tournament-card-actions--joined-locked"
            : joined
              ? " tournament-card-actions--joined"
              : ""
        }`}
      >
        <button onClick={onOpen}><Eye size={13} /> {labels.details}</button>
        {tournament.status === "upcoming" && (
          <button
            className="primary"
            disabled={
              authenticated &&
              (preRegistered || busy === `pre-${tournament.id}`)
            }
            onClick={onPreRegister}
          >
            {authenticated && preRegistered ? (
              <Check size={13} />
            ) : authenticated ? (
              <CalendarClock size={13} />
            ) : (
              <LogIn size={13} />
            )}
            {authenticated && preRegistered
              ? t("preRegistered")
              : authenticated
                ? t("preRegister")
                : labels.loginToPreRegister}
          </button>
        )}
        {tournament.status === "waiting" && !joined && !tournament.isShowcase && (
          <button
            className="primary tournament-join-button"
            disabled={
              authenticated &&
              (busy === `join-${tournament.id}` ||
                (tournament.joinedCount ?? 0) >= tournament.playerCount)
            }
            onClick={onJoin}
          >
            {authenticated ? (
              <UserRoundCheck size={13} />
            ) : (
              <LogIn size={13} />
            )}{" "}
            {authenticated ? labels.join : labels.loginToJoin}
          </button>
        )}
        {tournament.isShowcase && (
          <span className="showcase-watch-label">
            <Bot size={13} /> BOT SHOWCASE
          </span>
        )}
        {tournament.status === "waiting" && joined && leaveAllowed && (
          <button
            className="tournament-leave-button tournament-leave-button--list"
            disabled={busy === `leave-${tournament.id}`}
            onClick={onLeave}
          >
            <X size={14} /> {labels.leave}
          </button>
        )}
        {tournament.status === "waiting" && joined && !leaveAllowed && (
          <>
            <div className="tournament-joined-status">
              <UserRoundCheck size={13} />
              <span>{labels.joinedBanner}</span>
            </div>
            <span className="tournament-leave-locked">
              <Clock3 size={14} />
              <span>
                <strong>{labels.leaveLockedTitle}</strong>
                <small>{labels.leaveLockedHint}</small>
              </span>
            </span>
          </>
        )}
      </div>
      {onEdit && (
        <button
          type="button"
          className="tournament-card-edit-button"
          onClick={onEdit}
          aria-label={labels.edit ?? "Edit"}
        >
          <Pencil size={14} />
        </button>
      )}
    </article>
  );
}

function TournamentBracket({
  details,
  snapshot,
  userId,
  authenticated,
  busy,
  labels,
  language,
  onBack,
  onOpenMatch,
  onConnect,
  onJoin,
  onPreRegister,
  onLeave,
  onResult,
}: {
  details: TournamentDetails | null;
  snapshot: MatchSnapshot | null;
  userId?: string | undefined;
  authenticated: boolean;
  busy: string;
  labels: Record<string, string>;
  language: string;
  onBack: () => void;
  onOpenMatch: (matchId: string) => void;
  onConnect: (matchId: string) => void;
  onJoin: () => void;
  onPreRegister: () => void;
  onLeave: () => void;
  onResult?: ((match: TournamentMatch) => void) | undefined;
}) {
  const { t } = useTranslation();
  const countdown = useCountdown(
    details?.tournament.nextRoundAt ??
      details?.tournament.countdownEndsAt ??
      details?.tournament.startsAt ??
      null,
    details?.serverTime ?? new Date(0).toISOString(),
  );
  const ownMatch = details?.matches.find(
    (match) =>
      match.round === details.tournament.currentRound &&
      match.players.some(({ user }) => user.id === userId),
  );
  if (!details) {
    return <div className="tournament-empty glass"><LoaderCircle className="spin" size={24} /></div>;
  }
  const { tournament } = details;
  const timerText =
    tournament.status === "active" && !tournament.nextRoundAt
      ? "LIVE"
      : countdown;
  const rounds = Array.from(
    new Set(details.matches.map((match) => match.round)),
  ).sort((a, b) => a - b);
  const joined = details.currentEntry?.status === "joined";
  const leaveAllowed = canLeaveTournament(tournament);
  const joinedPlayers = details.entries.filter(
    ({ entry }) => entry.status === "joined",
  );
  const showWaitingRoom =
    rounds.length === 0 && tournament.status === "waiting";
  const showGuestHint =
    !authenticated &&
    !joined &&
    (tournament.status === "waiting" || tournament.status === "upcoming");
  return (
    <section
      className={`tournament-detail tournament-detail--bracket${
        joined ? " joined" : ""
      }`}
    >
      <header className="bracket-toolbar glass">
        <div className="bracket-toolbar__top">
          <button onClick={onBack} aria-label="Back"><ArrowLeft size={14} /></button>
          <div className="bracket-toolbar__title">
            <span className="tournament-badges">
              <i>{t(tournament.gameMode)}</i>
              <i>{t(tournament.type)}</i>
              <i>{tournament.boardType.toUpperCase()}</i>
              <i className={tournament.status}>{labels[tournament.status]}</i>
            </span>
            <h1>{tournament.title}</h1>
          </div>
          <strong className="bracket-toolbar__prize">
            <Crown size={13} /> {money(tournament.prizePool)}
          </strong>
        </div>
        <div className="bracket-toolbar__stats">
          <span>
            <UsersRound size={14} />
            <strong>{details.joinedCount}/{tournament.playerCount}</strong>
            <small>{labels.slots}</small>
          </span>
          <span>
            <Trophy size={14} />
            <strong>{tournament.currentRound}/{tournament.totalRounds}</strong>
            <small>{labels.match}</small>
          </span>
          <span>
            <Clock3 size={14} />
            <strong>{timerText}</strong>
            <small>{labels.timer}</small>
          </span>
          <span>
            <Gamepad2 size={14} />
            <strong>{tournament.type === "free" ? t("free") : money(tournament.joinFee)}</strong>
            <small>{labels.fee}</small>
          </span>
        </div>
      </header>

      {(showGuestHint || ownMatch || tournament.nextRoundAt) && (
        <div className="bracket-alerts">
          {showGuestHint && (
            <p className="bracket-guest-hint glass">
              <LogIn size={12} /> {labels.viewOnly}
            </p>
          )}
          {ownMatch && ownMatch.status !== "completed" && (
            <div className="own-match-callout glass">
              <Sparkles size={14} />
              <span className="own-match-callout__text">
                <strong>{labels.matchReady}</strong>
              </span>
              <button onClick={() => onOpenMatch(ownMatch.id)}>
                <Gamepad2 size={12} /> {labels.play}
              </button>
            </div>
          )}
          {tournament.nextRoundAt && !showWaitingRoom && (
            <div className="round-waiting glass">
              <Clock3 size={14} />
              <span><strong>{labels.waitingRoom}</strong><small>{countdown}</small></span>
            </div>
          )}
        </div>
      )}

      {tournament.status === "waiting" && !tournament.isShowcase && !joined && (
        <div className="tournament-detail-actions glass bracket-join-bar">
          <button
            className="primary tournament-join-button"
            disabled={
              authenticated &&
              (busy.startsWith("join-") ||
                details.joinedCount >= tournament.playerCount)
            }
            onClick={onJoin}
          >
            {authenticated ? <UserRoundCheck size={13} /> : <LogIn size={13} />}
            {authenticated ? labels.join : labels.loginToJoin}
          </button>
        </div>
      )}
      {tournament.status === "upcoming" && (
        <div className="tournament-detail-actions glass bracket-join-bar">
          {authenticated && (
            <span>{localDateTime(tournament.startsAt, language)}</span>
          )}
          <button
            className="primary"
            disabled={
              authenticated && details.currentEntry?.status === "pre_registered"
            }
            onClick={onPreRegister}
          >
            {authenticated ? <CalendarClock size={13} /> : <LogIn size={13} />}
            {authenticated
              ? details.currentEntry?.status === "pre_registered"
                ? t("preRegistered")
                : t("preRegister")
              : labels.loginToPreRegister}
          </button>
        </div>
      )}

      {snapshot && (
        <div className="spectator-room spectator-room--compact glass">
          <header>
            <span><Eye size={12} /> {labels.spectate}</span>
            <i className={snapshot.match.status}><Radio size={8} /> {snapshot.match.status}</i>
          </header>
          <div className="spectator-board">
            {snapshot.players.map(({ participant, user: player }) => (
              <div key={player.id} className={participant.isEliminated ? "eliminated" : ""}>
                <img src={resolvedAvatar(player.avatar, player.gameId)} alt="" />
                <strong>
                  {player.name}
                  {player.isBot && <em className="player-bot-badge">BOT</em>}
                </strong>
                <small>#{player.gameId}</small>
                {participant.placement && <b>#{participant.placement}</b>}
              </div>
            ))}
            <span><Swords size={18} /></span>
          </div>
        </div>
      )}

      <div className="bracket-stage">
        <div
          className={`bracket-scroll ${
            rounds.length === 0
              ? "bracket-scroll--empty"
              : "bracket-scroll--tree bracket-scroll--filled"
          }`}
        >
          {rounds.length === 0 ? (
            <div className="bracket-empty-state glass">
              {showWaitingRoom ? (
                <div className="bracket-waiting-room">
                  <div className="bracket-waiting-room__status">
                    <div className="bracket-waiting-room__head">
                      <Clock3 size={20} />
                      <strong>{labels.waiting}</strong>
                    </div>
                    <span className="bracket-waiting-room__timer">{countdown}</span>
                    <small className="bracket-waiting-room__slots">
                      {joinedPlayers.length}/{tournament.playerCount} {labels.players}
                    </small>
                  </div>
                  {joinedPlayers.length > 0 && (
                    <div className="bracket-waiting-room__players">
                      {joinedPlayers.map(({ entry, user: player }) => (
                        <article
                          key={entry.id}
                          title={`${player.name} · ID ${player.gameId}`}
                        >
                          <img
                            src={resolvedAvatar(player.avatar, player.gameId)}
                            alt=""
                          />
                          <span>
                            <strong>{player.name}</strong>
                            <small>#{player.gameId}</small>
                          </span>
                          {player.isBot && (
                            <em className="player-bot-badge">BOT</em>
                          )}
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="bracket-empty-state__message">{labels.noTournament}</p>
              )}
              {joined && tournament.status === "waiting" && !tournament.isShowcase && leaveAllowed && (
                <button
                  className="tournament-leave-button tournament-leave-button--compact"
                  disabled={busy.startsWith("leave-")}
                  onClick={onLeave}
                >
                  <X size={16} />
                  {labels.leave}
                </button>
              )}
              {joined && tournament.status === "waiting" && !tournament.isShowcase && !leaveAllowed && (
                <div className="bracket-joined-footer">
                  <div className="tournament-joined-status">
                    <UserRoundCheck size={14} />
                    <span>{labels.joinedBanner}</span>
                  </div>
                  <p className="tournament-countdown-lock">
                    <Clock3 size={14} />
                    <span>
                      <strong>{labels.leaveLockedTitle}</strong>
                      <small>{labels.leaveLockedHint}</small>
                    </span>
                  </p>
                </div>
              )}
            </div>
          ) : (
            <TournamentBracketTree
              details={details}
              language={language}
              userId={userId}
              onOpenMatch={onOpenMatch}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function TournamentAdmin({
  form,
  setForm,
  editingId,
  tournaments,
  busy,
  labels,
  gameSettings,
  setGameSettings,
  onSaveGameSettings,
  showcaseSettings,
  setShowcaseSettings,
  onSaveShowcaseSettings,
  mixedAutoSettings,
  setMixedAutoSettings,
  onSaveMixedAutoSettings,
  onSubmit,
  onNew,
  onEdit,
  onDelete,
  onFillBots,
}: {
  form: TournamentForm;
  setForm: React.Dispatch<React.SetStateAction<TournamentForm>>;
  editingId: string | null;
  tournaments: TournamentSummary[];
  busy: string;
  labels: Record<string, string>;
  gameSettings: GameSettingsForm;
  setGameSettings: React.Dispatch<React.SetStateAction<GameSettingsForm>>;
  onSaveGameSettings: () => void;
  showcaseSettings: ShowcaseSettingsForm;
  setShowcaseSettings: React.Dispatch<
    React.SetStateAction<ShowcaseSettingsForm>
  >;
  onSaveShowcaseSettings: () => void;
  mixedAutoSettings: MixedAutoSettingsForm;
  setMixedAutoSettings: React.Dispatch<
    React.SetStateAction<MixedAutoSettingsForm>
  >;
  onSaveMixedAutoSettings: () => void;
  onSubmit: (event: FormEvent) => void;
  onNew: () => void;
  onEdit: (tournament: TournamentSummary) => void;
  onDelete: (id: string) => void;
  onFillBots: (id: string) => void;
}) {
  const set = <K extends keyof TournamentForm>(key: K, value: TournamentForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  return (
    <section className="tournament-admin">
      <div className="tournament-game-settings glass">
        <span><Gamepad2 size={14} /> Live game</span>
        <label>
          Dice
          <select
            value={gameSettings.diceSpeed}
            onChange={(event) =>
              setGameSettings((value) => ({
                ...value,
                diceSpeed: event.target.value as GameSettingsForm["diceSpeed"],
              }))
            }
          >
            <option value="fast">Fast</option>
            <option value="normal">Normal</option>
            <option value="slow">Slow</option>
          </select>
        </label>
        <label>
          Token
          <select
            value={gameSettings.tokenSpeed}
            onChange={(event) =>
              setGameSettings((value) => ({
                ...value,
                tokenSpeed: event.target.value as GameSettingsForm["tokenSpeed"],
              }))
            }
          >
            <option value="fast">Fast</option>
            <option value="normal">Normal</option>
            <option value="slow">Slow</option>
          </select>
        </label>
        <label className="voice-toggle">
          <input
            type="checkbox"
            checked={gameSettings.voiceEnabled}
            onChange={(event) =>
              setGameSettings((value) => ({
                ...value,
                voiceEnabled: event.target.checked,
              }))
            }
          />
          Jitsi voice
        </label>
        <button
          type="button"
          disabled={busy === "game-settings"}
          onClick={onSaveGameSettings}
        >
          <Check size={13} /> Save
        </button>
      </div>
      <section className="tournament-showcase-settings glass">
        <header>
          <span>
            <Radio size={14} />
            <strong>Auto live showcase</strong>
          </span>
          <small>
            Bot-only demo tournaments keep the lobby visibly active. Players
            can watch but cannot join.
          </small>
        </header>
        <label className="voice-toggle">
          <input
            type="checkbox"
            checked={showcaseSettings.enabled}
            onChange={(event) =>
              setShowcaseSettings((current) => ({
                ...current,
                enabled: event.target.checked,
              }))
            }
          />
          Enable continuous showcase
        </label>
        <label>
          Concurrent tournaments
          <select
            value={showcaseSettings.count}
            onChange={(event) =>
              setShowcaseSettings((current) => ({
                ...current,
                count: Number(event.target.value) as 3 | 4 | 5,
              }))
            }
          >
            <option value="3">3 live</option>
            <option value="4">4 live</option>
            <option value="5">5 live</option>
          </select>
        </label>
        <fieldset>
          <legend>Rotate player sizes</legend>
          {([4, 8, 16, 32, 64] as const).map((size) => (
            <label key={size}>
              <input
                type="checkbox"
                checked={showcaseSettings.sizes.includes(size)}
                onChange={(event) =>
                  setShowcaseSettings((current) => ({
                    ...current,
                    sizes: event.target.checked
                      ? [...current.sizes, size].sort((a, b) => a - b)
                      : current.sizes.filter((value) => value !== size),
                  }))
                }
              />
              {size} players
            </label>
          ))}
        </fieldset>
        <button
          type="button"
          disabled={
            busy === "showcase-settings" ||
            showcaseSettings.sizes.length === 0
          }
          onClick={onSaveShowcaseSettings}
        >
          <Sparkles size={13} /> Save and start
        </button>
      </section>
      <section className="tournament-showcase-settings glass">
        <header>
          <span>
            <UsersRound size={14} />
            <strong>Auto mixed 16P lobby</strong>
          </span>
          <small>
            15 bots + open slots. Real player join starts a 15s countdown,
            then 4×4p boards run. A fresh lobby auto-creates after finish.
          </small>
        </header>
        <label className="voice-toggle">
          <input
            type="checkbox"
            checked={mixedAutoSettings.enabled}
            onChange={(event) =>
              setMixedAutoSettings((current) => ({
                ...current,
                enabled: event.target.checked,
              }))
            }
          />
          Enable mixed auto lobby
        </label>
        <label>
          Countdown after join (seconds)
          <select
            value={mixedAutoSettings.countdownSeconds}
            onChange={(event) =>
              setMixedAutoSettings((current) => ({
                ...current,
                countdownSeconds: Number(event.target.value),
              }))
            }
          >
            <option value="15">15 seconds</option>
            <option value="30">30 seconds</option>
            <option value="60">60 seconds</option>
          </select>
        </label>
        <button
          type="button"
          disabled={busy === "mixed-auto-settings"}
          onClick={onSaveMixedAutoSettings}
        >
          <Sparkles size={13} /> Save and start
        </button>
      </section>
      <form className="tournament-admin-form glass" onSubmit={onSubmit}>
        <header>
          <span><ShieldCheck size={15} /> {editingId ? labels.update : labels.create}</span>
          <button type="button" onClick={onNew}><Plus size={14} /> New</button>
        </header>
        <div className="tournament-form-grid">
          <label className="wide">Title<input required minLength={3} value={form.title} onChange={(e) => set("title", e.target.value)} /></label>
          <label>Players<select value={form.playerCount} onChange={(e) => set("playerCount", e.target.value as TournamentForm["playerCount"])}>{["2","4","8","16","32","64"].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label>Board<select value={form.boardType} onChange={(e) => set("boardType", e.target.value as TournamentForm["boardType"])}><option value="2p">2 Player</option><option value="4p">4 Player</option></select></label>
          <label>Mode<select value={form.gameMode} onChange={(e) => set("gameMode", e.target.value as TournamentForm["gameMode"])}><option value="classic">Classic</option><option value="quick">Quick</option><option value="master">Master</option></select></label>
          <label>Type<select value={form.type} onChange={(e) => set("type", e.target.value as TournamentForm["type"])}><option value="paid">Paid</option><option value="free">Free</option></select></label>
          <label>Join fee<input type="number" min="0" step="0.01" disabled={form.type === "free"} value={form.type === "free" ? "0" : form.joinFee} onChange={(e) => set("joinFee", e.target.value)} /></label>
          <label>Prize pool<input required type="number" min="0" step="0.01" value={form.prizePool} onChange={(e) => set("prizePool", e.target.value)} /></label>
          <label>Admin %<input required type="number" min="0" max="100" value={form.adminCommission} onChange={(e) => set("adminCommission", e.target.value)} /></label>
          <label>1st %<input required type="number" min="0" max="100" value={form.prizeFirst} onChange={(e) => set("prizeFirst", e.target.value)} /></label>
          <label>2nd %<input required type="number" min="0" max="100" value={form.prizeSecond} onChange={(e) => set("prizeSecond", e.target.value)} /></label>
          <label>Players<select value={form.playerType} onChange={(e) => set("playerType", e.target.value as TournamentForm["playerType"])}><option value="real">Real only</option><option value="bot">Bots only</option><option value="mixed">Mixed</option></select></label>
          <label>Countdown<input required type="number" min="10" max="86400" value={form.countdownDuration} onChange={(e) => set("countdownDuration", e.target.value)} /></label>
          <label>Between rounds<input required type="number" min="30" max="60" value={form.betweenRoundSeconds} onChange={(e) => set("betweenRoundSeconds", e.target.value)} /></label>
          <label>Status<select value={form.status} onChange={(e) => set("status", e.target.value as TournamentForm["status"])}><option value="waiting">Waiting</option><option value="upcoming">Upcoming</option></select></label>
          {form.status === "upcoming" && <label className="wide">Starts at<input required type="datetime-local" value={form.startsAt} onChange={(e) => set("startsAt", e.target.value)} /></label>}
        </div>
        <button className="tournament-admin-save" disabled={busy === "save"}>
          {busy === "save" ? <LoaderCircle className="spin" size={14} /> : editingId ? <Check size={14} /> : <Plus size={14} />}
          {editingId ? labels.update : labels.create}
        </button>
      </form>
      <div className="tournament-admin-list">
        {tournaments.map((tournament) => (
          <article className="glass" key={tournament.id}>
            <span><strong>{tournament.title}</strong><small>{tournament.status} · {tournament.playerCount} players · {money(tournament.prizePool)}</small></span>
            {(tournament.status === "waiting" || tournament.status === "upcoming") && (
              <>
                {tournament.status === "waiting" &&
                  tournament.playerType !== "real" && (
                    <button
                      className="tournament-fill-bots"
                      disabled={busy === `fill-${tournament.id}`}
                      onClick={() => onFillBots(tournament.id)}
                    >
                      <Bot size={13} /> {labels.fillBots}
                    </button>
                  )}
                <button onClick={() => onEdit(tournament)}><Pencil size={13} /></button>
                <button disabled={busy === `delete-${tournament.id}`} onClick={() => onDelete(tournament.id)}><Trash2 size={13} /></button>
              </>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
