#!/usr/bin/env bash
# PrizeJito — one command: pull, build web, deploy to domain, restart API
set -euo pipefail

REPO_DIR="${DEPLOY_REPO_PATH:-/home/nixbazar/prizejito.com}"
WEB_ROOT="${WEB_ROOT:-/home/nixbazar/prizejito.com}"
BRANCH="${DEPLOY_BRANCH:-main}"

echo "=== PrizeJito game animation fix deploy ==="
cd "$REPO_DIR"

git fetch origin "$BRANCH"
git pull origin "$BRANCH" || git reset --hard "origin/$BRANCH"

cat > apps/web/.env.production <<'EOF'
VITE_API_URL=https://prizejito.com
EOF

cat > apps/web/public/runtime-config.json <<'EOF'
{
  "apiUrl": "https://prizejito.com",
  "webOrigin": "https://prizejito.com"
}
EOF

npm install
npm run build -w @khan-ludo/web

mkdir -p "$WEB_ROOT"
cp -a apps/web/dist/. "$WEB_ROOT"/

cat > "$WEB_ROOT/runtime-config.json" <<'EOF'
{
  "apiUrl": "https://prizejito.com",
  "webOrigin": "https://prizejito.com"
}
EOF

if [[ -f scripts/webuzo-restart-api.sh ]]; then
  API_RESTART_MODE=webuzo bash scripts/webuzo-restart-api.sh || true
fi

echo "Health:"
curl -fsS --max-time 15 "https://prizejito.com/api/health" || echo "API health pending — restart Node in Webuzo panel"
echo ""
echo "Done. Hard refresh browser (Ctrl+Shift+R) and test dice → token timing."
