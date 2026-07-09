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
        "start": slot.start.isoformat(),
        "key": slot.key,
        "free": slot.free,
        "capacity": slot.capacity,
        "leadHours": round(lead, 1),
        "book": f"{BOOKING_SITE}/book?courseRunId={slot.run_id}",
    }


def notify_filter_record(slot, now: dt.datetime) -> dict:
    """A live Slot, shaped as the record notify_filter expects (for the current
    open set — same shape as release_record's output)."""
    return release_record(slot, now)


def run(read_state, write_state, courses, now, urgent_hours, horizon_days,
        find_openings=lc.find_openings, send=None):
    """Detect weekend releases and record state. AWS-agnostic — state IO and the
    fetch are injected so this is unit-testable. Fetches first, so any fetch/read
    error aborts BEFORE state is written (never baseline-wipe on a transient error).
    """
    slots = find_openings(courses, days_ahead=horizon_days, weekend_only=False, now=now)
    prev = read_state()
    releases = lc.released_within_window(slots, prev, now, urgent_hours)
    write_state({s.key: s.free for s in slots})
    records = [release_record(s, now) for s in releases]
    for r in records:
        print(json.dumps({"release": r}))
    if records and send:
        send(records, slots, now)
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

    def send(records, slots, now):
        import push, notify_filter
        from pywebpush import webpush
        from py_vapid import Vapid01
        ddb = boto3.resource("dynamodb").Table(subs_table)
        subs = ddb.scan().get("Items", [])   # small items; no ProjectionExpression (reserved-word safe)
        if not subs:
            return
        current = {s.key: notify_filter_record(s, now) for s in slots}
        # SSM stores the VAPID key as PEM; parse it into a Vapid instance. Passing the
        # raw PEM string to webpush fails — it treats a non-file-path string as a
        # base64 DER key (Vapid.from_string), not PEM.
        pem = boto3.client("ssm").get_parameter(
            Name=vapid_param, WithDecryption=True)["Parameter"]["Value"]
        vapid = Vapid01.from_pem(pem.encode())
        sent = 0
        for sub in subs:
            to_send, state = notify_filter.filter_for_sub(sub, records, current, now)
            # Persist server-owned state only (never prefs), aliased (reserved words).
            # Single-writer: the watcher is the only writer of notifyLog/pending and runs as
            # one non-overlapping invocation per 10-min tick, so a plain SET is safe here.
            ddb.update_item(
                Key={"subId": sub["subId"]},
                UpdateExpression="SET #nl = :nl, #pd = :pd",
                ExpressionAttributeNames={"#nl": "notifyLog", "#pd": "pending"},
                ExpressionAttributeValues={":nl": state["notifyLog"], ":pd": state["pending"]})
            if not to_send:
                continue
            dead = push.send_all(
                [sub], push.build_payload(to_send), vapid, "mailto:dave@dave-smith.co.uk",
                poster=webpush, on_gone=lambda s: ddb.delete_item(Key={"subId": s["subId"]}))
            if not dead:
                sent += 1
        print(json.dumps({"pushSummary": {"subs": len(subs), "sent": sent}}))

    courses = lc.resolve_courses(lc.load_monitor(CONFIG_PATH))
    records = run(
        read_state, write_state, courses,
        now=dt.datetime.now(dt.timezone.utc),
        urgent_hours=float(os.environ.get("URGENT_HOURS", "48")),
        horizon_days=int(os.environ.get("HORIZON_DAYS", "14")),
        send=send if subs_table else None,
    )
    return {"released": len(records)}
