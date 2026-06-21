#!/usr/bin/env bash
# Quick live-site diagnostic (run on server).
# Usage: bash /home/nixbazar/prizeludo/scripts/check-domain.sh
set -euo pipefail

REPO_DIR="${DEPLOY_REPO_PATH:-/home/nixbazar/prizeludo}"
WEB_ROOT="${WEB_ROOT:-/home/nixbazar/prizejito.com}"
PUBLIC_WEB="${PUBLIC_WEB_ORIGIN:-https://prizejito.com}"
PUBLIC_API="${PUBLIC_API_URL:-https://api.prizejito.com}"

echo "=========================================="
echo " PrizeJito domain check"
echo " Web root: $WEB_ROOT"
echo " Repo:     $REPO_DIR"
echo "=========================================="

if [[ -d "$REPO_DIR/.git" ]]; then
  echo ""
  echo "[git]"
  git -C "$REPO_DIR" rev-parse --short HEAD
  git -C "$REPO_DIR" log -1 --format='  %s'
fi

echo ""
echo "[web root files]"
for f in index.html runtime-config.json prizejito-logo.png; do
  if [[ -f "$WEB_ROOT/$f" ]]; then
    echo "  OK  $f ($(wc -c <"$WEB_ROOT/$f") bytes)"
  else
    echo "  MISSING  $f"
  fi
done

if [[ -f "$WEB_ROOT/index.html" ]]; then
  ASSET="$(grep -oE 'assets/[^"]+\.js' "$WEB_ROOT/index.html" | head -n 1 || true)"
  echo "  JS asset: ${ASSET:-NOT FOUND}"
fi

if [[ -d "$WEB_ROOT/assets" ]]; then
  echo "  assets/: $(find "$WEB_ROOT/assets" -maxdepth 1 -type f | wc -l | tr -d ' ') files"
else
  echo "  MISSING  assets/ folder"
fi

echo ""
echo "[HTTP checks]"
check_url() {
  local url="$1"
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$url" || echo "000")"
  if [[ "$code" == "200" ]]; then
    echo "  OK  $code  $url"
  else
    echo "  FAIL $code  $url"
  fi
}

check_url "$PUBLIC_WEB/"
check_url "$PUBLIC_WEB/prizejito-logo.png"
check_url "$PUBLIC_WEB/runtime-config.json"
if [[ -n "${ASSET:-}" ]]; then
  check_url "$PUBLIC_WEB/$ASSET"
fi
check_url "$PUBLIC_API/api/health"

echo ""
echo "[deploy freshness]"
if [[ -f "$REPO_DIR/apps/web/dist/index.html" ]]; then
  REPO_ASSET="$(grep -oE 'assets/[^"]+\.js' "$REPO_DIR/apps/web/dist/index.html" | head -n 1 || true)"
  echo "  repo dist JS: ${REPO_ASSET:-none}"
  if [[ -n "${ASSET:-}" && -n "${REPO_ASSET:-}" && "$ASSET" != "$REPO_ASSET" ]]; then
    echo "  WARNING: web root is OLD — run: bash $REPO_DIR/scripts/update.sh"
  elif [[ -z "${ASSET:-}" ]]; then
    echo "  WARNING: web root index.html looks like dev source — run deploy"
  else
    echo "  web root matches latest repo dist"
  fi
else
  echo "  repo dist not built — run: bash $REPO_DIR/scripts/update.sh"
fi

if [[ -f "$WEB_ROOT/assets/index-"*.css ]]; then
  CSS_FILE="$(ls "$WEB_ROOT/assets"/index-*.css 2>/dev/null | head -n 1)"
  if grep -q "bg-game-icons" "$CSS_FILE" 2>/dev/null; then
    echo "  bg icons CSS: present"
  else
    echo "  bg icons CSS: missing (need latest deploy)"
  fi
fi

echo ""
echo "[API process]"
if [[ -f "$REPO_DIR/api.pid" ]] && kill -0 "$(cat "$REPO_DIR/api.pid")" 2>/dev/null; then
  echo "  OK  API pid $(cat "$REPO_DIR/api.pid")"
else
  echo "  WARN API pid file missing or process dead"
fi

echo ""
echo "Fix if site blank or old UI:"
echo "  cd $REPO_DIR"
echo "  git pull"
echo "  bash scripts/update.sh"
echo ""
echo "If old version stuck in browser:"
echo "  Chrome: DevTools -> Application -> Service Workers -> Unregister"
echo "  Then hard refresh (Ctrl+Shift+R)"
echo "=========================================="
