#!/usr/bin/env python3
"""Show short-notice wakeboarding availability at Hove Lagoon (Ride the Cables).

Usage:
    python3 check.py                 # all openings, next 21 days
    python3 check.py --days 14       # custom horizon
    python3 check.py --weekend       # weekends only
    python3 check.py --json          # machine-readable output
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys

import lagoon_client as lc

CONFIG = pathlib.Path(__file__).with_name("courses.json")


def load_monitor() -> list[dict]:
    return json.loads(CONFIG.read_text())["monitor"]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=21, help="days ahead to scan (default 21)")
    ap.add_argument("--weekend", action="store_true", help="weekend sessions only")
    ap.add_argument("--json", action="store_true", help="emit JSON instead of text")
    args = ap.parse_args(argv)

    courses = lc.resolve_courses(load_monitor())
    slots = lc.find_openings(courses, days_ahead=args.days, weekend_only=args.weekend)

    if args.json:
        print(json.dumps([s.as_dict() for s in slots], indent=2))
        return 0

    scope = "weekend " if args.weekend else ""
    print(f"Wakeboarding {scope}openings at Hove Lagoon — next {args.days} days")
    print(f"Monitoring: {', '.join(c['label'] for c in courses)}\n")
    if not slots:
        print("No free slots found in window.")
        return 0

    last_day = None
    for s in slots:
        day = s.start.strftime("%a %d %b")
        if day != last_day:
            tag = "   <-- WEEKEND" if s.is_weekend else ""
            print(f"\n{day}{tag}")
            last_day = day
        print(f"   {s.start:%H:%M}  {s.label:8} {s.free}/{s.capacity} free")
    print(f"\n{len(slots)} open slot(s). Book: https://booking.lagoon.co.uk")
    return 0


if __name__ == "__main__":
    sys.exit(main())
