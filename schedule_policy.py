"""When should the watcher actually run?

launchd fires the wrapper every 10 minutes; this gate decides whether a given
firing does real work. Keeping the policy here (not in the plist) makes it one
readable place to change, and it ports directly to EventBridge rules when this
moves to AWS — the Lambda itself stays a pure check, just as watch.py is.

Times are LOCAL (the Mac runs Europe/London).

Modes
-----
build       every firing runs (~every 10 min, 24/7) — dense data while building.
production  Dave's intended cadence:
            - weekdays: hourly (only the top-of-hour firing runs)
            - weekends: every 10 min between 08:00 and 16:00 (short-notice window)
"""

from __future__ import annotations

import datetime as _dt


def should_check(now: _dt.datetime, mode: str = "production") -> bool:
    if mode == "build":
        return True

    is_weekend = now.weekday() >= 5  # Sat=5, Sun=6
    if is_weekend:
        return 8 <= now.hour < 16
    # Weekday: hourly. launchd fires every 10 min, so only let the :00 run through.
    return now.minute < 10


if __name__ == "__main__":  # quick manual check
    import sys
    mode = sys.argv[1] if len(sys.argv) > 1 else "production"
    now = _dt.datetime.now()
    print(f"{now:%a %H:%M} mode={mode} -> {'RUN' if should_check(now, mode) else 'skip'}")
