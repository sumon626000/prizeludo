#!/usr/bin/env bash
# Reset / restart API only (no git pull, no web deploy).
#
# Usage:
#   bash /home/nixbazar/prizeludo/scripts/reset-api.sh
#   bash /home/nixbazar/prizeludo/scripts/reset-api.sh --build
#
set -euo pipefail

REPO_DIR="${DEPLOY_REPO_PATH:-$(cd "$(dirname "$0")/.." && pwd)}"
PUBLIC_API_URL="${PUBLIC_API_URL:-https://api.prizejito.com}"
BUILD=0

for arg in "$@"; do
  case "$arg" in
    --build) BUILD=1 ;;
    -h | --help)
      echo "Usage: reset-api.sh [--build]"
      echo "  --build  npm run build in apps/api before restart"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

cd "$REPO_DIR"

echo "==> API reset in $REPO_DIR"

if [[ "$BUILD" -eq 1 ]]; then
  echo "==> Building API..."
  npm run build --workspace=@khan-ludo/api 2>/dev/null || (cd apps/api && npm run build)
fi

bash "$REPO_DIR/scripts/webuzo-restart-api.sh"

echo "==> Health check: $PUBLIC_API_URL/api/health"
for attempt in 1 2 3 4 5 6; do
  if HEALTH="$(curl -fsS --max-time 15 "$PUBLIC_API_URL/api/health" 2>/dev/null)"; then
    echo "$HEALTH"
    exit 0
  fi
  echo "  attempt $attempt failed..."
  sleep 3
done

echo "API health check failed" >&2
tail -n 40 "${DEPLOY_LOG_DIR:-$REPO_DIR/logs}/api.log" 2>/dev/null || true
exit 1
