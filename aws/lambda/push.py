"""Watcher-side Web Push helpers. Pure/injectable so they unit-test without AWS
or network. Stage 1: one summary notification per run to every subscription.
"""
from __future__ import annotations

import json

APP_URL = "https://www.dave-smith.co.uk/lagoon/"


def build_payload(records: list[dict]) -> dict:
    """Notification payload for a batch of opening records, plus a deep-link target
    (the earliest slot's London date + key) so the tap opens that Day view."""
    n = len(records)
    earliest = min(records, key=lambda r: r["start"])
    if n == 1:
        r = records[0]
        body = f"{r['label']} · {r['startLondon'][11:]} · {r['free']} free — tap to view"
    else:
        body = f"{n} spots opened — tap to view"
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
