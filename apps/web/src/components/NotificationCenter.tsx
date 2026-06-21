import { useCallback, useEffect, useState } from "react";
import { Bell, CheckCheck, X } from "lucide-react";
import { apiRequest } from "../lib/api";
import { socket } from "../lib/socket";
import type { NotificationSnapshot } from "../types";

interface NotificationCenterProps {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function NotificationCenter({
  open,
  onClose,
  onChanged,
}: NotificationCenterProps) {
  const [snapshot, setSnapshot] = useState<NotificationSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSnapshot(
        await apiRequest<NotificationSnapshot>("/api/notifications?limit=60"),
      );
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Notifications failed.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const update = () => void refresh();
    socket.on("notification:new", update);
    socket.on("tournament:start", update);
    socket.on("tournament:round-start", update);
    socket.on("match:update", update);
    socket.on("wallet:update", update);
    return () => {
      socket.off("notification:new", update);
      socket.off("tournament:start", update);
      socket.off("tournament:round-start", update);
      socket.off("match:update", update);
      socket.off("wallet:update", update);
    };
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!open) return null;

  const markAllRead = async () => {
    await apiRequest("/api/notifications/read-all", { method: "PATCH" });
    await refresh();
    onChanged();
  };

  const markRead = async (id: string, isRead: boolean) => {
    if (isRead) return;
    await apiRequest(`/api/notifications/${id}/read`, { method: "PATCH" });
    setSnapshot((current) =>
      current
        ? {
            ...current,
            unreadCount: Math.max(0, current.unreadCount - 1),
            items: current.items.map((item) =>
              item.id === id ? { ...item, isRead: true } : item,
            ),
          }
        : current,
    );
    onChanged();
  };

  return (
    <div className="notification-backdrop" onMouseDown={onClose}>
      <aside
        className="notification-center glass"
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <span className="notification-center__icon">
            <Bell size={20} />
          </span>
          <div>
            <h2>Notifications</h2>
            <small>{snapshot?.unreadCount ?? 0} unread</small>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close notifications"
          >
            <X size={19} />
          </button>
        </header>

        <div className="notification-center__actions">
          <button
            className="text-button"
            disabled={!snapshot?.unreadCount}
            onClick={() => void markAllRead()}
          >
            <CheckCheck size={16} /> Mark all read
          </button>
        </div>

        <div className="notification-list">
          {loading && !snapshot && <p className="empty-state">Loading...</p>}
          {error && <p className="form-error">{error}</p>}
          {snapshot?.items.map((item) => (
            <button
              key={item.id}
              className={`notification-item ${item.isRead ? "" : "is-unread"}`}
              onClick={() => void markRead(item.id, item.isRead)}
            >
              <span className="notification-item__dot" />
              <span>
                <strong>{item.title}</strong>
                <p>{item.message}</p>
                <small>{formatTime(item.createdAt)}</small>
              </span>
            </button>
          ))}
          {!loading && snapshot?.items.length === 0 && (
            <p className="empty-state">No notifications yet.</p>
          )}
        </div>
      </aside>
    </div>
  );
}
