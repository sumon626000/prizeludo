#!/usr/bin/env bash
# Update only what changed — domain / nginx / SSL / .env are NOT touched.
#
# Usage (on server):
#   bash /home/nixbazar/prizeludo/scripts/update-changed.sh
#
# Options:
#   --full       force full build (web + api + migrate)
#   --web-only   rebuild + copy frontend only
#   --api-only   rebuild + restart API only
#   --no-git     skip git fetch/reset (deploy current checkout)
#
set -euo pipefail

REPO_DIR="${DEPLOY_REPO_PATH:-/home/nixbazar/prizejito.com}"
WEB_ROOT="${WEB_ROOT:-/home/nixbazar/prizejito.com}"
BRANCH="${DEPLOY_BRANCH:-main}"
PUBLIC_API_URL="${PUBLIC_API_URL:-https://prizejito.com}"
PUBLIC_WEB_ORIGIN="${PUBLIC_WEB_ORIGIN:-https://prizejito.com}"
LOG_DIR="${DEPLOY_LOG_DIR:-$REPO_DIR/logs}"
STATE_FILE="${DEPLOY_STATE_FILE:-$REPO_DIR/.deploy-last-commit}"
DEPLOY_LOG="$LOG_DIR/deploy-changed.log"

MODE="smart"
SKIP_GIT=0

for arg in "$@"; do
  case "$arg" in
    --full) MODE="full" ;;
    --web-only) MODE="web" ;;
    --api-only) MODE="api" ;;
    --no-git) SKIP_GIT=1 ;;
    -h | --help)
      cat <<'EOF'
Usage: update-changed.sh [--full | --web-only | --api-only] [--no-git]

Smart update for a running domain:
  - Keeps prizejito.com / api.prizejito.com as-is (no nginx/SSL/.env changes)
  - Pulls latest main, rebuilds only changed parts, restarts API if needed

Default (--smart):
  - docs-only change  -> skip build
  - apps/web only     -> web build + copy to prizejito.com folder
  - apps/api only     -> api build + restart
  - both / packages   -> full build + migrate if drizzle changed

--full      always web + api + migrate
--web-only  frontend only
--api-only  backend only
--no-git    use files already on disk (no git fetch)
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

mkdir -p "$LOG_DIR"
exec > >(tee -a "$DEPLOY_LOG") 2>&1

echo "=== Smart update started $(date -u +"%Y-%m-%dT%H:%M:%SZ") mode=$MODE ==="
cd "$REPO_DIR"

PREV_COMMIT=""
if [[ -f "$STATE_FILE" ]]; then
  PREV_COMMIT="$(tr -d '[:space:]' <"$STATE_FILE")"
fi

if [[ "$SKIP_GIT" -eq 0 ]]; then
  echo "Fetching origin/$BRANCH..."
  git fetch origin "$BRANCH"
  git reset --hard "origin/$BRANCH"
  git clean -fd -- apps/web apps/api packages 2>/dev/null || git clean -fd
fi

NEW_COMMIT="$(git rev-parse HEAD)"
echo "Commit: $NEW_COMMIT $(git log -1 --format='%s')"

NEED_INSTALL=0
NEED_WEB=0
NEED_API=0
NEED_MIGRATE=0

if [[ "$MODE" == "full" ]]; then
  NEED_INSTALL=1
  NEED_WEB=1
  NEED_API=1
  NEED_MIGRATE=1
elif [[ "$MODE" == "web" ]]; then
  NEED_WEB=1
elif [[ "$MODE" == "api" ]]; then
  NEED_API=1
