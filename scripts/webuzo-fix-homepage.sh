#!/usr/bin/env bash
# One-shot: pull, build, deploy static web, fix runtime-config + .htaccess
set -euo pipefail

REPO_DIR="${DEPLOY_REPO_PATH:-/home/nixbazar/prizejito.com}"
WEB_ROOT="${WEB_ROOT:-/home/nixbazar/prizejito.com}"
NODE_PORT="${NODE_PORT:-30047}"
PUBLIC_API_URL="${PUBLIC_API_URL:-https://prizejito.com}"
PUBLIC_WEB_ORIGIN="${PUBLIC_WEB_ORIGIN:-https://prizejito.com}"

echo "=== PrizeJito deploy: $REPO_DIR → $WEB_ROOT (port $NODE_PORT) ==="
cd "$REPO_DIR"

git fetch origin main
git reset --hard origin/main

grep -q '^WEB_ROOT=' .env || echo "WEB_ROOT=$WEB_ROOT" >> .env
grep -q '^DEPLOY_REPO_PATH=' .env || echo "DEPLOY_REPO_PATH=$REPO_DIR" >> .env
cp .env apps/api/.env
chmod 600 .env apps/api/.env

cat > apps/web/.env.production <<EOF
VITE_API_URL=$PUBLIC_API_URL
EOF

npm install
npm run build

mkdir -p "$WEB_ROOT"
cp -a apps/web/dist/. "$WEB_ROOT"/

if [[ -f "$WEB_ROOT/.htaccess" ]]; then
  sed -i "s/__NODE_PORT__/$NODE_PORT/g" "$WEB_ROOT/.htaccess"
fi

cat > "$WEB_ROOT/runtime-config.json" <<EOF
{"apiUrl":"$PUBLIC_API_URL","webOrigin":"$PUBLIC_WEB_ORIGIN"}
EOF

ls -la "$WEB_ROOT/index.html"
echo ""
echo "=== DONE — Restart Node.js in Webuzo panel ==="
echo "Check: curl -sI https://prizejito.com/ | head -1  (expect 200 OK)"
