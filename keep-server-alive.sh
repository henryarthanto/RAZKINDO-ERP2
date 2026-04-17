#!/bin/bash
# Razkindo ERP - Keep Server Alive (consolidated watchdog)
# - Handles both dev and production modes
# - Reads .env to fix DATABASE_URL override
# - Starts event-queue mini-service
# - Uses relative paths (no hardcoded directories)

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$PROJECT_DIR/dev.log"
RESTART_LOG="$PROJECT_DIR/server-restart.log"

# Fix DATABASE_URL if system env has SQLite override
_ENV_FILE="$PROJECT_DIR/.env"
if [ -f "$_ENV_FILE" ]; then
  _DB_URL=$(grep '^DATABASE_URL=' "$_ENV_FILE" | head -1 | cut -d'=' -f2-)
  _DIRECT_URL=$(grep '^DIRECT_URL=' "$_ENV_FILE" | head -1 | cut -d'=' -f2-)
  if [ -n "$_DB_URL" ] && echo "$_DB_URL" | grep -q '^postgresql://'; then
    export DATABASE_URL="$_DB_URL"
  fi
  if [ -n "$_DIRECT_URL" ] && echo "$_DIRECT_URL" | grep -q '^postgresql://'; then
    export DIRECT_URL="$_DIRECT_URL"
  fi
fi

if ! curl -s -o /dev/null http://localhost:3000 2>/dev/null; then
  echo "[$(date)] Server down, restarting..." >> "$RESTART_LOG"
  # Kill leftover processes on common ports
  kill $(lsof -t -i:3000 2>/dev/null) 2>/dev/null
  kill $(lsof -t -i:3003 2>/dev/null) 2>/dev/null
  kill $(lsof -t -i:3004 2>/dev/null) 2>/dev/null
  sleep 1

  # Start event queue mini-service
  if [ -d "$PROJECT_DIR/mini-services/event-queue" ]; then
    cd "$PROJECT_DIR/mini-services/event-queue" && bun index.ts >> "$PROJECT_DIR/event-queue.log" 2>&1 &
    sleep 2
  fi

  # Start Next.js — prefer production standalone if available
  cd "$PROJECT_DIR"
  if [ -f ".next/standalone/server.js" ]; then
    echo "[$(date)] Starting production standalone server..." >> "$RESTART_LOG"
    HOSTNAME=0.0.0.0 PORT=3000 NODE_OPTIONS="--max-old-space-size=1536" \
      node .next/standalone/server.js >> "$LOG" 2>&1 &
  else
    echo "[$(date)] Starting dev server (no standalone build found)..." >> "$RESTART_LOG"
    HOSTNAME=0.0.0.0 PORT=3000 bun x next dev --turbopack >> "$LOG" 2>&1 &
  fi

  echo "[$(date)] Server restarted" >> "$RESTART_LOG"
fi
