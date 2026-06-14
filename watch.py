#!/usr/bin/env python3
"""Watch for openings and alert only on imminent (short-notice) ones.

Runs repeatedly (via the scheduler). Every run it logs a full snapshot to
history.jsonl for analysis, and raises an alert (URGENT marker) only for open
slots within the short-notice window (default 48h lead) that it hasn't already
alerted on. Far-future openings are logged but never trigger a notification —
the Sunday churn data showed most weekend appearances were >7 days out, i.e.
not "grab it now" material.

Alert semantics: a slot alerts once when it enters the urgent window while open.
A slot first seen days out still alerts when it becomes imminent and is *still*
free. If a slot is booked and later frees again, it can alert again.

Usage:
    python3 watch.py                       # weekend slots, next 14 days
    python3 watch.py --all --days 21       # include weekdays, custom horizon
    python3 watch.py --urgent-hours 24     # tighten the short-notice window
    python3 watch.py --reset               # forget alert state

First stdout line is a marker the scheduler keys on:
    URGENT: <n>   one or more imminent openings not yet alerted (details follow)
    NONE          nothing new to alert
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
ALERTED = STATE_DIR / "alerted.json"
HISTORY = STATE_DIR / "history.jsonl"
URGENT_HOURS_DEFAULT = 48


def load_alerted() -> set:
    if ALERTED.exists():
        return set(json.loads(ALERTED.read_text()))
    return set()


def save_alerted(keys) -> None:
    STATE_DIR.mkdir(exist_ok=True)
    ALERTED.write_text(json.dumps(sorted(keys), indent=2))


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
                    help=f"alert only on slots within this lead time (default {URGENT_HOURS_DEFAULT})")
    ap.add_argument("--reset", action="store_true", help="clear alert state and exit")
    args = ap.parse_args(argv)

    if args.reset:
        ALERTED.unlink(missing_ok=True)
        print("Alert state cleared.")
        return 0

    monitor = lc.load_monitor(CONFIG)
    if not monitor:
        print("NONE")
        print("(no enabled sessions in courses.json)")
        return 0
    courses = lc.resolve_courses(monitor)

    # Fetch everything for comprehensive history; the alert scope narrows to
    # weekend unless --all.
    all_slots = lc.find_openings(courses, days_ahead=args.days, weekend_only=False)
    append_history(all_slots, days=args.days)
    slots = all_slots if args.all else [s for s in all_slots if s.is_weekend]

    now = dt.datetime.now(dt.timezone.utc)
    def lead(s):  # hours until session start
        return (s.start - now).total_seconds() / 3600

    urgent = [s for s in slots if 0 <= lead(s) <= args.urgent_hours]
    alerted = load_alerted()
    new_urgent = [s for s in urgent if s.key not in alerted]

    # Persist exactly the currently-urgent keys: stops still-open ones from
    # re-alerting, and drops booked/elapsed ones so they can re-alert if they
    # come back.
    save_alerted(s.key for s in urgent)

    if not new_urgent:
        print("NONE")
        print(f"({len(slots)} open, {len(urgent)} within {args.urgent_hours:.0f}h, none new to alert)")
        return 0

    print(f"URGENT: {len(new_urgent)}")
    scope = "weekend " if not args.all else ""
    print(f"Short-notice {scope}wakeboarding openings at Hove Lagoon "
          f"(within {args.urgent_hours:.0f}h):\n")
    last_day = None
    for s in sorted(new_urgent, key=lambda x: (x.start, x.label)):
        day = s.start.strftime("%a %d %b")
        if day != last_day:
            print(day)
            last_day = day
        print(f"   {s.start:%H:%M}  {s.label:8} {s.free}/{s.capacity} free  ({fmt_lead(lead(s))})")
    print("\nBook: https://booking.lagoon.co.uk")
    return 0


if __name__ == "__main__":
    sys.exit(main())
