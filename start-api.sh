#!/bin/bash
# 🚀 Prizejito API Starter (Permanent)
# This script starts the API in a fully detached state that survives
# SSH session close, terminal exit, and Webuzo process cleanup.

API_DIR="/home/nixbazar/prizeludo"
LOG_DIR="$API_DIR/logs"
PORT=30047

mkdir -p "$LOG_DIR"

# Kill existing if any
kill $(lsof -t -i:$PORT 2>/dev/null) 2>/dev/null || true
sleep 2

# Start fully detached - double fork technique
# This ensures the process is completely independent of the shell
(
  cd "$API_DIR"
  # Inner fork - completely detached
  (
    nohup node apps/api/dist/index.js > "$LOG_DIR/api.log" 2>&1 &
  ) &
)

sleep 3

# Verify
if curl -sf --max-time 3 http://127.0.0.1:$PORT/api/health >/dev/null 2>&1; then
  echo "✅ API started successfully on port $PORT"
  echo "🔗 https://api.prizejito.com"
else
  echo "⚠️ API may not be running. Check logs: $LOG_DIR/api.log"
fi
