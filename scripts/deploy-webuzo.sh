#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${DEPLOY_REPO_PATH:-/home/nixbazar/prizejito.com}"
WEB_ROOT="${WEB_ROOT:-/home/nixbazar/prizejito.com}"
BRANCH="${DEPLOY_BRANCH:-main}"
PUBLIC_API_URL="${PUBLIC_API_URL:-https://prizejito.com}"
PUBLIC_WEB_ORIGIN="${PUBLIC_WEB_ORIGIN:-https://prizejito.com}"
NODE_PORT="${NODE_PORT:-30047}"
LOG_DIR="${DEPLOY_LOG_DIR:-$REPO_DIR/logs}"
DEPLOY_LOG="$LOG_DIR/deploy.log"

mkdir -p "$LOG_DIR"
exec > >(tee -a "$DEPLOY_LOG") 2>&1

echo "=== Deploy started $(date -u +"%Y-%m-%dT%H:%M:%SZ") ==="

cd "$REPO_DIR"

git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

cat > apps/web/.env.production <<EOF
VITE_API_URL=$PUBLIC_API_URL
EOF

npm install
npm run build
npm run db:migrate

mkdir -p "$WEB_ROOT"
cp -a apps/web/dist/. "$WEB_ROOT"/

NODE_PORT="${NODE_PORT:-30047}"
if [[ -f "$WEB_ROOT/.htaccess" ]]; then
  sed -i "s/__NODE_PORT__/$NODE_PORT/g" "$WEB_ROOT/.htaccess"
fi

# Passenger/Webuzo: reload Node after new API build
mkdir -p "$REPO_DIR/tmp"
touch "$REPO_DIR/tmp/restart.txt"

cat > "$WEB_ROOT/runtime-config.json" <<EOF
{
  "apiUrl": "$PUBLIC_API_URL",
  "webOrigin": "$PUBLIC_WEB_ORIGIN",
  "updatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

if [[ -n "${DEPLOY_RESTART_COMMAND:-}" ]]; then
  echo "Running custom restart command..."
  bash -lc "$DEPLOY_RESTART_COMMAND"
else
  echo "Restarting API via webuzo-restart-api.sh..."
  bash "$REPO_DIR/scripts/webuzo-restart-api.sh"
fi

HEALTH_OK=0
for attempt in 1 2 3 4 5 6; do
  if curl -fsS --max-time 15 "$PUBLIC_API_URL/api/health" >/dev/null; then
    HEALTH_OK=1
    break
  fi
  echo "Health check attempt $attempt failed, retrying..."
  sleep 3
done

if [[ "$HEALTH_OK" -ne 1 ]]; then
  echo "Deploy finished but API health check failed: $PUBLIC_API_URL/api/health" >&2
  tail -n 60 "${DEPLOY_LOG_DIR:-$REPO_DIR/logs}/api.log" 2>/dev/null || true
  exit 1
fi

echo "Deploy finished OK at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
