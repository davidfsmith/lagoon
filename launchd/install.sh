#!/bin/bash
# Install the local launchd schedule that runs the wake watcher on this Mac.
# Idempotent: safe to re-run after editing the plist or schedule.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="uk.co.lagoon.wakewatch"
DEST="$HOME/Library/LaunchAgents/$LABEL.plist"

# Render the template with the real project path.
sed "s#__PROJECT_DIR__#$PROJECT_DIR#g" \
    "$PROJECT_DIR/launchd/$LABEL.plist" > "$DEST"

# Reload (bootout is fine to fail if not already loaded).
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$DEST"
launchctl enable "gui/$(id -u)/$LABEL"

echo "Installed $LABEL"
echo "  plist:   $DEST"
echo "  runs:    08,10,12,14,16,18,20 UK time (daytime, every 2h)"
echo "  logs:    $PROJECT_DIR/state/"
echo
echo "Prime the state now so the first scheduled run only reports NEW slots:"
echo "  /opt/homebrew/bin/python3 $PROJECT_DIR/watch.py >/dev/null"
echo "Run once immediately to test:"
echo "  launchctl kickstart -k gui/$(id -u)/$LABEL"
