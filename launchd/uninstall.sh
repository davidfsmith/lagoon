#!/bin/bash
# Remove the local launchd schedule.
set -euo pipefail
LABEL="uk.co.lagoon.wakewatch"
DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$DEST"
echo "Removed $LABEL (project files left untouched)."
