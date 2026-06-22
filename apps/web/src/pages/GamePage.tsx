import {
  Award,
  ArrowLeft,
  Crown,
  Eye,
  LogOut,
  MessageCircle,
  Mic,
  MicOff,
  RotateCw,
  Send,
  Smile,
  Sparkles,
  Trophy,
  Volume2,
  VolumeX,
  WifiOff,
  Zap,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  memo,
  type CSSProperties,
  type FormEvent,
} from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { GameSceneBackdrop } from "../components/GameSceneBackdrop";
import { GamingIcon } from "../components/icons";
import { useAuth } from "../context/AuthContext";
import { ApiError, apiRequest } from "../lib/api";
import { getGameSoundEngine } from "../lib/game-sounds";
import { canLeaveGame } from "../lib/tournament-ui";
import { resolvedAvatar } from "../lib/avatar";
import {
  buildTokenMovementSteps,
  resolveCapturedTokens,
} from "../lib/game-animation";
import {
  getOnlyLegalTokenIndex,
  getPlacementPrize,
  getPlayerPodSeat,
  getTurnProgress,
  getDiceRollDuration,
  getForwardStepDuration,
  getKillReturnStepDuration,
  estimateForwardMoveDuration,
  pickSmartAutoToken,
  getEarlyFinishLabel,
  buildAutoMoveContext,
  getAutoHumanRollDelayMs,
  getAutoHumanMoveDelayMs,
  getAuthoritativeDiceForPlayer,
  getTokenMoveAfterDiceMs,
  TOKEN_KILL_IMPACT_MS,
  TOKEN_KILL_RETURN_TOTAL_MS,
  TOKEN_STEP_MS,
  tokenPositionsEqual,
  waitForPlayerDiceRollFinish,
  useMultiplayerDiceRolls,
} from "../lib/game-ui";
import {
  GameplayEventGate,
  GameplayPlaybackQueue,
  canAcceptTap,
  playDiceReveal,
  startStuckRecoveryWatch,
} from "../lib/gameplay-sync";
import { socket } from "../lib/socket";
import type { GameRoom, RealtimeEnvelope } from "../types";

