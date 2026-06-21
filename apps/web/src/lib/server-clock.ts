import { useCallback, useEffect, useRef, useState } from "react";

export function serverOffsetMs(serverTime: string | Date): number {
  return new Date(serverTime).getTime() - Date.now();
}

export function syncedNowMs(offsetMs: number): number {
  return Date.now() + offsetMs;
}

export function msUntilDeadline(
  deadline: string | null,
  offsetMs: number,
): number {
  if (!deadline) return 0;
  return Math.max(
    0,
    new Date(deadline).getTime() - syncedNowMs(offsetMs),
  );
}

export function turnRemainingMs(
  turnStartedAt: string | null,
  turnDeadline: string | null,
  turnSeconds: number,
  offsetMs: number,
): number {
  const totalMs = turnSeconds * 1_000;
  if (turnStartedAt) {
    const elapsed =
      syncedNowMs(offsetMs) - new Date(turnStartedAt).getTime();
    return Math.max(0, Math.min(totalMs, totalMs - elapsed));
  }
  return Math.min(totalMs, msUntilDeadline(turnDeadline, offsetMs));
}

export function useServerClock(initialServerTime?: string | null) {
  const offsetRef = useRef(
    initialServerTime ? serverOffsetMs(initialServerTime) : 0,
  );

  const sync = useCallback((serverTime: string | Date) => {
    offsetRef.current = serverOffsetMs(serverTime);
  }, []);

  useEffect(() => {
    if (initialServerTime) sync(initialServerTime);
  }, [initialServerTime, sync]);

  const nowMs = useCallback(
    () => syncedNowMs(offsetRef.current),
    [],
  );

  return { sync, nowMs, offsetRef };
}

export function useSyncedCountdown(
  target: string | null,
  serverTime: string | null,
  intervalMs = 250,
) {
  const { sync, offsetRef } = useServerClock(serverTime);
  const calculate = useCallback(
    () => msUntilDeadline(target, offsetRef.current),
    [offsetRef, target],
  );
  const [remainingMs, setRemainingMs] = useState(calculate);

  useEffect(() => {
    sync(serverTime ?? new Date().toISOString());
    setRemainingMs(calculate());
    const timer = window.setInterval(() => setRemainingMs(calculate()), intervalMs);
    return () => window.clearInterval(timer);
  }, [calculate, intervalMs, serverTime, sync, target]);

  const seconds = Math.ceil(remainingMs / 1_000);
  return { remainingMs, seconds };
}

export function useSyncedTurnTimer(
  turnStartedAt: string | null,
  turnDeadline: string | null,
  turnSeconds: number,
  serverTime: string | null,
) {
  const { sync, offsetRef } = useServerClock(serverTime);
  const calculate = useCallback(
    () =>
      turnRemainingMs(
        turnStartedAt,
        turnDeadline,
        turnSeconds,
        offsetRef.current,
      ),
    [offsetRef, turnDeadline, turnSeconds, turnStartedAt],
  );
  const [remainingMs, setRemainingMs] = useState(calculate);

  useEffect(() => {
    if (serverTime) sync(serverTime);
    setRemainingMs(calculate());
    const timer = window.setInterval(() => setRemainingMs(calculate()), 100);
    return () => window.clearInterval(timer);
  }, [calculate, serverTime, sync, turnDeadline, turnStartedAt, turnSeconds]);

  return {
    remainingMs,
    seconds: Math.ceil(remainingMs / 1_000),
  };
}
