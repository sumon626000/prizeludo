#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${DEPLOY_REPO_PATH:-/home/nixbazar/prizeludo}"
PID_FILE="${API_PID_FILE:-$REPO_DIR/api.pid}"
LOG_FILE="${DEPLOY_LOG_DIR:-$REPO_DIR/logs}/api.log"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
ENV_FILE="${DEPLOY_ENV_FILE:-$REPO_DIR/.env}"
PUBLIC_API_URL="${PUBLIC_API_URL:-https://api.prizejito.com}"

mkdir -p "$(dirname "$LOG_FILE")"
cd "$REPO_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

if [[ ! -f apps/api/dist/index.js ]]; then
  echo "Missing API build: apps/api/dist/index.js" >&2
  exit 1
fi

read_env_port() {
  local raw
  raw="$(grep -E '^PORT=' "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '\r' || true)"
  if [[ -z "$raw" ]]; then
    echo 4000
  else
    echo "$raw"
  fi
}

api_health_ok() {
  curl -fsS --max-time 10 "$PUBLIC_API_URL/api/health" >/dev/null 2>&1
}

stop_pid() {
  local pid="$1"
  if [[ -z "$pid" ]]; then
    return 0
  fi
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 2
    kill -9 "$pid" 2>/dev/null || true
  fi
}

stop_port() {
  local port="$1"
  local pids=""

  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  elif command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" 2>/dev/null || true
    sleep 2
    return 0
  fi

  if [[ -n "$pids" ]]; then
    echo "Stopping process(es) on port $port: $pids"
    kill $pids 2>/dev/null || true
    sleep 2
    kill -9 $pids 2>/dev/null || true
  fi
}

port_is_free() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    ! lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi
  if command -v ss >/dev/null 2>&1; then
    ! ss -ltn "( sport = :$port )" 2>/dev/null | grep -q ":$port"
    return $?
  fi
  return 0
}

wait_for_port_free() {
  local port="$1"
  local attempt
  for attempt in 1 2 3 4 5 6 7 8; do
    if port_is_free "$port"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

PORT="$(read_env_port)"
RESTART_MODE="${API_RESTART_MODE:-auto}"

cp "$ENV_FILE" apps/api/.env
chmod 600 apps/api/.env

if [[ -f "$PID_FILE" ]]; then
  stop_pid "$(tr -d '[:space:]' <"$PID_FILE")"
  rm -f "$PID_FILE"
fi

pkill -f "apps/api/dist/index.js" 2>/dev/null || true
pkill -f "prizeludo/apps/api/dist/index.js" 2>/dev/null || true
stop_port "$PORT"
sleep 2

if [[ "$RESTART_MODE" == "webuzo" ]]; then
  echo "API_RESTART_MODE=webuzo — skip manual node start."
  echo "Restart in Webuzo: Applications -> Node.js -> api.prizejito.com -> Restart"
  if api_health_ok; then
    echo "Current API health: OK ($PUBLIC_API_URL/api/health)"
    exit 0
  fi
  echo "API health check failed. Restart the Webuzo Node app now." >&2
  exit 1
fi

if ! wait_for_port_free "$PORT"; then
  if api_health_ok; then
    echo "Port $PORT is still in use (likely Webuzo-managed API)."
    echo "Build is copied — restart via Webuzo panel to load new code:"
    echo "  Applications -> Node.js -> api.prizejito.com -> Restart"
    echo "Or set in .env: API_RESTART_MODE=webuzo"
    exit 0
  fi
  echo "Port $PORT is still in use and health check failed." >&2
  echo "Run: lsof -iTCP:$PORT -sTCP:LISTEN" >&2
  exit 1
fi

export NODE_ENV=production
nohup "$NODE_BIN" apps/api/dist/index.js >>"$LOG_FILE" 2>&1 &
echo $! >"$PID_FILE"
sleep 3

if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "API process failed to start. Check $LOG_FILE" >&2
  tail -n 40 "$LOG_FILE" >&2 || true
  exit 1
fi

if ! api_health_ok; then
  echo "API started (pid $(cat "$PID_FILE")) but health check failed." >&2
  tail -n 40 "$LOG_FILE" >&2 || true
  exit 1
fi

echo "API restarted with pid $(cat "$PID_FILE") on port $PORT"
