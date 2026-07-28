"""Watcher-side Web Push helpers. Pure/injectable so they unit-test without AWS
or network. Stage 1: one summary notification per run to every subscription.
"""
from __future__ import annotations

import datetime as dt
import json

APP_URL = "https://www.dave-smith.co.uk/lagoon/"

_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _pretty_date(start_london: str) -> str:
    """'2026-08-04T18:30' -> 'Tue 4 Aug' (London calendar date, no leading zero).
    Built manually rather than via strftime so it's locale- and platform-independent."""
    d = dt.date.fromisoformat(start_london[:10])
    return f"{_WEEKDAYS[d.weekday()]} {d.day} {_MONTHS[d.month - 1]}"


def build_payload(records: list[dict]) -> dict:
    """Notification payload for a batch of opening records, plus a deep-link target
    (the earliest slot's London date + key) so the tap opens that Day view.

    The body leads with the session's DATE. Without it a fully-reachable slot a week
    out ("Air 30 · 18:30 · 3 free") looks identical to an imminent, unreachable one —
    the alert lands at 18:30 today for an 18:30 session next Tuesday. The travel-time
    filter already guarantees enough lead; the date makes that visible to the reader."""
    n = len(records)
    earliest = min(records, key=lambda r: r["start"])
    if n == 1:
        r = records[0]
        body = f"{_pretty_date(r['startLondon'])} {r['startLondon'][11:]} · {r['label']} · {r['free']} free"
    else:
        body = f"{n} spots opened · from {_pretty_date(earliest['startLondon'])}"
    return {"title": "A spot opened at Hove Lagoon", "body": body, "url": APP_URL,
            "date": earliest["startLondon"][:10], "key": earliest["key"]}


def send_all(subs, payload, vapid_private_key, vapid_subject, poster, on_gone=None):
    """Send `payload` to every subscription via `poster`. Returns subIds that are
    Gone (HTTP 410) — expired subscriptions the caller should delete. `poster` has
    the pywebpush.webpush signature; `on_gone(sub)` is called per dead sub.
    """
    dead = []
    for s in subs:
        try:
            sub_info = {"endpoint": s["endpoint"],
                        "keys": {"p256dh": s["p256dh"], "auth": s["authKey"]}}
            poster(sub_info, json.dumps(payload),
                   vapid_private_key=vapid_private_key,
                   vapid_claims={"sub": vapid_subject})
        except Exception as e:  # noqa: BLE001 — pywebpush raises WebPushException
            status = getattr(getattr(e, "response", None), "status_code", None)
            if status in (404, 410):
                dead.append(s["subId"])
                if on_gone:
                    on_gone(s)
            else:
                print(json.dumps({"pushError": {"subId": s.get("subId"), "err": str(e)}}))
    return dead
