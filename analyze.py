#!/usr/bin/env python3
"""Turn state/history.jsonl into insights that should drive the AWS design.

The watcher appends one JSON line per run:
    {"t": <iso utc>, "scope": "all"|"weekend", "days": N, "open": {key: free}}
where key = "<courseId>@<startISO>".

By comparing consecutive snapshots we can see *churn*: when a slot becomes
available (appearance) and when it gets taken (disappearance / free drop). The
lead time (session start - moment it appeared/was taken) is the key number — it
tells us how often we'd actually need to check to catch short-notice spots, which
sizes the AWS schedule and DynamoDB write rate.

Usage:
    python3 analyze.py                 # weekend report (default)
    python3 analyze.py --all           # include weekdays (scope=all records only)
    python3 analyze.py --events        # also dump raw appearance/booking events
    python3 analyze.py --json          # machine-readable summary

Notes:
- Churn defaults to WEEKEND slots: those are present in every record regardless
  of the watcher's alert scope, so the diff is always consistent. Weekday churn
  (--all) only uses records logged with scope "all".
- The very first snapshot is treated as baseline (not counted as appearances).
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import pathlib
import statistics

HISTORY = pathlib.Path(__file__).with_name("state") / "history.jsonl"

# Offline label map for readability; unknown ids fall back to "c<id>".
LABELS = {50: "Tech 30", 51: "Air 30", 714: "Tech 15", 713: "Air 15"}

LEAD_BUCKETS = [
    ("<2h", 0, 2),
    ("2-6h", 2, 6),
    ("6-24h", 6, 24),
    ("1-3d", 24, 72),
    ("3-7d", 72, 168),
    (">7d", 168, float("inf")),
]


# --------------------------------------------------------------------------- #
# Loading / key helpers
# --------------------------------------------------------------------------- #

def load_history() -> list[dict]:
    if not HISTORY.exists():
        return []
    out = []
    for line in HISTORY.read_text().splitlines():
        line = line.strip()
        if line:
            out.append(json.loads(line))
    out.sort(key=lambda r: r["t"])
    return out


def key_start(key: str) -> dt.datetime:
    return dt.datetime.fromisoformat(key.split("@", 1)[1])


def key_course(key: str) -> int:
    return int(key.split("@", 1)[0])


def key_label(key: str) -> str:
    return LABELS.get(key_course(key), f"c{key_course(key)}")


def is_weekend(d: dt.datetime) -> bool:
    return d.weekday() >= 5


def bucket(hours: float) -> str:
    for name, lo, hi in LEAD_BUCKETS:
        if lo <= hours < hi:
            return name
    return ">7d"


def fmt_dur(hours: float) -> str:
    if hours < 1:
        return f"{round(hours * 60)}m"
    if hours < 48:
        return f"{hours:.1f}h"
    return f"{hours / 24:.1f}d"


# --------------------------------------------------------------------------- #
# Analysis
# --------------------------------------------------------------------------- #

def filter_open(record: dict, include_weekday: bool) -> dict:
    """Open dict for this record, restricted to the scope we trust."""
    if include_weekday:
        # weekday keys are only reliable in scope=all records
        if record.get("scope") != "all":
            return {k: v for k, v in record["open"].items() if is_weekend(key_start(k))}
        return dict(record["open"])
    return {k: v for k, v in record["open"].items() if is_weekend(key_start(k))}


def analyse(records: list[dict], include_weekday: bool) -> dict:
    # Weekday slots are only reliable in scope=all records; mixing in earlier
    # weekend-scope records would fabricate weekday "appearances" at the boundary.
    src = [r for r in records if r.get("scope") == "all"] if include_weekday else records
    snaps = [
        (dt.datetime.fromisoformat(r["t"]), filter_open(r, include_weekday))
        for r in src
    ]

    appearances = []  # slot became available: (when, key, free, lead_hours)
    bookings = []     # slot taken / free dropped: (when, key, lost, lead_hours)
    open_counts = []

    for i, (t, cur) in enumerate(snaps):
        open_counts.append(len(cur))
        if i == 0:
            continue
        prev = snaps[i - 1][1]
        for k, free in cur.items():
            lead = (key_start(k) - t).total_seconds() / 3600
            if k not in prev:                       # newly available
                if lead > -0.5:                     # ignore noise on just-passed slots
                    appearances.append((t, k, free, lead))
            elif free > prev[k]:                    # more spaces opened up
                appearances.append((t, k, free - prev[k], lead))
        for k, free in prev.items():
            lead = (key_start(k) - t).total_seconds() / 3600
            if lead <= 0:
                continue                            # left the window by elapsing, not booking
            if k not in cur:                        # last place taken
                bookings.append((t, k, free, lead))
            elif cur[k] < free:                     # a place taken (still some left)
                bookings.append((t, k, free - cur[k], lead))

    return {
        "snaps": snaps,
        "appearances": appearances,
        "bookings": bookings,
        "open_counts": open_counts,
    }


def coverage(records: list[dict]) -> dict:
    times = [dt.datetime.fromisoformat(r["t"]) for r in records]
    gaps = [(times[i] - times[i - 1]).total_seconds() / 60 for i in range(1, len(times))]
    return {
        "snapshots": len(records),
        "first": times[0],
        "last": times[-1],
        "span_h": (times[-1] - times[0]).total_seconds() / 3600,
        "median_gap_min": statistics.median(gaps) if gaps else 0,
        "max_gap_min": max(gaps) if gaps else 0,
    }


# --------------------------------------------------------------------------- #
# Reporting
# --------------------------------------------------------------------------- #

def bucket_counts(events) -> collections.Counter:
    c = collections.Counter()
    for ev in events:
        c[bucket(ev[3])] += 1
    return c


def print_report(records, include_weekday, show_events):
    cov = coverage(records)
    res = analyse(records, include_weekday)
    scope = "all sessions (weekday + weekend)" if include_weekday else "weekend sessions"

    print(f"Lagoon wake-watch analysis — {scope}")
    print("=" * 60)
    print(f"Snapshots:   {cov['snapshots']} over {fmt_dur(cov['span_h'])}")
    print(f"             {cov['first']:%a %d %b %H:%M} → {cov['last']:%a %d %b %H:%M}")
    print(f"Check gap:   median {cov['median_gap_min']:.0f} min, max {cov['max_gap_min']:.0f} min")
    if res["open_counts"]:
        oc = res["open_counts"]
        print(f"Open slots/snapshot: avg {statistics.mean(oc):.0f}, min {min(oc)}, max {max(oc)}")

    if cov["snapshots"] < 2:
        print("\nNeed at least 2 snapshots for churn analysis — let it run a while.")
        return

    apps, books = res["appearances"], res["bookings"]
    print(f"\nAVAILABILITY APPEARANCES: {len(apps)}  (a slot/place became bookable)")
    print("  by lead time before session start:")
    ab = bucket_counts(apps)
    for name, _, _ in LEAD_BUCKETS:
        if ab[name]:
            print(f"    {name:>6}: {ab[name]}")
    short = [a for a in apps if a[3] < 24]
    print(f"  short-notice (<24h lead): {len(short)} "
          f"({100 * len(short) / len(apps):.0f}%)" if apps else "  short-notice (<24h lead): 0")

    print(f"\nBOOKINGS (places taken): {len(books)}")
    print("  by lead time before session start:")
    bb = bucket_counts(books)
    for name, _, _ in LEAD_BUCKETS:
        if bb[name]:
            print(f"    {name:>6}: {bb[name]}")

    # When do openings exist? heatmap by weekday/hour of session start.
    heat = collections.Counter()
    seen = set()
    for _, cur in res["snaps"]:
        for k in cur:
            if k in seen:
                continue
            seen.add(k)
            s = key_start(k)
            heat[(s.strftime("%a"), s.hour)] += 1
    if heat:
        print("\nDISTINCT SESSIONS SEEN OPEN — by weekday × start hour:")
        hours = sorted({h for _, h in heat})
        days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        days = [d for d in days if any(dd == d for dd, _ in heat)]
        header = "      " + "".join(f"{h:>4}" for h in hours)
        print(header)
        for d in days:
            row = "".join(f"{heat.get((d, h), '') or '':>4}" for h in hours)
            print(f"  {d}: {row}")

    # Actionable hint for the AWS schedule.
    if short:
        leads = sorted(a[3] for a in short)
        p10 = leads[max(0, int(0.1 * len(leads)) - 1)]
        print(f"\nHINT: 10th-percentile short-notice lead time ≈ {fmt_dur(p10)}. "
              f"To catch most of these, check at least that often during the window.")

    if show_events:
        print("\nRAW EVENTS (appearances):")
        for t, k, free, lead in sorted(apps, key=lambda e: e[0]):
            print(f"  {t:%a %d %b %H:%M}  +{free} {key_label(k):8} "
                  f"{key_start(k):%a %d %b %H:%M} (lead {fmt_dur(lead)})")
        print("\nRAW EVENTS (bookings):")
        for t, k, lost, lead in sorted(books, key=lambda e: e[0]):
            print(f"  {t:%a %d %b %H:%M}  -{lost} {key_label(k):8} "
                  f"{key_start(k):%a %d %b %H:%M} (lead {fmt_dur(lead)})")


def json_summary(records, include_weekday) -> dict:
    cov = coverage(records)
    res = analyse(records, include_weekday)
    return {
        "scope": "all" if include_weekday else "weekend",
        "snapshots": cov["snapshots"],
        "span_hours": round(cov["span_h"], 1),
        "median_gap_min": round(cov["median_gap_min"], 1),
        "appearances": len(res["appearances"]),
        "appearances_by_lead": dict(bucket_counts(res["appearances"])),
        "bookings": len(res["bookings"]),
        "bookings_by_lead": dict(bucket_counts(res["bookings"])),
        "short_notice_under_24h": sum(1 for a in res["appearances"] if a[3] < 24),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--all", action="store_true", help="include weekdays (scope=all records)")
    ap.add_argument("--events", action="store_true", help="dump raw appearance/booking events")
    ap.add_argument("--json", action="store_true", help="machine-readable summary")
    args = ap.parse_args(argv)

    records = load_history()
    if not records:
        print(f"No history yet at {HISTORY}. Let the watcher run first.")
        return 1

    if args.json:
        print(json.dumps(json_summary(records, args.all), indent=2))
    else:
        print_report(records, args.all, args.events)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
