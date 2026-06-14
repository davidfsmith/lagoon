#!/usr/bin/env python3
"""Watch for NEW short-notice openings and report only what's newly appeared.

Designed to be run repeatedly (e.g. by the scheduled agent). It keeps a small
state file of slots seen on the previous run and reports only slots that are new
since then — i.e. genuine short-notice openings (cancellations / released spots).

Usage:
    python3 watch.py                  # weekend slots, next 14 days (default)
    python3 watch.py --days 21 --all  # all slots, custom horizon
    python3 watch.py --reset          # forget state (next run reports everything)

Exit code is 0 always; stdout carries the report. The first line is a marker the
scheduler can key on:
    NEW: <n>     one or more new openings (details follow)
    NONE         nothing new since last run
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

import lagoon_client as lc

CONFIG = pathlib.Path(__file__).with_name("courses.json")
STATE = pathlib.Path(__file__).with_name("state") / "seen.json"


def load_monitor() -> list[dict]:
    return json.loads(CONFIG.read_text())["monitor"]


def load_state() -> dict:
    if STATE.exists():
        return json.loads(STATE.read_text())
    return {}


def save_state(seen: dict) -> None:
    STATE.parent.mkdir(exist_ok=True)
    STATE.write_text(json.dumps(seen, indent=2))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=14, help="days ahead to scan (default 14)")
    ap.add_argument("--all", action="store_true", help="include weekdays (default weekend only)")
    ap.add_argument("--reset", action="store_true", help="clear saved state and exit")
    args = ap.parse_args(argv)

    if args.reset:
        STATE.unlink(missing_ok=True)
        print("State cleared.")
        return 0

    courses = lc.resolve_courses(load_monitor())
    slots = lc.find_openings(
        courses, days_ahead=args.days, weekend_only=not args.all
    )

    # Current openings keyed by stable id → free count (so a spot freeing up
    # *more* on an already-seen session also counts as news).
    current = {s.key: s.free for s in slots}
    previous = load_state()

    new = [s for s in slots if s.key not in previous or s.free > previous.get(s.key, 0)]

    # State reflects what's currently open, so vanished slots can re-trigger later.
    save_state(current)

    if not new:
        print("NONE")
        print(f"(checked {len(courses)} courses, {len(slots)} open slots, none new)")
        return 0

    print(f"NEW: {len(new)}")
    scope = "weekend " if not args.all else ""
    print(f"New {scope}wakeboarding openings at Hove Lagoon (next {args.days} days):\n")
    last_day = None
    for s in sorted(new, key=lambda x: (x.start, x.label)):
        day = s.start.strftime("%a %d %b")
        if day != last_day:
            print(day)
            last_day = day
        print(f"   {s.start:%H:%M}  {s.label:8} {s.free}/{s.capacity} free")
    print("\nBook: https://booking.lagoon.co.uk")
    return 0


if __name__ == "__main__":
    sys.exit(main())
