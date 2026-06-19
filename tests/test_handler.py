"""Tests for the AWS Lambda handler logic (no AWS / boto3 needed).

Run: python3 tests/test_handler.py
"""
import datetime as dt
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))                       # lagoon_client
sys.path.insert(0, str(ROOT / "aws" / "lambda"))    # handler
from lagoon_client import Slot  # noqa: E402
import handler  # noqa: E402

UTC = dt.timezone.utc


def slot(course_id, label, run_id, start, free, capacity=2):
    return Slot(course_id=course_id, label=label, run_id=run_id, start=start,
                end=start + dt.timedelta(minutes=30), free=free, capacity=capacity)


class ReleaseRecord(unittest.TestCase):
    def test_record_shape_and_london_time(self):
        s = slot(51, "Air 30", 98652, dt.datetime(2026, 6, 21, 15, 30, tzinfo=UTC), 1)
        now = dt.datetime(2026, 6, 19, 23, 30, tzinfo=UTC)
        rec = handler.release_record(s, now)
        self.assertEqual(rec["label"], "Air 30")
        self.assertEqual(rec["runId"], 98652)
        self.assertEqual(rec["startLondon"], "2026-06-21T16:30")  # 15:30 UTC = 16:30 BST
        self.assertEqual(rec["free"], 1)
        self.assertEqual(rec["capacity"], 2)
        self.assertEqual(rec["book"], "https://booking.lagoon.co.uk/book?courseRunId=98652")
        self.assertAlmostEqual(rec["leadHours"], (s.start - now).total_seconds() / 3600, places=1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
