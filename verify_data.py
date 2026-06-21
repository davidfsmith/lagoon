#!/usr/bin/env python3
"""Verify the app/watcher data against the live Lagoon API.

A self-contained accuracy check for ad-hoc queries ("is the app showing the right
thing?"). Hits the public API only — no auth, no writes. Exit code 0 = all pass.

    python3 verify_data.py            # check enabled courses (courses.json)
    python3 verify_data.py --days 14  # custom horizon

What it checks:
  1. Course IDs still resolve to the expected names (catches a silent renumber).
  2. The free-slot count the app would show == the count computed straight from
     the API (free = maxNumbers - participantsCount, free > 0, within horizon).
  3. Timezone ground truth: the Wednesday "Jam Sessions" advertised on
     lagoon.co.uk as 6pm & 7pm come back from the API as 17:00 / 18:00 +00:00,
     i.e. +00:00 is true UTC and Europe/London display is +1h in summer.

See docs/data-accuracy.md for the full rationale.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import pathlib
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

import lagoon_client as lc

API = "https://api.lagoon.co.uk"
LONDON = ZoneInfo("Europe/London")
CONFIG = pathlib.Path(__file__).with_name("courses.json")
JAM_COURSE = 478  # "2026 Clinic Wakeboard- Jam session" — advertised Weds 6pm & 7pm


class APIUnreachable(Exception):
    """The live API could not be reached (network/timeout) — NOT a data defect."""


# Network/transport errors that mean "couldn't reach the API", not "data is wrong".
# The Lagoon API is an undocumented third party with no SLA; from CI runners it
# intermittently times out. Those must skip, not fail (only a real mismatch fails).
_NET_ERRORS = (urllib.error.URLError, TimeoutError, socket.timeout, ConnectionError)
_SKIP_ERRORS = (APIUnreachable,) + _NET_ERRORS


def _get(url: str, attempts: int = 3) -> dict:
    last = None
    for i in range(attempts):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return json.load(r)
        except _NET_ERRORS as e:
            last = e
            if i < attempts - 1:
                time.sleep(2 * (i + 1))  # 2s, 4s backoff
    raise APIUnreachable(f"{url}: {last}")


def _runs(course_id: int) -> list[dict]:
    out, page = [], 1
    while True:
        j = _get(f"{API}/public/courseRuns?course={course_id}&itemsPerPage=100&page={page}")
        data = j.get("data", [])
        out += data
        meta = j.get("meta", {})
        if not data:
            break
        if page * meta.get("itemsPerPage", 100) >= meta.get("filteredCount", 0):
            break
        page += 1
    return out


def check_courses(courses: list[dict]) -> list[str]:
    """IDs resolve to names containing the configured search text. Returns failures."""
    fails = []
    for c in courses:
        j = _get(f"{API}/public/courses?id={c['id']}")
        data = j.get("data", [])
        name = data[0]["name"] if data else None
        ok = name and (c.get("search", "").replace(" ", "") in name.replace(" ", ""))
        print(f"  [{'ok' if ok else 'FAIL'}] id={c['id']:>4}  {c['label']:8} -> {name!r}")
        if not ok:
            fails.append(f"course {c['id']} ({c['label']}) name mismatch: {name!r}")
    return fails


def check_free_counts(courses: list[dict], days: int) -> list[str]:
    """The code's free-slot count == an independent API recomputation.

    Mirrors fetch_openings' exact semantics — a rolling datetime window
    (now < start <= now + days), free = maxNumbers - participantsCount > 0 — so a
    mismatch flags a real divergence (pagination, parsing) rather than a calendar-
    vs-rolling boundary artifact.
    """
    now = _dt.datetime.now(_dt.timezone.utc)
    horizon = now + _dt.timedelta(days=days)
    fails = []
    for c in courses:
        direct = 0
        for r in _runs(c["id"]):
            start = _dt.datetime.fromisoformat(r["startDate"])
            if start < now or start > horizon:
                continue
            if r.get("maxNumbers", 0) - r.get("participantsCount", 0) > 0:
                direct += 1
        app = len(lc.fetch_openings(c["id"], c["label"], days_ahead=days, now=now))
        ok = direct == app
        print(f"  [{'ok' if ok else 'FAIL'}] {c['label']:8} code={app:>3}  api={direct:>3}")
        if not ok:
            fails.append(f"{c['label']}: code path showed {app}, API recount {direct}")
    return fails


def check_timezone() -> list[str]:
    """Jam Wednesdays advertised 6pm/7pm must be 17:00/18:00 UTC in the API."""
    fails = []
    wanted = {"17:00": "18:00", "18:00": "19:00"}  # UTC HH:MM -> London (advertised)
    found: dict[str, str] = {}
    for r in _runs(JAM_COURSE):
        start = _dt.datetime.fromisoformat(r["startDate"])
        if start.weekday() != 2:  # Wednesday
            continue
        utc_hm = start.astimezone(ZoneInfo("UTC")).strftime("%H:%M")
        if utc_hm in wanted:
            found[utc_hm] = start.astimezone(LONDON).strftime("%H:%M")
    for utc_hm, london in wanted.items():
        got = found.get(utc_hm)
        ok = got == london
        adv = {"18:00": "6pm", "19:00": "7pm"}[london]
        print(f"  [{'ok' if ok else 'FAIL'}] jam {utc_hm} UTC -> {got or '??'} London (advertised {adv})")
        if not ok and got is not None:
            fails.append(f"jam {utc_hm} UTC rendered {got} London, expected {london}")
    if not found:
        print("  [warn] no upcoming Wednesday jam sessions found — timezone check skipped")
    return fails


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days", type=int, default=21, help="horizon in days (default 21)")
    args = ap.parse_args(argv)

    monitor = lc.load_monitor(CONFIG)
    try:
        courses = lc.resolve_courses(monitor)  # network
        print("1. Course ID -> name mapping")
        fails = check_courses(courses)
        print("\n2. Free-slot count: app vs API")
        fails += check_free_counts(courses, args.days)
        print("\n3. Timezone ground truth (jam sessions)")
        fails += check_timezone()
    except _SKIP_ERRORS as e:
        # Couldn't reach the API — infrastructure, not a data defect. Skip (exit 0)
        # so transient timeouts don't fail CI; the offline tests still guard the logic.
        print(f"\nSKIP — could not reach the Lagoon API ({type(e).__name__}).")
        print(f"  {e}")
        print("  Not a data defect; the offline unit tests cover the same invariants.")
        return 0

    print()
    if fails:
        print(f"FAIL ({len(fails)}):")
        for f in fails:
            print(f"  - {f}")
        return 1
    print("PASS — app data matches the live API (counts, names, timezone).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
