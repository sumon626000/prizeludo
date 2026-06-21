import { io, type Socket } from "socket.io-client";
import { API_URL } from "./api";

const socketOptions = {
  autoConnect: false,
  withCredentials: true,
  transports: ["websocket", "polling"] as ("websocket" | "polling")[],
  reconnection: true,
  reconnectionAttempts: Number.POSITIVE_INFINITY,
  reconnectionDelay: 500,
  reconnectionDelayMax: 5_000,
  timeout: 12_000,
};

export let socket: Socket = io(API_URL, socketOptions);

export function reconfigureSocket(apiUrl: string) {
  if (socket.io.opts.hostname === new URL(apiUrl).hostname) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = io(apiUrl, socketOptions);
}
