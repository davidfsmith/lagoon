"""First-party RUM ingest Lambda. Pure core (unit-tested, no AWS) + thin handler.
Cookieless: the visitor id is a daily hash of secret+date+ip+ua; raw ip/ua are
never stored. Stdlib only — no Docker build."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import uuid

MAX_BYTES = 16 * 1024
MAX_EVENTS = 50
MAX_STR = 64
ROUTES = {"agenda", "account", "day", "lastminute", "settings", "login"}
EVENTS = {"notify_enable", "notify_disable", "login_success", "book_click", "discipline_switch"}


def visitor_hash(secret: str, date_str: str, ip: str, ua: str) -> str:
    # date in the hash => rotates at UTC midnight (daily anonymous id, not durable).
    return hashlib.sha256(f"{secret}|{date_str}|{ip}|{ua}".encode()).hexdigest()[:16]


def device_os(ua: str) -> tuple[str, str]:
    u = (ua or "").lower()
    if "iphone" in u or "ipad" in u or "ios " in u:
        os_ = "iOS"
    elif "android" in u:
        os_ = "Android"
    elif "mac os" in u or "macintosh" in u:
        os_ = "macOS"
    elif "windows" in u:
        os_ = "Windows"
    else:
        os_ = "Other"
    device = "mobile" if ("mobile" in u or "iphone" in u or "android" in u) else "desktop"
    return device, os_


def parse_client(headers: dict) -> tuple[str, str, str]:
    h = {(k or "").lower(): v for k, v in (headers or {}).items()}
    ip = ""
    addr = h.get("cloudfront-viewer-address") or ""
    if addr:
        ip = addr.rsplit(":", 1)[0]  # strip :port (hashed anyway; just needs to be stable)
    if not ip:
        ip = (h.get("x-forwarded-for") or "").split(",")[0].strip()
    ua = h.get("user-agent") or ""
    country = (h.get("cloudfront-viewer-country") or "").upper()[:2]
    return ip, ua, country


def _clamp(s, n=MAX_STR):
    return str(s)[:n] if s is not None else None


def clean_events(payload):
    """(sid, meta, events) or None. Drops anything off the allowlists."""
    if not isinstance(payload, dict):
        return None
    sid = _clamp(payload.get("sid"), 40)
    raw = payload.get("events")
    if not sid or not isinstance(raw, list):
        return None
    mi = payload.get("meta") or {}
    meta = {
        "ver": _clamp(mi.get("ver"), 16),
        "theme": mi.get("theme") if mi.get("theme") in ("light", "dark") else None,
        "disc": mi.get("disc") if mi.get("disc") in ("wake", "sup") else None,
        "standalone": bool(mi.get("standalone")),
        "ref": _clamp(mi.get("ref"), 128),
    }
    out = []
    for e in raw[:MAX_EVENTS]:
        if not isinstance(e, dict):
            continue
        if e.get("t") == "route" and e.get("route") in ROUTES:
            out.append({"t": "route", "route": e["route"]})
        elif e.get("t") == "event" and e.get("name") in EVENTS:
            rec = {"t": "event", "name": e["name"]}
            props = e.get("props")
            if e["name"] == "discipline_switch" and isinstance(props, dict) and props.get("to") in ("wake", "sup"):
                rec["to"] = props["to"]
            out.append(rec)
    if not out:
        return None
    return sid, meta, out
