#!/usr/bin/env bash
# One command: reset repo to GitHub main, build, deploy web, restart API, health check.
# Do NOT use git stash / git pull / git stash pop on the server.
#
# Usage:
#   bash /home/nixbazar/prizeludo/scripts/update.sh
#   bash /home/nixbazar/prizeludo/update.sh
#
set -euo pipefail

REPO_DIR="${DEPLOY_REPO_PATH:-$(cd "$(dirname "$0")/.." && pwd)}"
BRANCH="${DEPLOY_BRANCH:-main}"
PUBLIC_API_URL="${PUBLIC_API_URL:-https://prizejito.com}"

cd "$REPO_DIR"

echo "=========================================="
echo " PrizeJito server update"
echo " Repo:   $REPO_DIR"
echo " Branch: origin/$BRANCH"
echo "=========================================="

echo ""
echo "Step 1/4: Reset git (no stash, no pull conflicts)..."
git merge --abort 2>/dev/null || true
git rebase --abort 2>/dev/null || true
if git stash list | grep -q .; then
  echo "  Dropping old stashes..."
  git stash clear
fi
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"
git clean -fd -- apps/web apps/api packages 2>/dev/null || git clean -fd
echo "  At commit: $(git rev-parse --short HEAD) $(git log -1 --format='%s')"

echo ""
echo "Step 2/4: Build + deploy web + migrate DB..."
bash "$REPO_DIR/scripts/deploy-webuzo.sh"

echo ""
echo "Step 3/4: API health check..."
HEALTH_JSON=""
for attempt in 1 2 3 4 5 6; do
  if HEALTH_JSON="$(curl -fsS --max-time 15 "$PUBLIC_API_URL/api/health" 2>/dev/null)"; then
    echo "$HEALTH_JSON"
    break
  fi
  echo "  Attempt $attempt failed, retrying..."
  sleep 3
  HEALTH_JSON=""
done

echo ""
echo "Step 4/4: Done"
if [[ -z "$HEALTH_JSON" ]]; then
  echo "  API health FAILED: $PUBLIC_API_URL/api/health"
  tail -n 40 "${DEPLOY_LOG_DIR:-$REPO_DIR/logs}/api.log" 2>/dev/null || true
  exit 1
fi

echo "  Web:  https://prizejito.com"
echo "  API:  $PUBLIC_API_URL/api/health"
echo "=========================================="