else
  if [[ -z "$PREV_COMMIT" || "$PREV_COMMIT" == "$NEW_COMMIT" ]]; then
    if [[ "$PREV_COMMIT" == "$NEW_COMMIT" && "$SKIP_GIT" -eq 0 ]]; then
      echo "Already deployed at $NEW_COMMIT — nothing to do."
      exit 0
    fi
    echo "First smart deploy or unknown base — running full build."
    NEED_INSTALL=1
    NEED_WEB=1
    NEED_API=1
    NEED_MIGRATE=1
  else
    mapfile -t CHANGED < <(git diff --name-only "$PREV_COMMIT" "$NEW_COMMIT")
    if [[ "${#CHANGED[@]}" -eq 0 ]]; then
      echo "No file changes detected."
      exit 0
    fi

    echo "Changed files (${#CHANGED[@]}):"
    printf '  - %s\n' "${CHANGED[@]}"

    DOC_ONLY=1
    for path in "${CHANGED[@]}"; do
      case "$path" in
        docs/*|*.md|WEBUZO_*|PRODUCTION_*|README*)
          continue
          ;;
        *)
          DOC_ONLY=0
          ;;
      esac

      case "$path" in
        package.json|package-lock.json|apps/web/package.json|apps/api/package.json|packages/*)
          NEED_INSTALL=1
          ;;
      esac

      case "$path" in
        apps/web/*) NEED_WEB=1 ;;
        apps/api/*) NEED_API=1 ;;
        packages/*)
          NEED_WEB=1
          NEED_API=1
          ;;
        scripts/*|docker-compose.yml|.github/*)
          NEED_WEB=1
          NEED_API=1
          ;;
      esac

      case "$path" in
        apps/api/drizzle/*) NEED_MIGRATE=1 ;;
      esac
    done

    if [[ "$DOC_ONLY" -eq 1 ]]; then
      echo "Documentation-only change — skipping build."
      printf '%s\n' "$NEW_COMMIT" >"$STATE_FILE"
      exit 0
    fi

    if [[ "$NEED_WEB" -eq 0 && "$NEED_API" -eq 0 ]]; then
      echo "No web/api changes — skipping build."
      printf '%s\n' "$NEW_COMMIT" >"$STATE_FILE"
      exit 0
    fi
  fi
fi

if [[ "$NEED_INSTALL" -eq 1 ]]; then
  echo "npm install..."
  npm install
fi

if [[ "$NEED_WEB" -eq 1 ]]; then
  echo "Building web..."
  cat > apps/web/.env.production <<EOF
VITE_API_URL=$PUBLIC_API_URL
EOF
  npm run build -w @khan-ludo/web
  mkdir -p "$WEB_ROOT"
  cp -a apps/web/dist/. "$WEB_ROOT"/
  cat > "$WEB_ROOT/runtime-config.json" <<EOF
{
  "apiUrl": "$PUBLIC_API_URL",
  "webOrigin": "$PUBLIC_WEB_ORIGIN",
  "updatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
  NODE_PORT="${NODE_PORT:-30047}"
  if [[ -f "$WEB_ROOT/.htaccess" ]]; then
    sed -i "s/__NODE_PORT__/$NODE_PORT/g" "$WEB_ROOT/.htaccess"
  fi
  echo "Web copied to $WEB_ROOT"
fi

if [[ "$NEED_API" -eq 1 ]]; then
  echo "Building API..."
  npm run build -w @khan-ludo/api
  if [[ "$NEED_MIGRATE" -eq 1 ]]; then
    echo "Running DB migrations..."
    npm run db:migrate
  fi
  bash "$REPO_DIR/scripts/webuzo-restart-api.sh"
  mkdir -p "$REPO_DIR/tmp"
  touch "$REPO_DIR/tmp/restart.txt"
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

printf '%s\n' "$NEW_COMMIT" >"$STATE_FILE"

if [[ "$HEALTH_OK" -ne 1 ]]; then
  echo "Update finished but API health check failed: $PUBLIC_API_URL/api/health" >&2
  tail -n 60 "$LOG_DIR/api.log" 2>/dev/null || true
  exit 1
fi

echo "Smart update OK at $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "  web=$NEED_WEB api=$NEED_API migrate=$NEED_MIGRATE install=$NEED_INSTALL"
echo "  domain unchanged — $PUBLIC_WEB_ORIGIN"
