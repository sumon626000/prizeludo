#!/usr/bin/env bash
# One-time setup: generate webhook secret and print GitHub webhook instructions.
set -euo pipefail

REPO_DIR="${DEPLOY_REPO_PATH:-/home/nixbazar/prizejito.com}"
ENV_FILE="${DEPLOY_ENV_FILE:-$REPO_DIR/.env}"
DOMAIN="${PUBLIC_WEB_ORIGIN:-https://prizejito.com}"

cd "$REPO_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — create .env first." >&2
  exit 1
fi

SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"

if grep -q '^GITHUB_WEBHOOK_SECRET=' "$ENV_FILE"; then
  sed -i "s/^GITHUB_WEBHOOK_SECRET=.*/GITHUB_WEBHOOK_SECRET=${SECRET}/" "$ENV_FILE"
else
  echo "GITHUB_WEBHOOK_SECRET=${SECRET}" >>"$ENV_FILE"
fi

grep -q '^DEPLOY_SCRIPT=' "$ENV_FILE" || echo "DEPLOY_SCRIPT=${REPO_DIR}/scripts/update-changed.sh" >>"$ENV_FILE"
grep -q '^DEPLOY_REPO_PATH=' "$ENV_FILE" || echo "DEPLOY_REPO_PATH=${REPO_DIR}" >>"$ENV_FILE"
grep -q '^WEB_ROOT=' "$ENV_FILE" || echo "WEB_ROOT=${REPO_DIR}" >>"$ENV_FILE"
grep -q '^DEPLOY_BRANCH=' "$ENV_FILE" || echo "DEPLOY_BRANCH=main" >>"$ENV_FILE"

cp "$ENV_FILE" apps/api/.env 2>/dev/null || true
chmod 600 "$ENV_FILE" apps/api/.env 2>/dev/null || true

echo ""
echo "=============================================="
echo " GitHub Auto-Deploy — Webuzo setup"
echo "=============================================="
echo ""
echo "1) GitHub → https://github.com/sumon626000/prizeludo/settings/hooks"
echo "   Add webhook:"
echo "     Payload URL: ${DOMAIN}/api/webhook/git-update"
echo "     Content type: application/json"
echo "     Secret: ${SECRET}"
echo "     Events: Just the push event"
echo ""
echo "2) Restart Node.js in Webuzo panel (load new .env)"
echo ""
echo "3) Test webhook: GitHub hook page → Recent Deliveries → ping"
echo "   Expected: 200 pong"
echo ""
echo "4) From PC: edit code → git push origin main"
echo "   Server auto-runs: scripts/update-changed.sh"
echo ""
echo "5) Watch deploy log:"
echo "   tail -f ${REPO_DIR}/logs/deploy-changed.log"
echo ""
echo "Secret saved in: $ENV_FILE"
echo "=============================================="
