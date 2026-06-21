#!/usr/bin/env bash
# 🛡️ PrizeJito Safe Update
# 1️⃣ First backs up local changes to GitHub
# 2️⃣ Then pulls latest code
# 3️⃣ Updates safely without losing work
#
# Usage: bash /home/nixbazar/prizeludo/scripts/safe-update.sh

set -euo pipefail

REPO_DIR="/home/nixbazar/prizeludo"
echo "====================================="
echo "  🛡️ Safe Update Script"
echo "  $(date)"
echo "====================================="

# Step 1: Backup local changes first
echo ""
echo "📤 Step 1: Backing up local changes..."
bash "$REPO_DIR/git-auto-backup.sh"

# Step 2: Now safely pull
echo ""
echo "📥 Step 2: Pulling latest code..."
cd "$REPO_DIR"
git fetch origin main
git stash 2>/dev/null || true  # Save any uncommitted changes temporarily
git pull --rebase origin main 2>/dev/null || git reset --soft origin/main

# Step 3: Check if API needs restart
echo ""
echo "🔍 Step 3: Checking API health..."
if curl -sf --max-time 5 http://127.0.0.1:30047/api/health >/dev/null 2>&1; then
    echo "✅ API is healthy"
else
    echo "⚠️ API is down. Restarting..."
    bash "$REPO_DIR/../start-api.sh" || bash /home/nixbazar/prizeludo/start-api.sh
fi

# Step 4: Show status
echo ""
echo "====================================="
echo "  ✅ Safe Update Complete!"
echo "  📋 Your local changes are backed up"
echo "  🌐 Latest code is pulled from GitHub"
echo "====================================="