const TRACK: Array<[number, number]> = [
  [6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [5, 6], [4, 6], [3, 6],
  [2, 6], [1, 6], [0, 6], [0, 7], [0, 8], [1, 8], [2, 8], [3, 8],
  [4, 8], [5, 8], [6, 9], [6, 10], [6, 11], [6, 12], [6, 13],
  [6, 14], [7, 14], [8, 14], [8, 13], [8, 12], [8, 11], [8, 10],
  [8, 9], [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
  [14, 7], [14, 6], [13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
  [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0], [7, 0], [6, 0],
];
const HOME_LANES: Array<Array<[number, number]>> = [
  [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],
  [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],
  [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
  [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]],
];
const YARD_SLOT_START = 1.82;
const YARD_SLOT_END = 3.18;
const YARD_FAR_OFFSET = 9;
const YARDS: Array<Array<[number, number]>> = [
  [
    [YARD_SLOT_START, YARD_SLOT_START],
    [YARD_SLOT_START, YARD_SLOT_END],
    [YARD_SLOT_END, YARD_SLOT_START],
    [YARD_SLOT_END, YARD_SLOT_END],
  ],
  [
    [YARD_SLOT_START, YARD_FAR_OFFSET + YARD_SLOT_START],
    [YARD_SLOT_START, YARD_FAR_OFFSET + YARD_SLOT_END],
    [YARD_SLOT_END, YARD_FAR_OFFSET + YARD_SLOT_START],
    [YARD_SLOT_END, YARD_FAR_OFFSET + YARD_SLOT_END],
  ],
  [
    [YARD_FAR_OFFSET + YARD_SLOT_START, YARD_FAR_OFFSET + YARD_SLOT_START],
    [YARD_FAR_OFFSET + YARD_SLOT_START, YARD_FAR_OFFSET + YARD_SLOT_END],
    [YARD_FAR_OFFSET + YARD_SLOT_END, YARD_FAR_OFFSET + YARD_SLOT_START],
    [YARD_FAR_OFFSET + YARD_SLOT_END, YARD_FAR_OFFSET + YARD_SLOT_END],
  ],
  [
    [YARD_FAR_OFFSET + YARD_SLOT_START, YARD_SLOT_START],
    [YARD_FAR_OFFSET + YARD_SLOT_START, YARD_SLOT_END],
    [YARD_FAR_OFFSET + YARD_SLOT_END, YARD_SLOT_START],
    [YARD_FAR_OFFSET + YARD_SLOT_END, YARD_SLOT_END],
  ],
];
const COLORS = ["green", "yellow", "blue", "red"] as const;
const YARD_GRID_AREAS = [
  "1 / 1 / 7 / 7",
  "1 / 10 / 7 / 16",
  "10 / 10 / 16 / 16",
  "10 / 1 / 16 / 7",
] as const;
const BOARD_COLOR_HEX: Record<(typeof COLORS)[number], string> = {
  green: "#1aaf45",
  yellow: "#f4c322",
  blue: "#1c70bf",
  red: "#df352f",
};
const EMOJIS = [
  "😀", "😄", "😂", "🤣", "😍", "😎", "🤩", "🥳",
  "😮", "😢", "😡", "🤔", "🙏", "👏", "👍", "👎",
  "💪", "🔥", "💚", "🎲", "🏆", "👑", "⚡", "🎉",
];
const DICE_DOTS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};
const START_CELLS = [0, 13, 26, 39];
const STACK_OFFSETS: Array<[number, number]> = [
  [-3, -3],
  [3, -3],
  [-3, 3],
  [3, 3],
];

function visualSeat(index: number, boardType: "2p" | "4p") {
  return boardType === "2p" && index === 1 ? 2 : index;
}

function prizeMoney(value: number) {
  return `৳${value.toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
}

function msRemaining(target: string | null) {
  if (!target) return 0;
  return Math.max(0, new Date(target).getTime() - Date.now());
}

function useDeadlineSeconds(target: string | null) {
  const [seconds, setSeconds] = useState(() =>
    Math.ceil(msRemaining(target) / 1000),
  );
  useEffect(() => {
    if (!target) {
      setSeconds(0);
      return;
    }
    const tick = () => {
      const next = Math.ceil(msRemaining(target) / 1000);
      setSeconds((current) => (current === next ? current : next));
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [target]);
  return seconds;
}

function useTurnTimer(target: string | null, totalSeconds: number) {
  const [remainingMs, setRemainingMs] = useState(() => msRemaining(target));
  useEffect(() => {
    if (!target) {
      setRemainingMs(0);
      return;
    }
    const tick = () => {
      const next = msRemaining(target);
      setRemainingMs((current) =>
        Math.abs(current - next) < 80 ? current : next,
      );
    };
    tick();
    const id = window.setInterval(tick, 200);
    return () => window.clearInterval(id);
  }, [target]);
  return {
    seconds: remainingMs / 1000,
    progress: getTurnProgress(remainingMs, totalSeconds),
  };
}

function actionFingerprint(action: GameRoom["state"]["boardState"]["lastAction"]) {
  return [
    action.type,
    action.at,
    action.userId ?? "",
    action.tokenIndex ?? "",
    action.dice ?? "",
    action.from ?? "",
    action.to ?? "",
  ].join("|");
}

function moveAnimationKey(
  stateVersion: number,
  action: GameRoom["state"]["boardState"]["lastAction"],
) {
  return [
    stateVersion,
    action.type,
    action.at,
    action.userId ?? "",
    action.tokenIndex ?? "",
    action.from ?? "",
    action.to ?? "",
  ].join("|");
}

function blocksTokenTap(busy: string) {
  return busy === "leave" || busy.startsWith("move-");
}

const SOFT_GAME_ERRORS = new Set([
  "NOT_YOUR_TURN",
  "DICE_ALREADY_ROLLED",
  "ILLEGAL_MOVE",
]);

export function GamePage() {
  const { matchId = "" } = useParams();
  const navigate = useNavigate();
  const { i18n, t } = useTranslation();
  const { user } = useAuth();
  const bn = i18n.language === "bn";
  const [room, setRoom] = useState<GameRoom | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [sound, setSound] = useState(
    () => localStorage.getItem("khan-ludo-sound") !== "off",
  );
  const [autoDice, setAutoDice] = useState(
    () => localStorage.getItem("khan-ludo-auto-dice") === "on",
  );
  const [simpleGameplay, setSimpleGameplay] = useState(
    () => localStorage.getItem("khan-ludo-simple-gameplay") === "on",
  );
  const setAutoDiceOn = useCallback(() => {
    setAutoDice(true);
    localStorage.setItem("khan-ludo-auto-dice", "on");
  }, []);
  const enableAutoDice = setAutoDiceOn;
  const disableAutoDice = useCallback(() => {
    setAutoDice(false);
    localStorage.setItem("khan-ludo-auto-dice", "off");
    if (!matchId || !user?.id) return;
    void apiRequest<{ missCount: number; resumed: boolean }>(
      `/api/games/${matchId}/resume-manual`,
      { method: "POST", body: "{}" },
    )
      .then((result) => {
        if (!result.resumed) return;
        setRoom((current) => {
          if (!current) return current;
          return {
            ...current,
            players: current.players.map((entry) =>
              entry.user.id === user.id
                ? {
                    ...entry,
                    participant: { ...entry.participant, missCount: 0 },
                  }
                : entry,
            ),
          };
        });
      })
      .catch(() => undefined);
  }, [matchId, user?.id]);
  const [panel, setPanel] = useState<"emoji" | "chat" | null>(null);
  const [chat, setChat] = useState("");
  const chatInputRef = useRef<HTMLInputElement>(null);
  const [reconnecting, setReconnecting] = useState(!socket.connected);
  const [playerDice, setPlayerDice] = useState<Record<string, number>>({});
  const [activeBubbles, setActiveBubbles] = useState<
    Record<string, { id: string; kind: "chat" | "emoji"; content: string }>
  >({});
  const soundEngine = useMemo(() => getGameSoundEngine(), []);
  const playSound = useCallback(
    (kind: Parameters<typeof soundEngine.play>[0]) => {
      soundEngine.play(kind);
    },
    [soundEngine],
  );
  const refreshTimerRef = useRef<number | null>(null);
  const refreshInFlightRef = useRef(false);
  const previousTurnRef = useRef<string | null>(null);
  const lastTimerTickRef = useRef<number | null>(null);
  const [tokenAnimating, setTokenAnimating] = useState(false);
  const tokenAnimatingRef = useRef(false);
  const busyRef = useRef("");
  const tokenSpeedRef = useRef<"fast" | "normal" | "slow">("normal");
  const lastRealtimeAtRef = useRef(0);
  const finishRollRef = useRef<(playerId: string, dice?: number) => void>(
    () => undefined,
  );
  const playbackRef = useRef(new GameplayPlaybackQueue());
  const eventGateRef = useRef(new GameplayEventGate());
  const diceSpeedRef = useRef<"fast" | "normal" | "slow">("normal");
  const simpleGameplayRef = useRef(false);
  const isRollingRef = useRef<(playerId: string) => boolean>(() => false);
  busyRef.current = busy;
  simpleGameplayRef.current = simpleGameplay;

  useEffect(() => {
    soundEngine.setEnabled(sound);
  }, [sound, soundEngine]);

  useEffect(() => {
    if (!room?.messages.length) return;
    const recent = [...room.messages]
      .reverse()
      .find((message) => message.kind !== "system" && message.user?.id);
    if (!recent?.user?.id) return;

    const userId = recent.user.id;
    setActiveBubbles((current) => ({
      ...current,
      [userId]: {
        id: recent.id,
        kind: recent.kind as "chat" | "emoji",
        content: recent.content,
      },
    }));

    const timer = window.setTimeout(() => {
      setActiveBubbles((current) => {
        if (current[userId]?.id !== recent.id) return current;
        const next = { ...current };
        delete next[userId];
        return next;
      });
    }, 4500);
    return () => window.clearTimeout(timer);
  }, [room?.messages]);

  useEffect(() => {
    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!viewport) return;
    const previous = viewport.content;
    viewport.content =
      "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";
    const preventGesture = (event: Event) => event.preventDefault();
    document.addEventListener("gesturestart", preventGesture, { passive: false });
    return () => {
      viewport.content = previous;
      document.removeEventListener("gesturestart", preventGesture);
    };
  }, []);

  const load = useCallback(async () => {
    if (!matchId) return;
    const result = await apiRequest<GameRoom>(`/api/games/${matchId}`);
    setRoom((current) => {
      if (!current) return result;
      const currentActionAt = new Date(
        current.state.boardState.lastAction.at,
      ).getTime();
      const incomingActionAt = new Date(
        result.state.boardState.lastAction.at,
      ).getTime();
      if (incomingActionAt < currentActionAt) return current;
      if (result.state.stateVersion < current.state.stateVersion) return current;
      if (tokenAnimatingRef.current) {
        return current;
      }
      return result;
    });
  }, [matchId]);

  const scheduleRefresh = useCallback(() => {
    if (tokenAnimatingRef.current) {
      if (refreshTimerRef.current !== null) return;
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        scheduleRefresh();
      }, 450);
      return;
    }
    if (Date.now() - lastRealtimeAtRef.current < 1_200) {
      if (refreshTimerRef.current !== null) return;
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        scheduleRefresh();
      }, 1_200);
      return;
    }
    if (refreshTimerRef.current !== null) return;
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      if (refreshInFlightRef.current) {
        scheduleRefresh();
        return;
      }
      refreshInFlightRef.current = true;
      void load()
        .catch(() => undefined)
        .finally(() => {
          refreshInFlightRef.current = false;
        });
    }, 150);
  }, [load]);

  const refreshNow = useCallback(() => {
    if (tokenAnimatingRef.current) {
      scheduleRefresh();
      return;
    }
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
    if (refreshInFlightRef.current) {
      scheduleRefresh();
      return;
    }
    refreshInFlightRef.current = true;
    void load()
      .catch(() => undefined)
      .finally(() => {
        refreshInFlightRef.current = false;
      });
  }, [load, scheduleRefresh]);

  useEffect(
    () => () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    setLoading(true);
    load()
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "Game load failed."),
      )
      .finally(() => setLoading(false));
    socket.emit("game:join", matchId);
    const heartbeat = window.setInterval(() => {
      socket.emit("game:heartbeat", matchId);
      if (user) {
        void apiRequest(`/api/games/${matchId}/heartbeat`, {
          method: "POST",
          body: "{}",
        }).catch(() => undefined);
      }
    }, 15_000);
    return () => window.clearInterval(heartbeat);
  }, [load, matchId, user]);

  useEffect(() => {
    if (!room) return;
    const roll = room.state.boardState.roll;
    const lastAction = room.state.boardState.lastAction;
    const playerId = roll
      ? room.state.currentTurn
      : lastAction.userId && lastAction.dice
        ? lastAction.userId
        : room.state.currentTurn &&
            room.state.diceValue &&
            lastAction.userId === room.state.currentTurn
          ? room.state.currentTurn
          : undefined;
    const dice =
      roll?.dice ??
      lastAction.dice ??
      (playerId === room.state.currentTurn ? room.state.diceValue : null);
    if (!playerId || !dice) return;
    setPlayerDice((current) =>
      current[playerId] === dice
        ? current
        : { ...current, [playerId]: dice },
    );
  }, [
    room?.state.boardState.lastAction.at,
    room?.state.boardState.lastAction.dice,
    room?.state.boardState.lastAction.userId,
    room?.state.boardState.roll?.dice,
    room?.state.currentTurn,
    room?.state.diceValue,
  ]);

  const applyActionState = useCallback((result: {
    state: GameRoom["state"]["boardState"];
    currentTurn: string | null;
    tokenPositions?: Record<string, number[]>;
    dice?: number;
    stateVersion?: number;
  }) => {
    lastRealtimeAtRef.current = Date.now();
    setRoom((current) => {
      if (!current) return current;
      const currentAction = current.state.boardState.lastAction;
      const incomingAction = result.state.lastAction;
      if (actionFingerprint(currentAction) === actionFingerprint(incomingAction)) {
        return current;
      }
      if (
        result.stateVersion !== undefined &&
        result.stateVersion < current.state.stateVersion
      ) {
        return current;
      }
      const nextVersion =
        result.stateVersion !== undefined
          ? Math.max(current.state.stateVersion, result.stateVersion)
          : current.state.stateVersion + 1;
      return {
            ...current,
            state: {
              ...current.state,
              boardState: result.state,
              currentTurn: result.currentTurn,
              diceValue: result.dice ?? current.state.diceValue,
              tokenPositions:
                result.tokenPositions ?? current.state.tokenPositions,
              stateVersion: nextVersion,
              updatedAt: new Date().toISOString(),
            },
          };
    });
  }, []);

  const resolveAutoTokenIndex = useCallback(
    (boardState: GameRoom["state"]["boardState"]) => {
      if (!user?.id || !room) return null;
      const legal = boardState.roll?.legalTokenIndexes ?? [];
      if (legal.length === 0) return null;
      if (autoDice) {
        const context = buildAutoMoveContext(
          {
            tournament: room.tournament,
            rules: room.rules,
            state: {
              tokenPositions: room.state.tokenPositions,
              boardState: { ...room.state.boardState, roll: boardState.roll },
            },
          },
          user.id,
        );
        return context ? pickSmartAutoToken(context) : null;
      }
      return getOnlyLegalTokenIndex(legal);
    },
    [autoDice, room, user?.id],
  );

  const submitTokenMove = useCallback(
    async (tokenIndex: number) => {
      if (!user?.id) return;
      const result = await apiRequest<{
        state: GameRoom["state"]["boardState"];
        currentTurn: string | null;
        tokenPositions: Record<string, number[]>;
        stateVersion: number;
      }>(`/api/games/${matchId}/move`, {
        method: "POST",
        body: JSON.stringify({ tokenIndex }),
      });
      if (isRollingRef.current(user.id) && !simpleGameplayRef.current) {
        await waitForPlayerDiceRollFinish(
          isRollingRef.current,
          user.id,
          tokenSpeedRef.current,
        );
      }
      applyActionState(result);
    },
    [applyActionState, matchId, user?.id],
  );

  const handleDiceReveal = useCallback((playerId: string, dice: number) => {
    if (dice < 1 || dice > 6) return;
    setPlayerDice((current) => ({ ...current, [playerId]: dice }));
  }, []);

  const diceSpeed = room?.settings.diceSpeed ?? "normal";
  const tokenSpeed = room?.settings.tokenSpeed ?? "normal";
  tokenSpeedRef.current = tokenSpeed;
  diceSpeedRef.current = diceSpeed;
  const { startRoll, setRollResult, finishRoll, isRolling, rollingFace, rollProgress } =
    useMultiplayerDiceRolls(diceSpeed);
  finishRollRef.current = finishRoll;
  isRollingRef.current = isRolling;

  const realtimeHandlersRef = useRef({
    userId: undefined as string | undefined,
    applyActionState,
    playSound,
    startRoll,
    setRollResult,
    handleDiceReveal,
    refreshNow,
    scheduleRefresh,
    enableAutoDice: setAutoDiceOn,
    setRoom,
  });
  realtimeHandlersRef.current = {
    userId: user?.id,
    applyActionState,
    playSound,
    startRoll,
    setRollResult,
    handleDiceReveal,
    refreshNow,
    scheduleRefresh,
    enableAutoDice: setAutoDiceOn,
    setRoom,
  };

  useEffect(() => {
    if (!matchId) return;
    const ensureJoined = () => {
      if (socket.connected) {
        socket.emit("game:join", matchId);
      }
    };
    const onConnect = () => {
      setReconnecting(false);
      ensureJoined();
      void load().catch(() => undefined);
    };
    ensureJoined();
    socket.on("connect", onConnect);

    const onSnapshot = (
      event: RealtimeEnvelope<GameRoom> | GameRoom,
    ) => {
      realtimeHandlersRef.current.setRoom(
        event &&
          typeof event === "object" &&
          "payload" in event
          ? event.payload
          : event,
      );
      setLoading(false);
      setReconnecting(false);
    };
    const onDice = (payload: {
      userId?: string;
      dice?: number;
      stateVersion?: number;
      state?: GameRoom["state"]["boardState"];
      currentTurn?: string | null;
      tokenPositions?: Record<string, number[]>;
    }) => {
      const gateKey = `dice:${payload.stateVersion ?? 0}:${payload.userId}:${payload.dice}:${payload.state?.lastAction.at ?? ""}`;
      if (!eventGateRef.current.accept(gateKey, payload.stateVersion)) return;
      const handlers = realtimeHandlersRef.current;
      const actorId = payload.userId;
      const dice = payload.dice;
      if (!actorId || !dice) return;
      const ownLocalRoll =
        actorId === handlers.userId && busyRef.current === "roll";
      handlers.playSound("dice");
      if (payload.state && payload.tokenPositions) {
        handlers.applyActionState({
          state: payload.state,
          currentTurn: payload.currentTurn ?? null,
          tokenPositions: payload.tokenPositions,
          ...(payload.stateVersion !== undefined
            ? { stateVersion: payload.stateVersion }
            : {}),
          dice,
        });
      }
      handlers.handleDiceReveal(actorId, dice);
      if (ownLocalRoll) {
        handlers.setRollResult(actorId, dice);
        return;
      }
      if (simpleGameplayRef.current) return;
      void playDiceReveal(
        handlers.startRoll,
        isRollingRef.current,
        actorId,
        dice,
        diceSpeedRef.current,
        tokenSpeedRef.current,
      );
    };
    const onMove = (payload: {
      userId?: string;
      tokenIndex?: number;
      stateVersion?: number;
      killedUserIds?: string[];
      reachedHome?: boolean;
      state?: GameRoom["state"]["boardState"];
      currentTurn?: string | null;
      tokenPositions?: Record<string, number[]>;
    }) => {
      const gateKey = `move:${payload.stateVersion ?? 0}:${payload.userId}:${payload.state?.lastAction.at ?? ""}`;
      if (!eventGateRef.current.accept(gateKey, payload.stateVersion)) return;
      const handlers = realtimeHandlersRef.current;
      if (
        payload.userId === handlers.userId &&
        busyRef.current.startsWith("move-")
      ) {
        return;
      }
      if (payload.killedUserIds?.length) {
        /* Kill sound plays during board capture animation. */
      } else if (payload.reachedHome) {
        handlers.playSound("home");
      }
      if (payload.state && payload.tokenPositions) {
        handlers.applyActionState({
          state: payload.state,
          currentTurn: payload.currentTurn ?? null,
          tokenPositions: payload.tokenPositions,
          ...(payload.stateVersion !== undefined
            ? { stateVersion: payload.stateVersion }
            : {}),
        });
      } else {
        handlers.refreshNow();
      }
    };
    const onTurnChange = (payload: {
      userId?: string | null;
      turnDeadline?: string | null;
      turnStartedAt?: string | null;
      stateVersion?: number;
      missedUserId?: string;
      autoPlayEnabled?: boolean;
    }) => {
      const handlers = realtimeHandlersRef.current;
      if (payload.missedUserId === handlers.userId) {
        handlers.enableAutoDice();
      }
      handlers.setRoom((current) => {
        if (!current) return current;
        return {
          ...current,
          state: {
            ...current.state,
            currentTurn:
              payload.userId === undefined
                ? current.state.currentTurn
                : payload.userId,
            boardState: {
              ...current.state.boardState,
              turnDeadline:
                payload.turnDeadline ??
                current.state.boardState.turnDeadline,
              turnStartedAt:
                payload.turnStartedAt ??
                current.state.boardState.turnStartedAt,
            },
          },
        };
      });
      handlers.scheduleRefresh();
    };
    const onMessage = (message: GameRoom["messages"][number]) => {
      realtimeHandlersRef.current.setRoom((current) => {
        if (!current) return current;
        if (current.messages.some((entry) => entry.id === message.id)) {
          return current;
        }
        const withoutOptimistic =
          message.user?.id &&
          current.messages.some(
            (entry) =>
              entry.id.startsWith("temp-") &&
              entry.user?.id === message.user?.id &&
              entry.content === message.content &&
              entry.kind === message.kind,
          )
            ? current.messages.filter((entry) => !entry.id.startsWith("temp-"))
            : current.messages;
        return {
          ...current,
          messages: [...withoutOptimistic, message],
        };
      });
    };
    const onGameOver = () => {
      realtimeHandlersRef.current.playSound("win");
      realtimeHandlersRef.current.refreshNow();
    };
    const onDisconnect = () => setReconnecting(true);
    const onState = () => realtimeHandlersRef.current.scheduleRefresh();

    socket.on("game:state", onState);
    socket.on("game:state-snapshot", onSnapshot);
    socket.on("game:dice-roll", onDice);
    socket.on("game:token-move", onMove);
    socket.on("game:turn-change", onTurnChange);
    socket.on("game:player-leave", onState);
    socket.on("game:reconnect-start", onState);
    socket.on("game:reconnect-success", onState);
    socket.on("game:reconnect-fail", onState);
    socket.on("game:message", onMessage);
    socket.on("game:over", onGameOver);
    socket.on("disconnect", onDisconnect);
    socket.on("connect", onConnect);
    return () => {
      socket.off("connect", onConnect);
      socket.off("game:state", onState);
      socket.off("game:state-snapshot", onSnapshot);
      socket.off("game:dice-roll", onDice);
      socket.off("game:token-move", onMove);
      socket.off("game:turn-change", onTurnChange);
      socket.off("game:player-leave", onState);
      socket.off("game:reconnect-start", onState);
      socket.off("game:reconnect-success", onState);
      socket.off("game:reconnect-fail", onState);
      socket.off("game:message", onMessage);
      socket.off("game:over", onGameOver);
      socket.off("disconnect", onDisconnect);
      socket.off("connect", onConnect);
    };
  }, [load, matchId]);

  const run = async (
    key: string,
    action: () => Promise<unknown>,
    refreshAfter = true,
  ) => {
    setBusy(key);
    setError("");
    try {
      await action();
      if (refreshAfter) await load().catch(() => undefined);
    } catch (caught) {
      if (caught instanceof ApiError && SOFT_GAME_ERRORS.has(caught.code)) {
        void load().catch(() => undefined);
        return;
      }
      setError(caught instanceof Error ? caught.message : "Action failed.");
    } finally {
      setBusy("");
    }
  };

  useEffect(() => {
    playbackRef.current.reset();
    eventGateRef.current.reset();
  }, [matchId]);

  useEffect(() => {
    if (!user?.id || simpleGameplay) return;
    return startStuckRecoveryWatch(
      () => isRollingRef.current(user.id),
      () => {
        finishRollRef.current(user.id);
        void load().catch(() => undefined);
      },
      9_000,
    );
  }, [load, simpleGameplay, user?.id]);

  const roll = useCallback(() => {
    if (!user?.id || !room) return;
    if (room.state.currentTurn !== user.id) return;
    if (room.state.boardState.roll) return;
    if (busy === "roll" || busy.startsWith("move-")) return;
    if (!canAcceptTap("roll", simpleGameplay ? 120 : 320)) return;
    soundEngine.resume();
    setBusy("roll");
    setError("");
    void (async () => {
      try {
        playSound("dice");
        if (!simpleGameplay) {
          startRoll(user.id);
        }
        const result = await apiRequest<{
          state: GameRoom["state"]["boardState"];
          currentTurn: string | null;
          dice: number;
          stateVersion: number;
        }>(`/api/games/${matchId}/roll`, {
          method: "POST",
          body: "{}",
        });
        setRollResult(user.id, result.dice);
        handleDiceReveal(user.id, result.dice);
        applyActionState({
          ...result,
          dice: result.dice,
          stateVersion: result.stateVersion,
        });
        setBusy("");
        if (!simpleGameplay) {
          await waitForPlayerDiceRollFinish(
            isRollingRef.current,
            user.id,
            tokenSpeedRef.current,
          );
        }
        if (!autoDice) {
          const autoTokenIndex = getOnlyLegalTokenIndex(
            result.state.roll?.legalTokenIndexes ?? [],
          );
          if (autoTokenIndex !== null) {
            playSound("move");
            await submitTokenMove(autoTokenIndex);
          }
        }
      } catch (caught) {
        if (caught instanceof ApiError && SOFT_GAME_ERRORS.has(caught.code)) {
          void load().catch(() => undefined);
          return;
        }
        setError(caught instanceof Error ? caught.message : "Action failed.");
      } finally {
        setBusy("");
        if (!simpleGameplay && isRollingRef.current(user.id)) {
          finishRollRef.current(user.id);
        }
      }
    })();
  }, [
    applyActionState,
    autoDice,
    busy,
    handleDiceReveal,
    load,
    matchId,
    playSound,
    room,
    setRollResult,
    simpleGameplay,
    soundEngine,
    startRoll,
    submitTokenMove,
    user?.id,
  ]);
  const move = useCallback(
    (tokenIndex: number) => {
      if (!canAcceptTap(`move-${tokenIndex}`, 320)) return;
      soundEngine.resume();
      void run(`move-${tokenIndex}`, () => submitTokenMove(tokenIndex), false);
    },
    [soundEngine, submitTokenMove],
  );
  const leave = () => {
    if (
      !window.confirm(
        bn
          ? "গেম ছাড়লে সঙ্গে সঙ্গে পরাজয় হবে। নিশ্চিত?"
          : "Leaving is an instant loss. Continue?",
      )
    ) {
      return;
    }
    void run("leave", () =>
      apiRequest(`/api/games/${matchId}/leave`, {
        method: "POST",
        body: "{}",
      }),
    );
  };
  const postGameMessage = useCallback(
    async (kind: "chat" | "emoji", content: string) => {
      if (!user?.id || room?.role !== "player") return;
      const ownProfile = room.players.find(({ user: player }) => player.id === user.id)
        ?.user;
      const tempId = `temp-${Date.now()}`;
      const optimistic = {
        id: tempId,
        kind,
        content,
        createdAt: new Date().toISOString(),
        user: {
          id: user.id,
          name: ownProfile?.name ?? user.name ?? "Player",
          avatar: ownProfile?.avatar ?? user.avatar ?? null,
        },
      };
      setRoom((current) =>
        current
          ? { ...current, messages: [...current.messages, optimistic] }
          : current,
      );
      if (kind === "chat") setChat("");
      try {
        await apiRequest(`/api/games/${matchId}/messages`, {
          method: "POST",
          body: JSON.stringify({ kind, content }),
        });
      } catch (caught) {
        setRoom((current) =>
          current
            ? {
                ...current,
                messages: current.messages.filter((entry) => entry.id !== tempId),
              }
            : current,
        );
        setError(
          caught instanceof Error ? caught.message : "Message failed to send.",
        );
      }
    },
    [matchId, room, user],
  );

  const canSendMessages = room?.role === "player";

  const sendChatMessage = useCallback(() => {
    const trimmed = chat.trim();
    if (!trimmed || !canSendMessages) return;
    void postGameMessage("chat", trimmed);
  }, [canSendMessages, chat, postGameMessage]);

  const handleEmojiSelect = useCallback(
    (emoji: string) => {
      if (room?.role !== "player") return;
      setPanel(null);
      void postGameMessage("emoji", emoji);
    },
    [postGameMessage, room?.role],
  );
  const emojiSendGuardRef = useRef(0);
  const handleEmojiTap = useCallback(
    (emoji: string) => {
      const now = Date.now();
      if (now - emojiSendGuardRef.current < 280) return;
      emojiSendGuardRef.current = now;
      handleEmojiSelect(emoji);
    },
    [handleEmojiSelect],
  );
  const submitChat = (event: FormEvent) => {
    event.preventDefault();
    sendChatMessage();
  };

  useEffect(() => {
    if (panel !== "chat") return;
    const timer = window.setTimeout(() => {
      chatInputRef.current?.focus();
    }, 60);
    return () => window.clearTimeout(timer);
  }, [panel]);

  const ownPlayer = room?.players.find(({ user: player }) => player.id === user?.id);

  useEffect(() => {
    if (!ownPlayer?.participant.missCount) return;
    setAutoDiceOn();
  }, [ownPlayer?.participant.missCount, setAutoDiceOn]);

  const ownMissCount = ownPlayer?.participant.missCount ?? 0;
  const serverAutoPlay = ownMissCount > 0;

  const isOwnTurn =
    room?.role === "player" && room.state.currentTurn === user?.id;
  const ownRolling = Boolean(user?.id && isRolling(user.id));
  const canAutoRoll = Boolean(
    autoDice &&
      !serverAutoPlay &&
      user?.id &&
      room?.role === "player" &&
      room.state.currentTurn === user.id &&
      room.state.boardState.phase === "active" &&
      !room.state.boardState.roll &&
      busy !== "roll" &&
      (simpleGameplay || (!ownRolling && !tokenAnimating)),
  );
  const canAutoMove = Boolean(
    autoDice &&
      !serverAutoPlay &&
      user?.id &&
      room?.role === "player" &&
      room.state.currentTurn === user.id &&
      room.state.boardState.phase === "active" &&
      room.state.boardState.roll &&
      (room.state.boardState.roll.legalTokenIndexes.length ?? 0) > 0 &&
      !busy.startsWith("move-") &&
      busy !== "roll" &&
      (simpleGameplay || (!ownRolling && !tokenAnimating)),
  );
  const canManualRoll = Boolean(
    isOwnTurn &&
      room?.state.boardState.phase === "active" &&
      !room?.state.boardState.roll &&
      busy !== "roll" &&
      !busy.startsWith("move-") &&
      (simpleGameplay || !ownRolling) &&
      (!autoDice || !serverAutoPlay),
  );
  const rollRef = useRef(roll);
  rollRef.current = roll;
  const runRef = useRef(run);
  runRef.current = run;
  const submitTokenMoveRef = useRef(submitTokenMove);
  submitTokenMoveRef.current = submitTokenMove;
  const resolveAutoTokenIndexRef = useRef(resolveAutoTokenIndex);
  resolveAutoTokenIndexRef.current = resolveAutoTokenIndex;

  useEffect(() => {
    if (!canAutoRoll) return;
    const timer = window.setTimeout(() => {
      rollRef.current();
    }, getAutoHumanRollDelayMs(room?.settings.diceSpeed ?? "normal"));
    return () => window.clearTimeout(timer);
  }, [
    canAutoRoll,
    room?.settings.diceSpeed,
    room?.state.currentTurn,
    room?.state.boardState.roll,
    tokenAnimating,
  ]);

  useEffect(() => {
    if (!canAutoMove || !room) return;
    const boardState = room.state.boardState;
    const timer = window.setTimeout(() => {
      const tokenIndex = resolveAutoTokenIndexRef.current(boardState);
      if (tokenIndex === null) return;
      playSound("move");
      void runRef.current(
        `move-${tokenIndex}`,
        () => submitTokenMoveRef.current(tokenIndex),
        false,
      );
    }, getAutoHumanMoveDelayMs(room.settings.tokenSpeed));
    return () => window.clearTimeout(timer);
  }, [
    canAutoMove,
    playSound,
    room?.settings.tokenSpeed,
    room?.state.boardState.roll,
    room?.state.stateVersion,
    tokenAnimating,
  ]);

  const handleStepSound = useCallback(() => {
    playSound("move");
  }, [playSound]);
  const handleKillSound = useCallback(() => {
    playSound("kill");
  }, [playSound]);
  const handleKillReturnSound = useCallback(() => {
    playSound("killReturn");
  }, [playSound]);
  const turnSeconds = useDeadlineSeconds(
    room?.state.boardState.turnDeadline ?? null,
  );
  const activePhase = room?.state.boardState.phase === "active";
  const gameLeaveAllowed = room
    ? canLeaveGame(room.tournament, room.match.status)
    : true;

  useEffect(() => {
    if (!activePhase || turnSeconds > 0) return;
    const timer = window.setTimeout(() => {
      refreshNow();
    }, 400);
    return () => window.clearTimeout(timer);
  }, [activePhase, refreshNow, turnSeconds]);

  useEffect(() => {
    const currentTurn = room?.state.currentTurn ?? null;
    if (!currentTurn || currentTurn === previousTurnRef.current) return;
    previousTurnRef.current = currentTurn;
    lastTimerTickRef.current = null;
    if (currentTurn === user?.id) {
      playSound("turn");
    }
  }, [playSound, room?.state.currentTurn, user?.id]);

  useEffect(() => {
    if (!activePhase || !room?.state.currentTurn) {
      lastTimerTickRef.current = null;
      return;
    }
    const secondsLeft = Math.ceil(turnSeconds);
    if (secondsLeft > 3 || secondsLeft < 1) {
      if (secondsLeft > 3) lastTimerTickRef.current = null;
      return;
    }
    if (lastTimerTickRef.current === secondsLeft) return;
    lastTimerTickRef.current = secondsLeft;
    soundEngine.playTimerTick(secondsLeft);
  }, [activePhase, room?.state.currentTurn, soundEngine, turnSeconds]);

  useEffect(() => {
    if (room?.state.boardState.phase !== "completed" || !user) return;
    const placement =
      room.players.find(({ user: player }) => player.id === user.id)
        ?.participant.placement ??
      room.state.boardState.placements.indexOf(user.id) + 1;
    if (placement === 1) playSound("win");
  }, [playSound, room?.state.boardState.phase, room?.players, room?.state.boardState.placements, user]);

  if (loading || !room) {
    return (
      <main className="game-page game-loading">
        <img src="/prizejito-logo.png" alt="PrizeJito.com" />
        <span>{error || (bn ? "গেম লোড হচ্ছে..." : "Loading game...")}</span>
      </main>
    );
  }

  const ownPlayerIndex = room.players.findIndex(
    ({ user: player }) => player.id === user?.id,
  );
  const turnDeadline = room.state.boardState.turnDeadline ?? null;
  const turnTotalSeconds = room.state.boardState.turnSeconds;
  const firstPrize =
    (Number(room.tournament.prizePool) * Number(room.tournament.prizeFirst)) /
    100;
  const gameCompleted = room.state.boardState.phase === "completed";

  return (
    <main
      className={`game-page mode-${room.tournament.gameMode} speed-${room.settings.tokenSpeed}${gameCompleted ? " game-page--completed" : ""}`}
    >
      <GameSceneBackdrop />
      <header className="game-topbar glass">
        <button onClick={() => navigate("/tournaments")} aria-label="Back">
          <ArrowLeft size={17} />
        </button>
        <div className="game-prize-badge glass" title="Tournament first prize">
          <GamingIcon name="trophy" size={18} />
          <span>
            <small>{bn ? "১ম পুরস্কার" : "1st prize"}</small>
            <strong>{prizeMoney(firstPrize)}</strong>
          </span>
        </div>
        <span>
          <small>{room.tournament.gameMode} · {room.tournament.boardType}</small>
          <strong>{room.tournament.title}</strong>
        </span>
        <div className="game-spectator">
          <Eye size={15} />
          <span>
            {gameCompleted
              ? t("gameOverTitle")
              : room.role === "spectator"
                ? "Spectator"
                : "Live"}
          </span>
        </div>
        {gameLeaveAllowed && (
          <button
            className="game-leave-top"
            disabled={room.role !== "player" || busy === "leave"}
            onClick={leave}
            aria-label="Leave game"
          >
            <LogOut size={16} />
          </button>
        )}
      </header>

      <section
        className={`game-arena game-arena--${room.tournament.boardType}${simpleGameplay ? " game-simple-mode" : ""}`}
      >
        {room.players.map(({ participant, user: player }, index) => {
          const boardSeat = visualSeat(index, room.tournament.boardType);
          const seat = getPlayerPodSeat(
            index,
            ownPlayerIndex,
            room.tournament.boardType,
          );
          const active = room.state.currentTurn === player.id;
          const ownDice = player.id === user?.id;
          const rolling = isRolling(player.id);
          const earlyFinishLabel = getEarlyFinishLabel(
            room.state.boardState.finishOrder,
            player.id,
            room.tournament.boardType,
            room.state.boardState.phase,
            bn,
          );
          return (
            <PlayerDicePod
              key={player.id}
              seat={seat}
              color={COLORS[boardSeat]!}
              player={player}
              participant={participant}
              active={active}
              earlyFinishLabel={earlyFinishLabel}
              showTurnTimer={
                active &&
                room.state.boardState.phase === "active" &&
                turnSeconds > 0 &&
                !participant.isEliminated
              }
              turnDeadline={active ? turnDeadline : null}
              turnTotalSeconds={turnTotalSeconds}
              diceValue={(() => {
                const fromState = getAuthoritativeDiceForPlayer(
                  room.state.boardState,
                  room.state.currentTurn,
                  player.id,
                  room.state.diceValue,
                );
                const cached = playerDice[player.id] ?? null;
                const resolved = fromState ?? cached;
                if (rolling && !simpleGameplay && resolved === null) {
                  return rollingFace(player.id) ?? 1;
                }
                if (rolling && !simpleGameplay && resolved !== null) {
                  return resolved;
                }
                return resolved;
              })()}
              rolling={rolling}
              rollProgress={rolling ? rollProgress(player.id) : 0}
              canRoll={ownDice && canManualRoll}
              simpleGameplay={simpleGameplay}
              bubble={activeBubbles[player.id] ?? null}
              onRoll={roll}
            />
          );
        })}
        <div className="game-board-wrap">
        {room.role === "spectator" && !gameCompleted && (
          <div className="spectating-badge glass">
            <Sparkles size={12} />
            {bn ? "আপনি দেখছেন" : "You're spectating"}
          </div>
        )}
        <LudoBoard
          room={room}
          userId={user?.id}
          currentTurn={room.state.currentTurn}
          diceSpeed={room.settings.diceSpeed}
          simpleGameplay={simpleGameplay}
          onMove={move}
          busy={busy}
          isDiceRolling={isRolling}
          onStepSound={handleStepSound}
          onKillSound={handleKillSound}
          onKillReturnSound={handleKillReturnSound}
          onAnimatingChange={(animating) => {
            tokenAnimatingRef.current = animating;
            setTokenAnimating(animating);
          }}
        />
        </div>
      </section>

      <section className="game-controls glass">
        <div className="game-controls__tools">
          <button
            className={`game-sound ${sound ? "active" : ""}`}
            onClick={() => {
              const next = !sound;
              setSound(next);
              localStorage.setItem("khan-ludo-sound", next ? "on" : "off");
              if (next) soundEngine.resume();
            }}
            aria-label={bn ? "সাউন্ড" : "Sound"}
          >
            {sound ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>
          <button
            className={`game-sound game-sound--fast ${simpleGameplay ? "active" : ""}`}
            onClick={() => {
              const next = !simpleGameplay;
              setSimpleGameplay(next);
              localStorage.setItem(
                "khan-ludo-simple-gameplay",
                next ? "on" : "off",
              );
              if (next && user?.id && isRollingRef.current(user.id)) {
                finishRollRef.current(user.id);
              }
            }}
            aria-label={
              bn ? "সাধারণ মোড (অ্যানিমেশন বন্ধ)" : "Simple mode (no animation)"
            }
            title={
              bn
                ? "অ্যানিমেশন বন্ধ — দ্রুত ও নির্ভরযোগ্য"
                : "No animation — faster and more reliable"
            }
          >
            <Zap size={17} />
          </button>
        </div>
        <div
          className={`game-auto-switch ${autoDice ? "is-on" : ""}`}
          role="group"
          aria-label={bn ? "অটো মোড" : "Auto mode"}
        >
          <button
            type="button"
            className={!autoDice ? "active" : ""}
            disabled={room.role !== "player"}
            aria-pressed={!autoDice}
            onClick={disableAutoDice}
          >
            {bn ? "বন্ধ" : "OFF"}
          </button>
          <button
            type="button"
            className={autoDice ? "active" : ""}
            disabled={room.role !== "player"}
            aria-pressed={autoDice}
            onClick={enableAutoDice}
          >
            {bn ? "চালু" : "ON"}
          </button>
        </div>
        <div className={`game-action-status ${isOwnTurn && !gameCompleted ? "active" : ""}`}>
          {gameCompleted
            ? t("gameOverTitle")
            : isOwnTurn
              ? bn
                ? "আপনার চাল"
                : "Your turn"
              : bn
                ? "প্রতিপক্ষের চাল"
                : "Opponent turn"}
        </div>
        <div className="game-roll-streak" title="Consecutive sixes">
          <RotateCw size={18} />
          <strong>{room.state.boardState.consecutiveSixes}/2</strong>
        </div>
      </section>

      <div className="game-communication-stack">
      <section className="game-communication glass">
        <button
          type="button"
          disabled={!room.voice.enabled}
          onClick={() =>
            room.voice.url &&
            window.open(room.voice.url, "_blank", "noopener,noreferrer")
          }
        >
          {room.voice.enabled ? <Mic size={17} /> : <MicOff size={17} />}
          <span>{bn ? "ভয়েস" : "Voice"}</span>
        </button>
        <button
          type="button"
          className={panel === "emoji" ? "active" : ""}
          onClick={() => setPanel(panel === "emoji" ? null : "emoji")}
        >
          <Smile size={17} /><span>{bn ? "ইমোজি" : "Emoji"}</span>
        </button>
        <button
          type="button"
          className={panel === "chat" ? "active" : ""}
          onClick={() => setPanel(panel === "chat" ? null : "chat")}
        >
          <MessageCircle size={17} /><span>{bn ? "চ্যাট" : "Chat"}</span>
        </button>
      </section>
      </div>

      {(panel === "emoji" || panel === "chat") && (
        <div className="game-comms-overlay" role="presentation">
          {panel === "emoji" && (
            <div className="game-popover emoji-picker glass">
              <div className="emoji-picker__header">
                <span>
                  {bn ? "ইমোজি" : "Emoji"}
                  <small>{bn ? "ট্যাপ করলেই পাঠাবে" : "Tap to send instantly"}</small>
                </span>
                <button
                  type="button"
                  className="emoji-picker__close"
                  aria-label={bn ? "বন্ধ করুন" : "Close emoji panel"}
                  onClick={() => setPanel(null)}
                >
                  <X size={14} />
                </button>
              </div>
              <div className="emoji-picker__grid">
                {EMOJIS.map((emoji) => (
                  <button
                    type="button"
                    key={emoji}
                    disabled={!canSendMessages}
                    aria-label={emoji}
                    onClick={() => handleEmojiTap(emoji)}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      handleEmojiSelect(emoji);
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}
          {panel === "chat" && (
            <div className="game-popover chat-panel glass">
              <div className="chat-panel__header">
                <span>{bn ? "চ্যাট" : "Chat"}</span>
                <button
                  type="button"
                  className="chat-panel__close"
                  aria-label={bn ? "বন্ধ করুন" : "Close chat panel"}
                  onClick={() => setPanel(null)}
                >
                  <X size={14} />
                </button>
              </div>
              <div className="chat-panel__messages">
                {room.messages.filter((message) => message.kind !== "system").length ===
                0 ? (
                  <p className="chat-panel__empty">
                    {bn ? "প্রথম বার্তা পাঠান" : "Send the first message"}
                  </p>
                ) : (
                  room.messages
                    .filter((message) => message.kind !== "system")
                    .slice(-20)
                    .map((message) => (
                      <article
                        key={message.id}
                        className={`chat-message ${
                          message.kind === "emoji" ? "chat-message--emoji" : ""
                        }`}
                      >
                        <strong>{message.user?.name ?? "System"}</strong>
                        <span>{message.content}</span>
                      </article>
                    ))
                )}
              </div>
              <form className="chat-panel__composer" onSubmit={submitChat}>
                <input
                  ref={chatInputRef}
                  type="text"
                  inputMode="text"
                  enterKeyHint="send"
                  autoComplete="off"
                  maxLength={240}
                  value={chat}
                  readOnly={!canSendMessages}
                  onChange={(event) => setChat(event.target.value)}
                  placeholder={
                    canSendMessages
                      ? bn
                        ? "বার্তা লিখুন"
                        : "Type a message"
                      : bn
                        ? "শুধু খেলোয়াড়রা চ্যাট করতে পারেন"
                        : "Only players can chat"
                  }
                />
                <button
                  type="submit"
                  disabled={!chat.trim() || !canSendMessages}
                  aria-label={bn ? "পাঠান" : "Send"}
                  onClick={(event) => {
                    event.preventDefault();
                    sendChatMessage();
                  }}
                >
                  <Send size={14} />
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {(reconnecting || ownPlayer?.participant.reconnectDeadline) && (
        <div className="game-reconnect-overlay">
          <WifiOff size={32} />
          <strong>{bn ? "পুনরায় সংযোগ হচ্ছে..." : "Reconnecting..."}</strong>
          <span>
            {Math.ceil(
              msRemaining(ownPlayer?.participant.reconnectDeadline ?? null) /
                1000,
            ) || 60}s
          </span>
        </div>
      )}

      {room.state.boardState.phase === "completed" && (
        <GameResultOverlay
          room={room}
          userId={user?.id}
          prizeMoney={prizeMoney}
          onExit={() => navigate("/tournaments")}
          t={t}
        />
      )}

      {error && <button className="game-error" onClick={() => setError("")}>{error}</button>}
    </main>
  );
}

function ReconnectBadge({ deadline }: { deadline: string }) {
  const seconds = useDeadlineSeconds(deadline);
  return <em><WifiOff size={9} /> {seconds}s</em>;
}

function GameResultOverlay({
  room,
  userId,
  prizeMoney,
  onExit,
  t,
}: {
  room: GameRoom;
  userId?: string | undefined;
  prizeMoney: (value: number) => string;
  onExit: () => void;
  t: TFunction;
}) {
  const [secondsLeft, setSecondsLeft] = useState(10);
  const placements = room.state.boardState.placements;
  const eliminated = room.state.boardState.eliminatedOrder.filter(
    (playerId) => !placements.includes(playerId),
  );
  const orderedIds = [
    ...placements,
    ...eliminated,
    ...room.players
      .map(({ user: player }) => player.id)
      .filter((playerId) => !placements.includes(playerId) && !eliminated.includes(playerId)),
  ];
  const invest =
    room.tournament.type === "free" ? 0 : Number(room.tournament.joinFee);
  const formatStake = (value: number) =>
    value > 0 ? prizeMoney(value) : t("free");

  const rankings = orderedIds.map((playerId, index) => {
    const player = room.players.find(({ user: playerUser }) => playerUser.id === playerId);
    const rank = index + 1;
    return {
      id: playerId,
      rank,
      name: player?.user.name ?? "Player",
      avatar: player?.user.avatar ?? "",
      gameId: player?.user.gameId ?? "",
      prize: getPlacementPrize(room.tournament, rank),
      invest,
    };
  });

  const first = rankings.find((entry) => entry.rank === 1);
  const second = rankings.find((entry) => entry.rank === 2);
  const third = rankings.find((entry) => entry.rank === 3);
  const others = rankings.filter((entry) => entry.rank > 3);
  const ownEntry = userId
    ? rankings.find((entry) => entry.id === userId)
    : undefined;
  const ownPlacement = ownEntry?.rank ?? null;
  const isParticipant = Boolean(
    userId && room.players.some(({ user: player }) => player.id === userId),
  );
  const settlementTone =
    isParticipant && ownPlacement === 1
      ? "win"
      : isParticipant && ownPlacement === 2
        ? "runner"
        : isParticipant
          ? "loss"
          : "neutral";

  useEffect(() => {
    if (secondsLeft <= 0) {
      onExit();
      return;
    }
    const timer = window.setTimeout(() => {
      setSecondsLeft((current) => current - 1);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [onExit, secondsLeft]);

  const boardLabel = room.tournament.boardType.toUpperCase();
  const matchRef = room.match.id.replace(/-/g, "").slice(-10).toUpperCase();
  const isWinResult = (rank: number, prize: number) => rank === 1 || prize > 0;

  return (
    <div
      className={`game-result-overlay game-settlement-overlay game-settlement-overlay--${settlementTone}`}
      role="dialog"
      aria-modal="true"
    >
      <div className="game-result__fx" aria-hidden="true">
        <div className="game-result__rays" />
        <div className="game-result__sparkles" />
        <div className="game-result__fireworks">
          {Array.from({ length: 8 }, (_, index) => (
            <i key={index} style={{ "--burst-i": index } as CSSProperties} />
          ))}
        </div>
        <div className="game-result__confetti">
          {Array.from({ length: 24 }, (_, index) => (
            <i key={index} style={{ "--piece-i": index } as CSSProperties} />
          ))}
        </div>
      </div>

      <div className="game-settlement">
        <span className="game-settlement__pill">{t("gameSettlementTitle")}</span>
        <small className="game-settlement__match-id">NO.{matchRef}</small>
        <h2 className="game-settlement__heading">
          <Sparkles size={14} />
          {t("gameSettlementHeading")}
          <Sparkles size={14} />
        </h2>
        <p className="game-settlement__meta">
          {t("gameSettlementPlayers", { count: room.players.length })}
          {" · "}
          {t("gameSettlementRound", {
            round: room.match.round,
            total: room.tournament.totalRounds,
          })}
          {" · "}
          {t("gameSettlementBoard", { board: boardLabel })}
        </p>

        <div className="game-settlement__podium">
          <SettlementPodiumSlot
            {...(second ? { entry: second } : {})}
            size="md"
            prizeMoney={prizeMoney}
            formatStake={formatStake}
            investLabel={t("gameSettlementInvest")}
            winLabel={t("gameSettlementWin")}
          />
          <SettlementPodiumSlot
            {...(first ? { entry: first } : {})}
            size="lg"
            prizeMoney={prizeMoney}
            formatStake={formatStake}
            investLabel={t("gameSettlementInvest")}
            winLabel={t("gameSettlementWin")}
            featured
          />
          <SettlementPodiumSlot
            {...(third ? { entry: third } : {})}
            size="sm"
            prizeMoney={prizeMoney}
            formatStake={formatStake}
            investLabel={t("gameSettlementInvest")}
            winLabel={t("gameSettlementWin")}
          />
        </div>

        {others.length > 0 && (
          <section className="game-settlement__list-wrap">
            <header>{t("gameSettlementOthers")}</header>
            <div className="game-settlement__list">
              {others.map((entry) => (
                <article
                  className={
                    entry.id === userId ? "game-settlement__row is-you" : "game-settlement__row"
                  }
                  key={entry.id}
                >
                  <b>{entry.rank}</b>
                  <img src={resolvedAvatar(entry.avatar, entry.id)} alt="" />
                  <span>
                    <strong>{entry.name}</strong>
                    <small>#{entry.gameId}</small>
                  </span>
                  <div className="game-settlement__row-stats">
                    <span>
                      <small>{t("gameSettlementInvest")}</small>
                      <strong>{formatStake(entry.invest)}</strong>
                    </span>
                    <span className={isWinResult(entry.rank, entry.prize) ? "is-win" : "is-loss"}>
                      <small>{isWinResult(entry.rank, entry.prize) ? t("gameSettlementWin") : t("gameSettlementLoss")}</small>
                      <strong>{entry.prize > 0 ? prizeMoney(entry.prize) : formatStake(0)}</strong>
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {ownEntry && (
          <section className="game-settlement__self">
            <header>{t("gameSettlementYourResult")}</header>
            <article className="game-settlement__self-card">
              <img src={resolvedAvatar(ownEntry.avatar, ownEntry.id)} alt="" />
              <span>
                <strong>{ownEntry.name}</strong>
                <small>
                  #{ownEntry.rank} · #{ownEntry.gameId}
                </small>
              </span>
              <div className="game-settlement__row-stats">
                <span>
                  <small>{t("gameSettlementInvest")}</small>
                  <strong>{formatStake(ownEntry.invest)}</strong>
                </span>
                <span className={isWinResult(ownEntry.rank, ownEntry.prize) ? "is-win" : "is-loss"}>
                  <small>
                    {isWinResult(ownEntry.rank, ownEntry.prize) ? t("gameSettlementWin") : t("gameSettlementLoss")}
                  </small>
                  <strong>
                    {ownEntry.prize > 0 ? prizeMoney(ownEntry.prize) : formatStake(0)}
                  </strong>
                </span>
              </div>
            </article>
            {ownEntry.prize > 0 && (
              <p className="game-settlement__balance-note">{t("gameWinnerBalanceNote")}</p>
            )}
          </section>
        )}

        <button type="button" className="game-settlement__action" onClick={onExit}>
          {t("backToBracket")} ({t("gameSettlementAutoClose", { seconds: secondsLeft })})
        </button>
      </div>
    </div>
  );
}

function SettlementPodiumSlot({
  entry,
  size,
  featured = false,
  prizeMoney,
  formatStake,
  investLabel,
  winLabel,
}: {
  entry?: {
    id: string;
    rank: number;
    name: string;
    avatar: string;
    gameId: string;
    prize: number;
    invest: number;
  };
  size: "sm" | "md" | "lg";
  featured?: boolean;
  prizeMoney: (value: number) => string;
  formatStake: (value: number) => string;
  investLabel: string;
  winLabel: string;
}) {
  if (!entry) {
    return <div className={`game-settlement__podium-slot is-empty size-${size}`} />;
  }

  const RankIcon =
    entry.rank === 1 ? Crown : entry.rank === 2 ? Trophy : Award;

  return (
    <article
      className={`game-settlement__podium-slot size-${size}${featured ? " is-featured" : ""}`}
    >
      <span className="game-settlement__podium-rank">
        <RankIcon size={featured ? 18 : 14} />
        #{entry.rank}
      </span>
      <div className="game-settlement__podium-avatar">
        <img src={resolvedAvatar(entry.avatar, entry.id)} alt="" />
      </div>
      <strong>{entry.name}</strong>
      <div className="game-settlement__podium-stats">
        <span>
          <small>{investLabel}</small>
          <b>{formatStake(entry.invest)}</b>
        </span>
        <span className={entry.prize > 0 ? "is-win" : ""}>
          <small>{winLabel}</small>
          <b>{entry.prize > 0 ? prizeMoney(entry.prize) : formatStake(0)}</b>
        </span>
      </div>
    </article>
  );
}

const PlayerDicePod = memo(function PlayerDicePod({
  seat,
  color,
  player,
  participant,
  active,
  earlyFinishLabel,
  showTurnTimer,
  turnDeadline,
  turnTotalSeconds,
  diceValue,
  rolling,
  rollProgress,
  canRoll,
  simpleGameplay = false,
  bubble,
  onRoll,
}: {
  seat: number;
  color: (typeof COLORS)[number];
  player: GameRoom["players"][number]["user"];
  participant: GameRoom["players"][number]["participant"];
  active: boolean;
  earlyFinishLabel?: string | null;
  showTurnTimer: boolean;
  turnDeadline: string | null;
  turnTotalSeconds: number;
  diceValue: number | null;
  rolling: boolean;
  rollProgress: number;
  canRoll: boolean;
  simpleGameplay?: boolean;
  bubble: { id: string; kind: "chat" | "emoji"; content: string } | null;
  onRoll: () => void;
}) {
  const timer = useTurnTimer(
    showTurnTimer ? turnDeadline : null,
    turnTotalSeconds,
  );
  const turnProgress = timer.progress;
  const turnSecondsRemaining = timer.seconds;
  const bubbleText =
    bubble?.kind === "chat" && bubble.content.length > 40
      ? `${bubble.content.slice(0, 40)}…`
      : bubble?.content;
  const secondsLabel = Math.max(0, Math.ceil(turnSecondsRemaining));
  const urgentTimer = turnProgress <= 0.35;

  return (
    <article
      className={`game-player-pod glass seat-${seat} ${color} ${active ? "active" : ""} ${showTurnTimer ? "timer-running" : ""} ${participant.isEliminated ? "eliminated" : ""} ${earlyFinishLabel ? "finished-early" : ""}`}
      style={{
        "--turn-progress": `${turnProgress * 360}deg`,
      } as CSSProperties}
    >
      <div className="game-player-pod__top">
        <button
          className={`dice-button player-dice ${rolling ? "rolling" : ""} ${canRoll ? "can-roll" : ""}`}
          disabled={!canRoll || (rolling && !simpleGameplay)}
          onClick={onRoll}
          aria-label={canRoll ? "Roll dice" : `${player.name} dice`}
          style={
            rolling
              ? ({ "--roll-progress": `${rollProgress * 360}deg` } as CSSProperties)
              : undefined
          }
        >
          <DiceFace value={diceValue} rolling={rolling} />
        </button>
        {showTurnTimer && (
          <div
            className={`game-player-pod__turn-meter ${urgentTimer ? "is-urgent" : ""}`}
            role="timer"
            aria-live="off"
            aria-label={`${secondsLabel} seconds remaining`}
            style={
              {
                "--meter-fill": turnProgress,
              } as CSSProperties
            }
          >
            <span className="game-player-pod__turn-meter-value">{secondsLabel}s</span>
            <div className="game-player-pod__turn-meter-track">
              <i />
              <b aria-hidden="true" />
            </div>
          </div>
        )}
        <div className="game-player-pod__avatar">
          <img src={resolvedAvatar(player.avatar, player.gameId)} alt="" />
          {participant.placement && <b>#{participant.placement}</b>}
          {bubble && (
            <div
              className={`game-player-pod__bubble game-player-pod__bubble--${bubble.kind}`}
              key={bubble.id}
            >
              {bubble.kind === "emoji" ? (
                <span>{bubble.content}</span>
              ) : (
                bubbleText
              )}
            </div>
          )}
        </div>
      </div>
      <span className="game-player-pod__identity">
        <strong>
          {player.name}
          {player.isBot && <em className="player-bot-badge">BOT</em>}
        </strong>
        {earlyFinishLabel && (
          <em className="game-player-pod__winner-label">{earlyFinishLabel}</em>
        )}
        <span className="game-player-pod__meta">
          <small>#{player.gameId}</small>
        </span>
      </span>
      {participant.reconnectDeadline && (
        <ReconnectBadge deadline={participant.reconnectDeadline} />
      )}
    </article>
  );
});

const DiceFace = memo(function DiceFace({
  value,
  rolling = false,
  small = false,
}: {
  value: number | null;
  rolling?: boolean;
  small?: boolean;
}) {
  const visibleDots = new Set(DICE_DOTS[value ?? 0] ?? []);
  return (
    <span
      className={`dice-face ${small ? "small" : ""} ${rolling ? "is-rolling" : ""} ${value === null ? "empty" : ""}`}
      aria-hidden="true"
    >
      {Array.from({ length: 9 }, (_, index) => (
        <i className={visibleDots.has(index) ? "visible" : ""} key={index} />
      ))}
    </span>
  );
});

const LudoBoard = memo(function LudoBoard({
  room,
  userId,
  currentTurn,
  diceSpeed,
  simpleGameplay = false,
  onMove,
  busy,
  isDiceRolling,
  onStepSound,
  onKillSound,
  onKillReturnSound,
  onAnimatingChange,
}: {
  room: GameRoom;
  userId?: string | undefined;
  currentTurn: string | null;
  diceSpeed: "fast" | "normal" | "slow";
  simpleGameplay?: boolean;
  onMove: (tokenIndex: number) => void;
  busy: string;
  isDiceRolling?: (playerId: string) => boolean;
  onStepSound?: () => void;
  onKillSound?: () => void;
  onKillReturnSound?: () => void;
  onAnimatingChange?: (animating: boolean) => void;
}) {
  const state = room.state.boardState;
  const [displayPositions, setDisplayPositions] = useState(
    room.state.tokenPositions,
  );
  const [movingToken, setMovingToken] = useState<string | null>(null);
  const [movementHop, setMovementHop] = useState(-1);
  const [returnHop, setReturnHop] = useState(-1);
  const [activeHopMs, setActiveHopMs] = useState(TOKEN_STEP_MS);
  const [returningTokens, setReturningTokens] = useState<Set<string>>(
    () => new Set(),
  );
  const [killedImpactTokens, setKilledImpactTokens] = useState<Set<string>>(
    () => new Set(),
  );
  const finalPositionsRef = useRef(room.state.tokenPositions);
  const animationVersionRef = useRef(room.state.stateVersion);
  const animatingRef = useRef(false);
  const animatingActionKeyRef = useRef<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const onStepSoundRef = useRef(onStepSound);
  const onKillSoundRef = useRef(onKillSound);
  const onKillReturnSoundRef = useRef(onKillReturnSound);
  const isDiceRollingRef = useRef(isDiceRolling);
  const tokenSpeedRef = useRef(room.settings.tokenSpeed);
  const diceSpeedRef = useRef(diceSpeed);
  onStepSoundRef.current = onStepSound;
  onKillSoundRef.current = onKillSound;
  onKillReturnSoundRef.current = onKillReturnSound;
  isDiceRollingRef.current = isDiceRolling;
  tokenSpeedRef.current = room.settings.tokenSpeed;
  diceSpeedRef.current = diceSpeed;

  useLayoutEffect(() => {
    if (!movingToken && returningTokens.size === 0) return;
    const hopMs = activeHopMs;
    const returnHopMs = activeHopMs;
    const activeKeys = [
      ...(movingToken ? [movingToken] : []),
      ...returningTokens,
    ];
    for (const tokenKey of activeKeys) {
      const element = boardRef.current?.querySelector<HTMLElement>(
        `[data-token="${tokenKey}"]`,
      );
      if (!element) continue;
      const isReturning = returningTokens.has(tokenKey);
      const hopIndex = isReturning ? returnHop : movementHop;
      if (hopIndex < 0) continue;
      const hopAnimation = isReturning
        ? hopIndex % 2 === 0
          ? "token-return-hop-even"
          : "token-return-hop-odd"
        : hopIndex % 2 === 0
          ? "token-hop-even"
          : "token-hop-odd";
      const duration = isReturning ? returnHopMs : hopMs;
      element.style.animation = "none";
      void element.offsetWidth;
      element.style.animation = `${hopAnimation} ${duration}ms cubic-bezier(0.28, 0.72, 0.18, 1) both`;
    }
  }, [
    movementHop,
    returnHop,
    activeHopMs,
    movingToken,
    returningTokens,
    room.settings.tokenSpeed,
  ]);

  const ownPlayerIndex = room.players.findIndex(
    ({ user: player }) => player.id === userId,
  );
  const seatColors = useMemo(() => {
    const colors = [...COLORS];
    room.players.forEach((_, index) => {
      const boardSeat = getPlayerPodSeat(
        index,
        ownPlayerIndex,
        room.tournament.boardType,
      );
      colors[boardSeat] = COLORS[visualSeat(index, room.tournament.boardType)]!;
    });
    return colors;
  }, [ownPlayerIndex, room.players.length, room.tournament.boardType]);
  const activeSeats = useMemo(
    () =>
      new Set(
        room.players.map((_, index) =>
          getPlayerPodSeat(index, ownPlayerIndex, room.tournament.boardType),
        ),
      ),
    [ownPlayerIndex, room.players.length, room.tournament.boardType],
  );
  const cells = useMemo(() => {
    const trackMap = new Map(TRACK.map(([row, col], index) => [`${row}:${col}`, index]));
    const homeMap = new Map<string, string>();
    HOME_LANES.forEach((lane, seat) =>
      lane.forEach(([row, col]) => homeMap.set(`${row}:${col}`, seatColors[seat]!)),
    );
    return Array.from({ length: 225 }, (_, index) => {
      const row = Math.floor(index / 15);
      const col = index % 15;
      const key = `${row}:${col}`;
      const track = trackMap.get(key);
      const home = homeMap.get(key);
      let className = "board-cell";
      if (track !== undefined) {
        className += " path";
        const startSeat = START_CELLS.indexOf(track);
        if (startSeat >= 0) {
          className += ` start ${seatColors[startSeat]}`;
        } else if (room.rules.safeGlobalCells.includes(track)) {
          className += " safe";
        }
      } else if (home) {
        className += ` home-path ${home}`;
      } else if (row >= 6 && row <= 8 && col >= 6 && col <= 8) {
        className += " center";
      } else if (row < 6 && col < 6) {
        className += ` yard ${seatColors[0]} ${activeSeats.has(0) ? "active-yard" : "inactive-yard"}`;
      } else if (row < 6 && col > 8) {
        className += ` yard ${seatColors[1]} ${activeSeats.has(1) ? "active-yard" : "inactive-yard"}`;
      } else if (row > 8 && col > 8) {
        className += ` yard ${seatColors[2]} ${activeSeats.has(2) ? "active-yard" : "inactive-yard"}`;
      } else if (row > 8 && col < 6) {
        className += ` yard ${seatColors[3]} ${activeSeats.has(3) ? "active-yard" : "inactive-yard"}`;
      }
      return (
        <div
          className={className}
          key={key}
          style={{ gridRow: row + 1, gridColumn: col + 1 }}
        />
      );
    });
  }, [activeSeats, room.rules.safeGlobalCells, seatColors]);

  useEffect(() => {
    if (room.state.boardState.phase !== "completed") return;
    animatingRef.current = false;
    setDisplayPositions(room.state.tokenPositions);
    finalPositionsRef.current = room.state.tokenPositions;
    setMovingToken(null);
    setMovementHop(-1);
    setReturnHop(-1);
    setReturningTokens(new Set());
    setKilledImpactTokens(new Set());
  }, [room.state.boardState.phase, room.state.tokenPositions]);

  useEffect(() => {
    const action = room.state.boardState.lastAction;
    const actionKey = moveAnimationKey(room.state.stateVersion, action);

    if (animationVersionRef.current === room.state.stateVersion) {
      const actionUserId = action.userId;
      const diceStillRolling = Boolean(
        actionUserId && (isDiceRollingRef.current?.(actionUserId) ?? false),
      );
      if (
        !animatingRef.current &&
        !diceStillRolling &&
        !tokenPositionsEqual(displayPositions, room.state.tokenPositions)
      ) {
        setDisplayPositions(room.state.tokenPositions);
        finalPositionsRef.current = room.state.tokenPositions;
      }
      return;
    }

    if (animatingRef.current && animatingActionKeyRef.current === actionKey) {
      return;
    }

    animationVersionRef.current = room.state.stateVersion;
    const previous = finalPositionsRef.current;
    const next = room.state.tokenPositions;
    const canAnimate =
      (action.type === "move" ||
        action.type === "kill" ||
        action.type === "home") &&
      action.userId &&
      action.tokenIndex !== undefined &&
      action.from !== undefined &&
      action.to !== undefined;

    if (!canAnimate || simpleGameplay) {
      if (animatingRef.current) {
        return;
      }
      animatingActionKeyRef.current = null;
      finalPositionsRef.current = next;
      setDisplayPositions(next);
      setMovingToken(null);
      setMovementHop(-1);
      setReturnHop(-1);
      setReturningTokens(new Set());
      setKilledImpactTokens(new Set());
      return;
    }

    const playerId = action.userId!;
    const tokenIndex = action.tokenIndex!;
    const tokenKey = `${playerId}-${tokenIndex}`;
    const steps = buildTokenMovementSteps(action.from!, action.to!);
    const captured = resolveCapturedTokens(action, previous, next);
    const returnStepCount =
      captured.length > 0
        ? Math.max(...captured.map((item) => item.steps.length))
        : 0;

    let cancelled = false;
    const stepTimers: number[] = [];

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        stepTimers.push(window.setTimeout(resolve, ms));
      });

    const setAnimating = (value: boolean) => {
      animatingRef.current = value;
      onAnimatingChange?.(value);
    };

    const clearStepTimers = () => {
      for (const timerId of stepTimers) {
        window.clearTimeout(timerId);
      }
      stepTimers.length = 0;
    };

    const waitForDiceRollToFinish = async () => {
      if (simpleGameplay) return;
      const checkRolling = (id: string) => isDiceRollingRef.current?.(id) ?? false;
      while (checkRolling(playerId)) {
        if (cancelled) return;
        await sleep(40);
      }
      await sleep(getTokenMoveAfterDiceMs(tokenSpeedRef.current));
    };

    animatingActionKeyRef.current = actionKey;
    setAnimating(true);
    setDisplayPositions(previous);
    setMovingToken(tokenKey);
    setMovementHop(-1);
    setReturnHop(-1);
    setReturningTokens(new Set());
    setKilledImpactTokens(new Set());

    const waitForStep = (ms: number) =>
      new Promise<void>((resolve) => {
        stepTimers.push(
          window.setTimeout(() => {
            requestAnimationFrame(() => resolve());
          }, ms),
        );
      });

    const finishAnimation = () => {
      if (cancelled) return;
      cancelled = true;
      clearStepTimers();
      finalPositionsRef.current = next;
      animatingActionKeyRef.current = null;
      setAnimating(false);
      setDisplayPositions(next);
      setMovingToken(null);
      setMovementHop(-1);
      setReturnHop(-1);
      setReturningTokens(new Set());
      setKilledImpactTokens(new Set());
    };

    const maxDuration =
      getDiceRollDuration(diceSpeedRef.current) +
      getTokenMoveAfterDiceMs(tokenSpeedRef.current) +
      estimateForwardMoveDuration(
        tokenSpeedRef.current,
        action.from!,
        steps.length,
      ) +
      (captured.length > 0
        ? TOKEN_KILL_IMPACT_MS + TOKEN_KILL_RETURN_TOTAL_MS
        : 0) +
      1200;
    const failsafeTimer = window.setTimeout(finishAnimation, maxDuration);

    void (async () => {
      await waitForDiceRollToFinish();
      if (cancelled) return;

      const tokenSpeed = tokenSpeedRef.current;
      const returnStepDuration = getKillReturnStepDuration(
        tokenSpeed,
        returnStepCount,
      );

      for (let index = 0; index < steps.length; index += 1) {
        if (cancelled) return;
        const stepDuration = getForwardStepDuration(
          tokenSpeed,
          index,
          action.from!,
          steps.length,
        );
        setActiveHopMs(stepDuration);
        setDisplayPositions((current) => ({
          ...current,
          [playerId]: (current[playerId] ?? []).map((value, currentIndex) =>
            currentIndex === tokenIndex ? steps[index]! : value,
          ),
        }));
        setMovementHop(index);
        onStepSoundRef.current?.();
        await waitForStep(stepDuration);
      }

      if (cancelled) return;
      setMovingToken(null);

      if (captured.length === 0) {
        finishAnimation();
        return;
      }

      const capturedKeys = captured.map((item) => item.key);
      const killCell = action.to!;

      setDisplayPositions((current) => {
        const updated = Object.fromEntries(
          Object.entries(current).map(([id, values]) => [id, [...values]]),
        );
        captured.forEach((item) => {
          updated[item.playerId]![item.tokenIndex] = killCell;
        });
        return updated;
      });

      onKillSoundRef.current?.();
      setKilledImpactTokens(new Set(capturedKeys));
      await sleep(TOKEN_KILL_IMPACT_MS);
      if (cancelled) return;

      setKilledImpactTokens(new Set());
      setReturningTokens(new Set(capturedKeys));
      setReturnHop(-1);

      for (let index = 0; index < returnStepCount; index += 1) {
        if (cancelled) return;
        setActiveHopMs(returnStepDuration);
        setDisplayPositions((current) => {
          const updated = Object.fromEntries(
            Object.entries(current).map(([id, values]) => [id, [...values]]),
          );
          captured.forEach((item) => {
            updated[item.playerId]![item.tokenIndex] =
              item.steps[Math.min(index, item.steps.length - 1)]!;
          });
          return updated;
        });
        setReturnHop(index);
        onKillReturnSoundRef.current?.();
        await waitForStep(returnStepDuration);
      }

      finishAnimation();
    })();

    return () => {
      if (animatingActionKeyRef.current !== actionKey) {
        cancelled = true;
        clearStepTimers();
        window.clearTimeout(failsafeTimer);
        setAnimating(false);
      }
    };
  }, [
    room.state.boardState.lastAction.at,
    room.state.boardState.lastAction.from,
    room.state.boardState.lastAction.to,
    room.state.boardState.lastAction.tokenIndex,
    room.state.boardState.lastAction.type,
    room.state.boardState.lastAction.userId,
    room.state.stateVersion,
    onAnimatingChange,
    simpleGameplay,
  ]);

  const renderedTokens = useMemo(() => {
    const tokens = room.players.flatMap(({ user: player }, playerIndex) => {
      const colorSeat = visualSeat(playerIndex, room.tournament.boardType);
      const seat = getPlayerPodSeat(
        playerIndex,
        ownPlayerIndex,
        room.tournament.boardType,
      );
      return (displayPositions[player.id] ?? []).map((position, tokenIndex) => {
        const [row, col] = tokenCoordinate(
          position,
          tokenIndex,
          colorSeat,
          room.rules.homeLaneStart,
          room.rules.finishPosition,
        );
        return {
          player,
          color: COLORS[colorSeat]!,
          position,
          tokenIndex,
          tokenKey: `${player.id}-${tokenIndex}`,
          row,
          col,
          cellKey: `${row}:${col}`,
        };
      });
    });
    const groups = new Map<string, typeof tokens>();
    tokens.forEach((token) => {
      const group = groups.get(token.cellKey) ?? [];
      group.push(token);
      groups.set(token.cellKey, group);
    });
    return tokens.map((token) => {
      const group = groups.get(token.cellKey) ?? [token];
      return {
        ...token,
        stackIndex: group.findIndex((item) => item.tokenKey === token.tokenKey),
        stackSize: group.length,
      };
    });
  }, [
    displayPositions,
    ownPlayerIndex,
    room.players,
    room.rules.finishPosition,
    room.rules.homeLaneStart,
    room.tournament.boardType,
  ]);

  return (
    <div className="ludo-board" ref={boardRef}>
      {cells}
      {seatColors.map((color, seat) => (
        <div
          className={`board-yard-shell ${color}`}
          key={`${color}-${seat}`}
          style={{ gridArea: YARD_GRID_AREAS[seat] }}
        >
          <div className="board-yard-well">
            {Array.from({ length: 4 }, (_, index) => (
              <i key={index} />
            ))}
          </div>
        </div>
      ))}
      <div
        className="board-center-home"
        aria-hidden="true"
        style={{
          background: `conic-gradient(from 45deg, ${BOARD_COLOR_HEX[seatColors[1]!]} 0 25%, ${BOARD_COLOR_HEX[seatColors[2]!]} 0 50%, ${BOARD_COLOR_HEX[seatColors[3]!]} 0 75%, ${BOARD_COLOR_HEX[seatColors[0]!]} 0)`,
        }}
      >
        <span>✦</span>
      </div>
      {renderedTokens.map(
          ({
            player,
            color,
            position,
            tokenIndex,
            tokenKey,
            row,
            col,
            stackIndex,
            stackSize,
          }) => {
            const legal =
              player.id === userId &&
              player.id === currentTurn &&
              state.roll?.legalTokenIndexes.includes(tokenIndex);
            const diceRolling =
              !simpleGameplay && Boolean(isDiceRolling?.(player.id));
            const rollReady = Boolean(state.roll);
            const trackOffsets =
              position >= 0 && stackSize > 1
                ? STACK_OFFSETS[stackIndex % STACK_OFFSETS.length]!
                : [0, 0];
            const style = {
              left: `${((col + 0.5) / 15) * 100}%`,
              top: `${((row + 0.5) / 15) * 100}%`,
              "--token-offset-x": `${trackOffsets[0]}px`,
              "--token-offset-y": `${trackOffsets[1]}px`,
              "--token-stack": stackIndex,
            } as CSSProperties;
            const moving = movingToken === tokenKey;
            const returning = returningTokens.has(tokenKey);
            const killedImpact = killedImpactTokens.has(tokenKey);
            const hopping = moving || returning;
            return (
              <button
                className={`ludo-token ${color} ${position < 0 ? "in-yard" : ""} ${stackSize > 1 ? "stacked" : ""} ${legal ? "legal" : ""} ${moving ? "moving" : ""} ${returning ? "returning" : ""} ${killedImpact ? "killed-impact" : ""} ${hopping ? "hopping" : ""}`}
                style={{
                  ...style,
                  ...(hopping
                    ? ({ "--token-hop-ms": `${activeHopMs}ms` } as CSSProperties)
                    : {}),
                }}
                key={tokenKey}
                data-position={position}
                data-token={tokenKey}
                data-token-index={tokenIndex}
                disabled={
                  !legal ||
                  blocksTokenTap(busy) ||
                  Boolean(movingToken) ||
                  (diceRolling && !rollReady) ||
                  returningTokens.size > 0 ||
                  killedImpactTokens.size > 0
                }
                onClick={() => onMove(tokenIndex)}
                aria-label={`${player.name} token ${tokenIndex + 1}`}
              >
                <i />
                <Crown aria-hidden="true" />
              </button>
            );
          },
        )}
    </div>
  );
});

function tokenCoordinate(
  position: number,
  tokenIndex: number,
  boardSeat: number,
  homeLaneStart: number,
  finishPosition: number,
): [number, number] {
  if (position < 0) return YARDS[boardSeat]![tokenIndex]!;
  if (position >= finishPosition) {
    return HOME_LANES[boardSeat]![5]!;
  }
  if (position >= homeLaneStart) {
    const progress = Math.min(5, position - homeLaneStart);
    return HOME_LANES[boardSeat]![progress]!;
  }
  const offset = [0, 13, 26, 39][boardSeat]!;
  return TRACK[(offset + position) % 52]!;
}
