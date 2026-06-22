#!/usr/bin/env bash
# Fix everything: 503, JSON homepage error, missing web files, stale API build.
# Usage: bash /home/nixbazar/prizejito.com/scripts/webuzo-fix-all.sh
set -euo pipefail

REPO_DIR="${DEPLOY_REPO_PATH:-/home/nixbazar/prizejito.com}"
WEB_ROOT="${WEB_ROOT:-/home/nixbazar/prizejito.com}"
NODE_PORT="${NODE_PORT:-30047}"
PUBLIC_API_URL="${PUBLIC_API_URL:-https://prizejito.com}"
PUBLIC_WEB_ORIGIN="${PUBLIC_WEB_ORIGIN:-https://prizejito.com}"

echo "=============================================="
echo " PrizeJito — Fix All (site + API + web files)"
echo "=============================================="

cd "$REPO_DIR"

if [[ ! -f .env ]]; then
  echo "ERROR: Missing $REPO_DIR/.env" >&2
  exit 1
fi

echo "[1/7] Git update..."
git fetch origin main
git reset --hard origin/main

echo "[2/7] .env sync..."
grep -q '^WEB_ROOT=' .env || echo "WEB_ROOT=$WEB_ROOT" >> .env
grep -q '^DEPLOY_REPO_PATH=' .env || echo "DEPLOY_REPO_PATH=$REPO_DIR" >> .env
grep -q '^API_PUBLIC_URL=' .env || echo "API_PUBLIC_URL=$PUBLIC_API_URL" >> .env
grep -q '^WEB_ORIGIN=' .env || echo "WEB_ORIGIN=$PUBLIC_WEB_ORIGIN" >> .env
cp .env apps/api/.env
chmod 600 .env apps/api/.env

echo "[3/7] npm install..."
npm install --no-audit --no-fund

echo "[4/7] Build API + Web..."
cat > apps/web/.env.production <<EOF
VITE_API_URL=$PUBLIC_API_URL
EOF
npm run build

echo "[5/7] DB migrate..."
npm run db:migrate || true

echo "[6/7] Deploy web to domain root..."
mkdir -p "$WEB_ROOT"
cp -a apps/web/dist/. "$WEB_ROOT"/

if [[ -f apps/web/public/.htaccess && ! -f "$WEB_ROOT/.htaccess" ]]; then
  cp apps/web/public/.htaccess "$WEB_ROOT/.htaccess"
fi
if [[ -f "$WEB_ROOT/.htaccess" ]]; then
  sed -i "s/__NODE_PORT__/$NODE_PORT/g" "$WEB_ROOT/.htaccess"
fi

cat > "$WEB_ROOT/runtime-config.json" <<EOF
{"apiUrl":"$PUBLIC_API_URL","webOrigin":"$PUBLIC_WEB_ORIGIN"}
EOF

mkdir -p "$REPO_DIR/tmp"
touch "$REPO_DIR/tmp/restart.txt"

echo "[7/7] Health check..."
sleep 3
API_OK=0
WEB_OK=0
for attempt in 1 2 3 4 5 6 8 10; do
  if curl -fsS --max-time 10 "$PUBLIC_API_URL/api/health" >/dev/null 2>&1; then
    API_OK=1
  fi
  if curl -fsS --max-time 10 "$PUBLIC_WEB_ORIGIN/" 2>/dev/null | head -c 20 | grep -qi doctype; then
    WEB_OK=1
  fi
  if [[ "$API_OK" -eq 1 && "$WEB_OK" -eq 1 ]]; then
    break
  fi
  echo "  retry $attempt..."
  sleep 3
done

echo ""
echo "=============================================="
if [[ "$API_OK" -eq 1 ]]; then
  echo " API:  OK  $PUBLIC_API_URL/api/health"
else
  echo " API:  FAIL — Webuzo panel → prizejito → Start/Restart"
fi
if [[ "$WEB_OK" -eq 1 ]]; then
  echo " WEB:  OK  $PUBLIC_WEB_ORIGIN/"
else
  echo " WEB:  FAIL — run Webuzo Node Restart, then this script again"
fi
echo "=============================================="
ls -la "$WEB_ROOT/index.html" 2>/dev/null || echo "index.html missing!"

if [[ "$API_OK" -eq 0 || "$WEB_OK" -eq 0 ]]; then
  exit 1
fi
