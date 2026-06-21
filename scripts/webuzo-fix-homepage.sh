#!/usr/bin/env bash
# Fix prizejito.com showing JSON NOT_FOUND instead of the React app.
# Run on Webuzo SSH as the site user.
set -euo pipefail

REPO_DIR="${DEPLOY_REPO_PATH:-/home/nixbazar/prizejito.com}"
WEB_ROOT="${WEB_ROOT:-/home/nixbazar/prizejito.com}"
NODE_PORT="${NODE_PORT:-30047}"
PUBLIC_API_URL="${PUBLIC_API_URL:-https://prizejito.com}"
PUBLIC_WEB_ORIGIN="${PUBLIC_WEB_ORIGIN:-https://prizejito.com}"

echo "=== Fix homepage: $REPO_DIR → $WEB_ROOT (Node port $NODE_PORT) ==="

cd "$REPO_DIR"

git pull origin main || true

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
{
  "apiUrl": "$PUBLIC_API_URL",
  "webOrigin": "$PUBLIC_WEB_ORIGIN",
  "updatedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

echo ""
echo "Static files deployed. Restart Node.js app in Webuzo panel now."
echo "Then check: curl -sI https://prizejito.com/ | head -1"
echo "Expected: HTTP/1.1 200 OK (HTML, not JSON)"
