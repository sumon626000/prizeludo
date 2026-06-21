import { useCallback, useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { socket } from "../lib/socket";
import type { HomeSnapshot, HomeWinner } from "../types";

export function useHomeFeed(authenticated: boolean) {
  const [snapshot, setSnapshot] = useState<HomeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const next = await apiRequest<HomeSnapshot>("/api/home");
      setSnapshot(next);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Home feed failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [authenticated, refresh]);

  useEffect(() => {
    const onWinner = (winner: HomeWinner) => {
      setSnapshot((current) =>
        current
          ? {
              ...current,
              winners: [
                winner,
                ...current.winners.filter((item) => item.id !== winner.id),
              ].slice(0, 20),
            }
          : current,
      );
      void refresh();
    };
    const onSettings = (settings: HomeSnapshot["settings"]) => {
      setSnapshot((current) => (current ? { ...current, settings } : current));
    };
    const onHomeUpdate = (next: HomeSnapshot) => setSnapshot(next);
    const onTournament = () => void refresh();
    const onNotification = () => void refresh();

    socket.on("home:winner", onWinner);
    socket.on("home:settings-update", onSettings);
    socket.on("home:update", onHomeUpdate);
    socket.on("home:tournament-update", onTournament);
    socket.on("tournament:join", onTournament);
    socket.on("tournament:start", onTournament);
    socket.on("tournament:bracket-update", onTournament);
    socket.on("tournament:slot-update", onTournament);
    socket.on("tournament:round-start", onTournament);
    socket.on("lobby:round-start", onTournament);
    socket.on("system:state", onTournament);
    socket.on("notification:new", onNotification);
    return () => {
      socket.off("home:winner", onWinner);
      socket.off("home:settings-update", onSettings);
      socket.off("home:update", onHomeUpdate);
      socket.off("home:tournament-update", onTournament);
      socket.off("tournament:join", onTournament);
      socket.off("tournament:start", onTournament);
      socket.off("tournament:bracket-update", onTournament);
      socket.off("tournament:slot-update", onTournament);
      socket.off("tournament:round-start", onTournament);
      socket.off("lobby:round-start", onTournament);
      socket.off("system:state", onTournament);
      socket.off("notification:new", onNotification);
    };
  }, [refresh]);

  return { snapshot, loading, error, refresh };
}
