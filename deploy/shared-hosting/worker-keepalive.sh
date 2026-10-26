#!/bin/sh
# Keeps the background worker running on shared hosting, where long-running
# processes can be stopped at any time. Run it from cron every minute:
#   * * * * * /home/USER/psg-survey-app/worker-keepalive.sh
# It starts the worker only when no worker from this folder is running, so a
# stopped worker is back within a minute. Restarting is safe: every job is
# claimed with a lease and every email has its own ledger row.
set -eu
APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")" && pwd)}"
NODE_BIN="${NODE_BIN:-/opt/alt/alt-nodejs24/root/usr/bin/node}"
PID_FILE="$APP_DIR/worker.pid"
LOG_FILE="$APP_DIR/logs/worker.log"
WEB_LOG="$APP_DIR/stderr.log"

# The web app's log (written by the web server) is kept small the same way, in place, as the server holds it open.
if [ -f "$WEB_LOG" ] && [ "$(wc -c < "$WEB_LOG")" -gt 10485760 ]; then
  cp "$WEB_LOG" "$WEB_LOG.1" && : > "$WEB_LOG"
fi

if [ -f "$PID_FILE" ]; then
  pid="$(cat "$PID_FILE")"
  # The pid may have been reused by another program: check it is this worker.
  if [ -n "$pid" ] && grep -q "worker.mjs" "/proc/$pid/cmdline" 2>/dev/null; then
    exit 0
  fi
fi

mkdir -p "$APP_DIR/logs"
# Keep the log small: start a new one past 10 MB, keeping one older copy.
if [ -f "$LOG_FILE" ] && [ "$(wc -c < "$LOG_FILE")" -gt 10485760 ]; then
  mv "$LOG_FILE" "$LOG_FILE.1"
fi

cd "$APP_DIR"
nohup "$NODE_BIN" --env-file="$APP_DIR/.env" "$APP_DIR/dist/worker.mjs" >> "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"
echo "$(date -u +%FT%TZ) worker started (pid $!)" >> "$LOG_FILE"
