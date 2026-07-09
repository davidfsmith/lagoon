"""Per-user send-time filter for push notifications (Stage 2). Pure/injectable —
no AWS, no network — so it unit-tests with a mocked clock and in-memory subs.

Records are release_record dicts (key, label, start[UTC ISO], startLondon, free, book).
notifyLog is {slotKey: epochSecs}; distinct epochs on a London day = pushes that day
(coalesced slots share one epoch). pending is a list of slotKeys held over quiet hours.
"""
from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

LONDON = ZoneInfo("Europe/London")
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

BUFFER_MIN = 15          # see/decide/book/prep on top of travel
HORIZON_DAYS = 7
CAP_PER_DAY = 5
COOLDOWN_MIN = 30
QUIET_START_H = 21       # 21:00 London
QUIET_END_H = 8          # 08:00 London
DEFAULT_DAYS = list(WEEKDAYS)
DEFAULT_TYPES = ["Air 30", "Tech 30"]
DEFAULT_TRAVEL = 30
LOG_TTL_DAYS = 2         # prune notifyLog entries older than this


def _start(rec) -> dt.datetime:
    return dt.datetime.fromisoformat(rec["start"])


def _weekday(rec) -> str:
    return WEEKDAYS[_start(rec).astimezone(LONDON).weekday()]


def within_horizon(rec, now) -> bool:
    lead = (_start(rec) - now).total_seconds()
    return 0 <= lead <= HORIZON_DAYS * 86400


def is_reachable(rec, now, travel_mins) -> bool:
    lead_min = (_start(rec) - now).total_seconds() / 60
    return lead_min >= travel_mins + BUFFER_MIN


def is_candidate(rec, days, types, travel_mins, now) -> bool:
    return (within_horizon(rec, now)
            and _weekday(rec) in days
            and rec["label"] in types
            and is_reachable(rec, now, travel_mins))


def in_quiet_hours(now) -> bool:
    h = now.astimezone(LONDON).hour
    return h >= QUIET_START_H or h < QUIET_END_H


def _london_day(epoch, tz=LONDON):
    return dt.datetime.fromtimestamp(int(epoch), tz).date()


def _notified_today_keys(notify_log, now):
    today = now.astimezone(LONDON).date()
    return {k for k, v in notify_log.items() if _london_day(v) == today}


def cap_ok(notify_log, now) -> bool:
    today = now.astimezone(LONDON).date()
    epochs_today = {int(v) for v in notify_log.values() if _london_day(v) == today}
    if len(epochs_today) >= CAP_PER_DAY:
        return False
    if notify_log:
        last = max(int(v) for v in notify_log.values())
        if int(now.timestamp()) - last < COOLDOWN_MIN * 60:
            return False
    return True


def _prune(notify_log, now):
    cutoff = int(now.timestamp()) - LOG_TTL_DAYS * 86400
    return {k: int(v) for k, v in notify_log.items() if int(v) >= cutoff}


def filter_for_sub(sub, new_openings, current_open_by_key, now):
    """Decide what to send to one subscription this run.

    Returns (records_to_send | None, {"notifyLog": {...}, "pending": [...]}).
    new_openings: this run's released records. current_open_by_key: {key: record}
    of ALL currently-open slots (to re-check held slots). now: aware datetime.
    """
    days = list(sub.get("days") or DEFAULT_DAYS)
    types = list(sub.get("types") or DEFAULT_TYPES)
    travel = int(sub.get("travelMins") or DEFAULT_TRAVEL)
    notify_log = {k: int(v) for k, v in (sub.get("notifyLog") or {}).items()}
    pending = list(sub.get("pending") or [])

    dedupe = _notified_today_keys(notify_log, now)
    fresh = [r for r in new_openings
             if is_candidate(r, days, types, travel, now)
             and r["key"] not in dedupe and r["key"] not in pending]

    if in_quiet_hours(now):
        for r in fresh:
            if r["key"] not in pending:
                pending.append(r["key"])
        return (None, {"notifyLog": notify_log, "pending": pending})

    deliver = list(fresh)
    if pending:
        for key in pending:
            rec = current_open_by_key.get(key)
            if rec and is_candidate(rec, days, types, travel, now) and key not in dedupe:
                deliver.append(rec)
        pending = []   # one delivery attempt after quiet hours; survivors sent, rest dropped

    if not deliver or not cap_ok(notify_log, now):
        return (None, {"notifyLog": _prune(notify_log, now), "pending": pending})

    stamp = int(now.timestamp())
    for r in deliver:
        notify_log[r["key"]] = stamp
    return (deliver, {"notifyLog": _prune(notify_log, now), "pending": pending})
