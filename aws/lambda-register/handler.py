"""Registration Lambda (function URL): store / remove Web Push subscriptions.

Pure decision logic (sub_id, sub_item, parse_request) is importable without AWS
deps for tests; boto3 is imported inside lambda_handler.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json


def sub_id(endpoint: str) -> str:
    """Stable, bounded-length primary key for a subscription endpoint."""
    return hashlib.sha256(endpoint.encode()).hexdigest()


def sub_item(subscription: dict, now_iso: str) -> dict:
    """DynamoDB item for a browser PushSubscription JSON."""
    keys = subscription.get("keys", {})
    return {
        "subId": sub_id(subscription["endpoint"]),
        "endpoint": subscription["endpoint"],
        "p256dh": keys["p256dh"],
        "authKey": keys["auth"],  # stored under a non-reserved name; source is Web Push "auth"
        "createdAt": now_iso,
    }


def parse_request(method: str, body: str):
    """(action, data) from an HTTP method + raw JSON body.

    ('subscribe', subscription) | ('unsubscribe', endpoint) | ('error', reason)
    """
    try:
        data = json.loads(body or "{}")
    except ValueError:
        return ("error", "bad json")
    if method == "POST":
        sub = data.get("subscription")
        keys = sub.get("keys") if isinstance(sub, dict) else None
        if (isinstance(sub, dict) and isinstance(sub.get("endpoint"), str)
                and isinstance(keys, dict) and keys.get("p256dh") and keys.get("auth")):
            return ("subscribe", sub)
        return ("error", "missing subscription")
    if method == "DELETE":
        ep = data.get("endpoint")
        if ep:
            return ("unsubscribe", ep)
        return ("error", "missing endpoint")
    return ("error", "unsupported method")


def _resp(status: int, body: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json",
                    "access-control-allow-origin": "*",
                    "access-control-allow-methods": "POST, DELETE, OPTIONS",
                    "access-control-allow-headers": "content-type"},
        "body": json.dumps(body),
    }


def lambda_handler(event, context):
    import os
    import boto3

    method = event.get("requestContext", {}).get("http", {}).get("method", "")
    if method == "OPTIONS":
        return _resp(200, {"ok": True})  # CORS preflight

    action, data = parse_request(method, event.get("body", ""))
    if action == "error":
        return _resp(400, {"error": data})

    table = boto3.resource("dynamodb").Table(os.environ["SUBS_TABLE"])
    if action == "subscribe":
        table.put_item(Item=sub_item(data, dt.datetime.now(dt.timezone.utc).isoformat()))
        return _resp(200, {"ok": True})
    if action == "unsubscribe":
        table.delete_item(Key={"subId": sub_id(data)})
        return _resp(200, {"ok": True})
    return _resp(400, {"error": "unhandled"})
