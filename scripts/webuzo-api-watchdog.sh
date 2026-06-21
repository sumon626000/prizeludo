#!/usr/bin/env bash
set -euo pipefail

API_URL="${PUBLIC_API_URL:-https://api.prizejito.com}"
REPO_DIR="${DEPLOY_REPO_PATH:-/home/nixbazar/prizejito}"
LOG_FILE="${DEPLOY_LOG_DIR:-$REPO_DIR/logs}/watchdog.log"

mkdir -p "$(dirname "$LOG_FILE")"

if curl -fsS --max-time 12 "$API_URL/api/health" >/dev/null; then
  exit 0
fi

echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") API unhealthy, restarting..." >>"$LOG_FILE"
bash "$REPO_DIR/scripts/webuzo-restart-api.sh" >>"$LOG_FILE" 2>&1 || true

sleep 3
if curl -fsS --max-time 12 "$API_URL/api/health" >/dev/null; then
  echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") API recovered" >>"$LOG_FILE"
  exit 0
fi

echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") API still unhealthy after restart" >>"$LOG_FILE"
exit 1
