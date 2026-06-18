"""Tests for watch.released_within_window — the release-based alert logic.

Run: python3 tests/test_watch.py   (exits non-zero on failure)
"""
import datetime as dt
import pathlib
import sys
import types
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from watch import released_within_window  # noqa: E402

NOW = dt.datetime(2026, 6, 18, 20, 0, tzinfo=dt.timezone.utc)


def slot(key, free, hours_ahead):
    """Lightweight stand-in for a Slot (only the fields the fn reads)."""
    return types.SimpleNamespace(
        key=key, free=free,
        start=NOW + dt.timedelta(hours=hours_ahead),
    )


class ReleaseDetection(unittest.TestCase):
    def test_baseline_run_never_alerts(self):
        # No prior state (first ever run) → record only, no alerts.
        slots = [slot("a", 2, 10)]
        self.assertEqual(released_within_window(slots, None, NOW, 48), [])

    def test_free_count_increase_is_a_release(self):
        slots = [slot("a", 2, 10)]
        out = released_within_window(slots, {"a": 1}, NOW, 48)
        self.assertEqual([s.key for s in out], ["a"])

    def test_unchanged_free_is_not_a_release(self):
        slots = [slot("a", 2, 10)]
        self.assertEqual(released_within_window(slots, {"a": 2}, NOW, 48), [])

    def test_newly_appearing_slot_within_window_alerts(self):
        # Was full/absent (no prior entry → treated as 0) now free → cancellation.
        slots = [slot("a", 1, 5)]
        out = released_within_window(slots, {}, NOW, 48)
        self.assertEqual([s.key for s in out], ["a"])

    def test_release_outside_window_does_not_alert(self):
        slots = [slot("a", 2, 100)]  # 100h ahead, window 48h
        self.assertEqual(released_within_window(slots, {"a": 1}, NOW, 48), [])

    def test_past_session_does_not_alert(self):
        slots = [slot("a", 2, -1)]
        self.assertEqual(released_within_window(slots, {"a": 1}, NOW, 48), [])

    def test_booking_decrease_is_not_a_release(self):
        slots = [slot("a", 1, 10)]
        self.assertEqual(released_within_window(slots, {"a": 2}, NOW, 48), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
