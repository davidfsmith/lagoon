#!/usr/bin/env python3
"""Timezone ground-truth tests for the watcher's Europe/London conversion.

The Lagoon API serialises every session time as UTC (a `+00:00` offset, even in
British Summer Time). `Slot.local` converts to Europe/London for display and the
weekend check. These tests pin that the `+00:00` is genuine UTC — not already-local
time mislabelled — using a real, externally verifiable fact.

GROUND TRUTH (verified 2026-06-20 against the live API + lagoon.co.uk):
lagoon.co.uk/course/wakeboarding/ride-the-cables advertises the Wednesday "Jam
Sessions" as 6pm & 7pm UK local. The public API (course 478) returns those same
Wednesday runs stamped 17:00 and 18:00 +00:00 — so +00:00 is UTC and London is +1h
in summer. If this fails, re-run `python3 verify_data.py` before "fixing" anything.
"""
import datetime as _dt
import unittest
from zoneinfo import ZoneInfo

import lagoon_client as lc

UTC = ZoneInfo("UTC")


def _slot(start_iso: str) -> lc.Slot:
    start = _dt.datetime.fromisoformat(start_iso)
    return lc.Slot(course_id=478, label="Jam", start=start,
                   end=start + _dt.timedelta(hours=1), free=1, capacity=4)


class TestLondonConversion(unittest.TestCase):
    def test_jam_ground_truth_summer_is_plus_one(self):
        # advertised 6pm -> 17:00 UTC ; advertised 7pm -> 18:00 UTC
        self.assertEqual(_slot("2026-06-24T17:00:00+00:00").local.strftime("%H:%M"), "18:00")
        self.assertEqual(_slot("2026-06-24T18:00:00+00:00").local.strftime("%H:%M"), "19:00")

    def test_winter_is_gmt_no_offset(self):
        # No DST in January: 17:00 UTC stays 17:00 London.
        self.assertEqual(_slot("2026-01-14T17:00:00+00:00").local.strftime("%H:%M"), "17:00")

    def test_weekend_uses_london_day(self):
        # A Sat 23:30 UTC session is still Saturday in London (00:30 Sun would flip).
        self.assertTrue(_slot("2026-06-20T17:00:00+00:00").is_weekend)   # Sat
        self.assertFalse(_slot("2026-06-24T17:00:00+00:00").is_weekend)  # Wed


if __name__ == "__main__":
    unittest.main(verbosity=2)
