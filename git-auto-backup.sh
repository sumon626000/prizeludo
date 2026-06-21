#!/usr/bin/env bash
# 🔄 PrizeJito Git Auto-Backup
# Automatically commits and pushes local changes to GitHub
# Run manually: bash /home/nixbazar/prizeludo/git-auto-backup.sh
# Or set in .bashrc for auto-backup on SSH login

set -euo pipefail

REPO_DIR="/home/nixbazar/prizeludo"
LOG_FILE="$REPO_DIR/logs/git-backup.log"
BRANCH="main"

mkdir -p "$REPO_DIR/logs"

cd "$REPO_DIR"

# Check if there are any changes
if [[ -z "$(git status --porcelain)" ]]; then
  echo "$(date): ✅ No changes to backup" >> "$LOG_FILE"
  exit 0
fi

echo "$(date): 📦 Changes detected, backing up..." >> "$LOG_FILE"

# Add all changes (including new files)
git add -A

# Commit with timestamp
COMMIT_MSG="Auto-backup: $(date +"%Y-%m-%d %H:%M:%S")"
git commit -m "$COMMIT_MSG" >> "$LOG_FILE" 2>&1

# Push to GitHub
git push origin "$BRANCH" >> "$LOG_FILE" 2>&1

echo "$(date): ✅ Backup complete! Pushed to GitHub" >> "$LOG_FILE"
echo "$(date): 📝 Commit: $COMMIT_MSG" >> "$LOG_FILE"
