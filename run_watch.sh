#!/bin/bash
# Wrapper invoked by the launchd LaunchAgent (and runnable by hand).
# Runs the watcher and raises a macOS notification when NEW openings appear.
#
# Why a wrapper: launchd runs with a minimal environment, so we pin an absolute
# python and cd into the project. Keep this script's logic thin — the real work
# lives in watch.py so it stays portable to AWS Lambda later.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

PYTHON="${LAGOON_PYTHON:-/opt/homebrew/bin/python3}"
mkdir -p state

# Args after the script name are passed through to watch.py
OUT="$("$PYTHON" watch.py "$@" 2>>state/watch.err)"
FIRST="${OUT%%$'\n'*}"

printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M')" "$FIRST" >>state/watch.log

if [[ "$FIRST" == NEW:* ]]; then
  COUNT="${FIRST#NEW: }"
  printf '\n===== %s =====\n%s\n' "$(date '+%Y-%m-%d %H:%M')" "$OUT" >>state/notified.log
  # osascript is built in — no extra install needed.
  osascript -e "display notification \"${COUNT} new weekend slot(s) — see notified.log\" with title \"🏄 Hove Lagoon availability\" sound name \"Glass\"" || true
fi
