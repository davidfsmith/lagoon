#!/usr/bin/env python3
"""Regression tests for fetch_openings pagination/horizon handling.

THE BUG (found 2026-06-20): the public API returns courseRuns ordered by runId
(creation order), NOT by startDate — dates are scattered across all pages. The old
code assumed ascending startDate and `return out`-ed on the first run past the
horizon, truncating mid-pagination and undercounting available sessions.

These tests feed runs in runId order (dates deliberately scattered, with a
beyond-horizon run appearing BEFORE later in-horizon runs, across a page boundary)
and assert every in-horizon free slot is still returned.
"""
import datetime as _dt
import unittest

import lagoon_client as lc

NOW = _dt.datetime(2026, 6, 20, 9, 0, tzinfo=_dt.timezone.utc)


def _run(run_id, start_iso, free=2, cap=2):
    return {
        "id": run_id,
        "startDate": start_iso,
        "endDate": start_iso,
        "maxNumbers": cap,
        "participantsCount": cap - free,
    }


# Runs in runId order, dates scattered. itemsPerPage=3, filteredCount=6 -> 2 pages.
# Page 1 has a BEYOND-horizon run (id 102, Aug 1) between two in-horizon runs;
# page 2 has more in-horizon runs the buggy early-return would never reach.
_PAGES = {
    1: [
        _run(101, "2026-06-21T15:00:00+00:00", free=2),   # in-horizon, keep
        _run(102, "2026-08-01T15:00:00+00:00", free=2),   # BEYOND horizon (Aug)
        _run(103, "2026-06-22T15:00:00+00:00", free=1),   # in-horizon, keep
    ],
    2: [
        _run(104, "2026-07-05T15:00:00+00:00", free=2),   # in-horizon, keep
        _run(105, "2026-06-19T15:00:00+00:00", free=2),   # PAST (before now), skip
        _run(106, "2026-07-10T15:00:00+00:00", free=1),   # in-horizon, keep
        _run(107, "2026-06-23T15:00:00+00:00", free=0),   # in-horizon but FULL, skip
    ],
}


def _fake_get(path, **params):
    page = params.get("page", 1)
    return {"data": _PAGES.get(page, []),
            "meta": {"itemsPerPage": 3, "filteredCount": 6}}


class FetchOpeningsOrdering(unittest.TestCase):
    def setUp(self):
        self._orig = lc._get
        lc._get = _fake_get

    def tearDown(self):
        lc._get = self._orig

    def test_finds_all_in_horizon_free_slots_despite_runid_ordering(self):
        slots = lc.fetch_openings(51, "Air 30", days_ahead=21, now=NOW)
        run_ids = sorted(s.run_id for s in slots)
        # 101,103 (page 1 after the Aug run), 104,106 (page 2) — NOT 102/105/107.
        self.assertEqual(run_ids, [101, 103, 104, 106])

    def test_excludes_beyond_horizon_and_past_and_full(self):
        slots = lc.fetch_openings(51, "Air 30", days_ahead=21, now=NOW)
        got = {s.run_id for s in slots}
        self.assertNotIn(102, got)  # beyond horizon
        self.assertNotIn(105, got)  # past
        self.assertNotIn(107, got)  # full (free=0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
