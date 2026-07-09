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


def run(read_state, write_state, courses, now, urgent_hours, horizon_days,
        find_openings=lc.find_openings, send=None):
    """Detect weekend releases and record state. AWS-agnostic — state IO and the
    fetch are injected so this is unit-testable. Fetches first, so any fetch/read
    error aborts BEFORE state is written (never baseline-wipe on a transient error).
    """
    slots = find_openings(courses, days_ahead=horizon_days, weekend_only=True, now=now)
    prev = read_state()
    releases = lc.released_within_window(slots, prev, now, urgent_hours)
    write_state({s.key: s.free for s in slots})
    records = [release_record(s, now) for s in releases]
    for r in records:
        print(json.dumps({"release": r}))
    if records and send:
        send(records)
    print(json.dumps({"summary": {"released": len(records), "open": len(slots)}}))
    return records


def lambda_handler(event, context):
    import os
    import boto3
    from botocore.exceptions import ClientError

    s3 = boto3.client("s3")
    bucket = os.environ["STATE_BUCKET"]
    key = os.environ.get("STATE_KEY", "state/free.json")

    def read_state():
        try:
            body = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
            return json.loads(body)
        except ClientError as e:
            if e.response["Error"]["Code"] in ("NoSuchKey", "404"):
                return None
            raise

    def write_state(free):
        s3.put_object(Bucket=bucket, Key=key,
                      Body=json.dumps(free, sort_keys=True).encode(),
                      ContentType="application/json")

    subs_table = os.environ.get("SUBS_TABLE")
    vapid_param = os.environ.get("VAPID_PRIVATE_PARAM")

    def send(records):
        import push
        from pywebpush import webpush
        from py_vapid import Vapid01
        ddb = boto3.resource("dynamodb").Table(subs_table)
        subs = ddb.scan(ProjectionExpression="subId,endpoint,p256dh,authKey").get("Items", [])
        if not subs:
            return
        # SSM stores the VAPID key as PEM; parse it into a Vapid instance. Passing the
        # raw PEM string to webpush fails — it treats a non-file-path string as a
        # base64 DER key (Vapid.from_string), not PEM.
        pem = boto3.client("ssm").get_parameter(
            Name=vapid_param, WithDecryption=True)["Parameter"]["Value"]
        vapid = Vapid01.from_pem(pem.encode())
        dead = push.send_all(
            subs, push.build_payload(records), vapid, "mailto:dave@dave-smith.co.uk",
            poster=webpush, on_gone=lambda s: ddb.delete_item(Key={"subId": s["subId"]}))
        print(json.dumps({"pushSummary": {"subs": len(subs), "dead": len(dead)}}))

    courses = lc.resolve_courses(lc.load_monitor(CONFIG_PATH))
    records = run(
        read_state, write_state, courses,
        now=dt.datetime.now(dt.timezone.utc),
        urgent_hours=float(os.environ.get("URGENT_HOURS", "48")),
        horizon_days=int(os.environ.get("HORIZON_DAYS", "14")),
        send=send if subs_table else None,
    )
    return {"released": len(records)}
