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


ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
KNOWN_TYPES = ["Air 30", "Tech 30", "Air 15", "Tech 15", "Taster", "Jam", "Drop-in",
               "Skills", "Tantrums", "Clinic"]
DEFAULT_TYPES = ["Air 30", "Tech 30"]
DEFAULT_TRAVEL = 30


def clean_prefs(prefs) -> dict:
    """Validate client prefs; fall back to defaults. Server-owned state is never here."""
    prefs = prefs if isinstance(prefs, dict) else {}
    days = [d for d in prefs.get("days", []) if d in ALL_DAYS]
    types = [t for t in prefs.get("types", []) if t in KNOWN_TYPES]
    try:
        travel = int(prefs.get("travelMins"))
    except (TypeError, ValueError):
        travel = DEFAULT_TRAVEL
    if travel < 0:
        travel = DEFAULT_TRAVEL
    return {
        "days": days or list(ALL_DAYS),
        "types": types or list(DEFAULT_TYPES),
        "travelMins": travel,
    }


def sub_item(subscription: dict, now_iso: str, prefs=None) -> dict:
    """DynamoDB item for a browser PushSubscription JSON + cleaned prefs."""
    keys = subscription.get("keys", {})
    return {
        "subId": sub_id(subscription["endpoint"]),
        "endpoint": subscription["endpoint"],
        "p256dh": keys["p256dh"],
        "authKey": keys["auth"],  # stored under a non-reserved name; source is Web Push "auth"
        "createdAt": now_iso,
        **clean_prefs(prefs),
    }


def subscribe_response(item: dict) -> dict:
    """200 body for a successful subscribe: ok + the prefs we actually STORED (after
    validation/stripping) so the client can reconcile its local state with the server."""
    return {"ok": True, "prefs": {"days": item["days"], "types": item["types"], "travelMins": item["travelMins"]}}


def parse_request(method: str, body: str):
    """(action, data) from an HTTP method + raw JSON body.

    ('subscribe', {...}) | ('suppress', {...}) | ('unsubscribe', endpoint) | ('error', reason)
    """
    try:
        data = json.loads(body or "{}")
    except ValueError:
        return ("error", "bad json")
    if method == "POST":
        supp = data.get("suppress")
        if isinstance(supp, dict) and isinstance(supp.get("endpoint"), str) and isinstance(supp.get("key"), str):
            return ("suppress", {"endpoint": supp["endpoint"], "key": supp["key"]})
        sub = data.get("subscription")
        keys = sub.get("keys") if isinstance(sub, dict) else None
        if (isinstance(sub, dict) and isinstance(sub.get("endpoint"), str)
                and isinstance(keys, dict) and keys.get("p256dh") and keys.get("auth")):
            return ("subscribe", {"subscription": sub, "prefs": data.get("prefs")})
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
        sub = data["subscription"]
        item = sub_item(sub, dt.datetime.now(dt.timezone.utc).isoformat(), data.get("prefs"))
        # Upsert prefs only; preserve server-owned notifyLog/pending if the item exists.
        table.update_item(
            Key={"subId": item["subId"]},
            UpdateExpression=("SET endpoint = :e, p256dh = :p, authKey = :a, "
                              "createdAt = if_not_exists(createdAt, :c), "
                              "#days = :days, #types = :types, travelMins = :tm"),
            ExpressionAttributeNames={"#days": "days", "#types": "types"},
            ExpressionAttributeValues={
                ":e": item["endpoint"], ":p": item["p256dh"], ":a": item["authKey"],
                ":c": item["createdAt"], ":days": item["days"], ":types": item["types"],
                ":tm": item["travelMins"]})
        return _resp(200, subscribe_response(item))
    if action == "suppress":
        # A rider cancelled a slot on their own device — don't notify THEM about the opening
        # they just created. Add {slotKey: expiryEpoch} to this sub's `suppress` map. Atomic
        # nested sets (no read → no clobber of the watcher's notifyLog/pending, and vice-versa);
        # `if_not_exists` first so it works for subs created before this attribute existed.
        SUPPRESS_TTL_SECS = 6 * 3600
        key = {"subId": sub_id(data["endpoint"])}
        exp = int(dt.datetime.now(dt.timezone.utc).timestamp()) + SUPPRESS_TTL_SECS
        table.update_item(Key=key,
            UpdateExpression="SET suppress = if_not_exists(suppress, :empty)",
            ExpressionAttributeValues={":empty": {}})
        table.update_item(Key=key,
            UpdateExpression="SET suppress.#k = :exp",
            ExpressionAttributeNames={"#k": data["key"]},
            ExpressionAttributeValues={":exp": exp})
        return _resp(200, {"ok": True})
    if action == "unsubscribe":
        table.delete_item(Key={"subId": sub_id(data)})
        return _resp(200, {"ok": True})
    return _resp(400, {"error": "unhandled"})
