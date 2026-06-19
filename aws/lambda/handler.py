"""AWS Lambda watcher: detect weekend releases, log them, keep S3 state.

Reuses lagoon_client (bundled alongside this file). No alerting in v1 — releases
are logged as structured JSON; the run summary is logged too. boto3 is imported
inside lambda_handler so this module imports cleanly without AWS deps (for tests).
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib

import lagoon_client as lc

BOOKING_SITE = "https://booking.lagoon.co.uk"
CONFIG_PATH = pathlib.Path(__file__).with_name("courses.json")


def release_record(slot, now: dt.datetime) -> dict:
    """Structured record for a detected release (logged; not published in v1)."""
    lead = (slot.start - now).total_seconds() / 3600
    return {
        "label": slot.label,
        "courseId": slot.course_id,
        "runId": slot.run_id,
        "startLondon": slot.local.strftime("%Y-%m-%dT%H:%M"),
        "free": slot.free,
        "capacity": slot.capacity,
        "leadHours": round(lead, 1),
        "book": f"{BOOKING_SITE}/book?courseRunId={slot.run_id}",
    }
