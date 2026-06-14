#!/bin/bash
# Wrapper invoked by the launchd LaunchAgent (and runnable by hand).
# Runs the watcher and raises a macOS notification only for short-notice (URGENT) openings.
#
# Why a wrapper: launchd runs with a minimal environment, so we pin an absolute
# python and cd into the project. Keep this script's logic thin — the real work
# lives in watch.py so it stays portable to AWS Lambda later.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

PYTHON="${LAGOON_PYTHON:-/opt/homebrew/bin/python3}"
# Mode precedence: LAGOON_MODE env > state/mode file > "build" default.
# build = every firing; production = weekday-hourly + weekend-10min 08:00-16:00.
MODE_FILE="$PROJECT_DIR/state/mode"
if [ -n "${LAGOON_MODE:-}" ]; then
  MODE="$LAGOON_MODE"
elif [ -f "$MODE_FILE" ]; then
  MODE="$(tr -d '[:space:]' < "$MODE_FILE")"
else
  MODE="build"
fi
mkdir -p state

# Policy gate: launchd fires every 10 min, but only some firings do real work.
if ! "$PYTHON" -c "import sys,datetime,schedule_policy as p; sys.exit(0 if p.should_check(datetime.datetime.now(), '$MODE') else 9)"; then
  exit 0   # this firing is skipped by the schedule policy
fi

# Args after the script name are passed through to watch.py
OUT="$("$PYTHON" watch.py "$@" 2>>state/watch.err)"
FIRST="${OUT%%$'\n'*}"

printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M')" "$FIRST" >>state/watch.log

if [[ "$FIRST" == URGENT:* ]]; then
  COUNT="${FIRST#URGENT: }"
  printf '\n===== %s =====\n%s\n' "$(date '+%Y-%m-%d %H:%M')" "$OUT" >>state/notified.log
  # osascript is built in — no extra install needed.
  osascript -e "display notification \"${COUNT} short-notice slot(s) — book soon, see notified.log\" with title \"🏄 Hove Lagoon — spot free\" sound name \"Glass\"" || true
fi
