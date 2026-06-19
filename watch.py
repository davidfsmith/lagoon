#!/usr/bin/env python3
"""Watch for short-notice releases (cancellations) and alert only on those.

Runs repeatedly (via the scheduler). Every run it logs a full snapshot to
history.jsonl, then alerts (URGENT marker) when a session's free count has
*increased* since the last run — a place was released — for a slot within the
short-notice window (default 48h lead). Standing availability never alerts (use
the app to browse); only genuine releases do. (The Sunday→Thursday data showed
the old "open within window" model fired ~hourly for slots that were already
free as the weekend crossed the 48h line — noise, not cancellations.)

Tracking free counts per slot gives natural dedup: a release pings once; a spot
booked then released again pings again. A brand-new opening inside the window
(was full → now free) counts as a release.

Usage:
    python3 watch.py                       # weekend slots, next 14 days
    python3 watch.py --all --days 21       # include weekdays, custom horizon
    python3 watch.py --urgent-hours 24     # tighten the short-notice window
    python3 watch.py --reset               # forget free-count state

First stdout line is a marker the scheduler keys on:
    URGENT: <n>   one or more places released within the window (details follow)
    NONE          no new releases
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import sys

import lagoon_client as lc

CONFIG = pathlib.Path(__file__).with_name("courses.json")
STATE_DIR = pathlib.Path(__file__).with_name("state")
FREE = STATE_DIR / "free.json"
LEGACY_ALERTED = STATE_DIR / "alerted.json"
HISTORY = STATE_DIR / "history.jsonl"
URGENT_HOURS_DEFAULT = 48


def load_free() -> dict | None:
    """Previous run's {slot key: free count}, or None if there is no prior run."""
    if FREE.exists():
        return json.loads(FREE.read_text())
    return None


def save_free(free: dict) -> None:
    STATE_DIR.mkdir(exist_ok=True)
    FREE.write_text(json.dumps(free, indent=2, sort_keys=True))


def append_history(slots, days: int) -> None:
    """Append a compact snapshot of all current openings, one JSON line per run."""
    record = {
        "t": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "scope": "all",
        "days": days,
        "open": {s.key: s.free for s in slots},
    }
    STATE_DIR.mkdir(exist_ok=True)
    with HISTORY.open("a") as f:
        f.write(json.dumps(record) + "\n")


def fmt_lead(hours: float) -> str:
    if hours < 1:
        return f"in {round(hours * 60)}m"
    if hours < 24:
        return f"in {hours:.0f}h"
    return f"in {hours / 24:.1f}d"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=14, help="days ahead to scan (default 14)")
    ap.add_argument("--all", action="store_true", help="include weekdays (default weekend only)")
    ap.add_argument("--urgent-hours", type=float, default=URGENT_HOURS_DEFAULT,
                    help=f"alert only on releases within this lead time (default {URGENT_HOURS_DEFAULT})")
    ap.add_argument("--reset", action="store_true", help="clear free-count state and exit")
    args = ap.parse_args(argv)

    if args.reset:
        FREE.unlink(missing_ok=True)
        LEGACY_ALERTED.unlink(missing_ok=True)
        print("Free-count state cleared.")
        return 0

    monitor = lc.load_monitor(CONFIG)
    if not monitor:
        print("NONE")
        print("(no enabled sessions in courses.json)")
        return 0
    courses = lc.resolve_courses(monitor)

    # Fetch everything for comprehensive history and free-count tracking; the
    # alert scope narrows to weekend unless --all.
    all_slots = lc.find_openings(courses, days_ahead=args.days, weekend_only=False)
    append_history(all_slots, days=args.days)
    scoped = all_slots if args.all else [s for s in all_slots if s.is_weekend]

    now = dt.datetime.now(dt.timezone.utc)
    prev_free = load_free()
    released = lc.released_within_window(scoped, prev_free, now, args.urgent_hours)

    # Track free counts for ALL open slots (independent of --all) so release
    # detection is consistent and standing availability never re-alerts.
    save_free({s.key: s.free for s in all_slots})

    if not released:
        why = "first run, baseline recorded" if prev_free is None else "no new releases"
        print("NONE")
        print(f"({len(scoped)} open in scope; {why})")
        return 0

    print(f"URGENT: {len(released)}")
    scope = "weekend " if not args.all else ""
    print(f"Short-notice {scope}spots just released at Hove Lagoon "
          f"(within {args.urgent_hours:.0f}h):\n")
    last_day = None
    for s in sorted(released, key=lambda x: (x.start, x.label)):
        day = s.local.strftime("%a %d %b")
        if day != last_day:
            print(day)
            last_day = day
        lead = (s.start - now).total_seconds() / 3600
        print(f"   {s.local:%H:%M}  {s.label:8} {s.free}/{s.capacity} free  ({fmt_lead(lead)})")
    print("\nBook: https://booking.lagoon.co.uk")
    return 0


if __name__ == "__main__":
    sys.exit(main())
