# Push Notifications — Stage 2 (per-user filter + anti-spam) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify each rider only about openings on their chosen days + types that they can still reach, within a 7-day horizon, without spamming (dedupe, daily cap, coalesce, quiet-hours hold-and-deliver) — gated `internal`.

**Architecture:** The watcher's detection broadens from weekend-48h to all-days-7-day. A new pure module `notify_filter.py` decides, per subscription, what to send now vs hold — from that run's new openings + the current open set + the sub's prefs/state + a clock. The watcher applies it per sub, sends via the Stage-1 `send_all`, and persists each sub's `notifyLog`/`pending` back to DynamoDB. Prefs (days/types/travelMins) live on the same item; the client re-POSTs `{subscription, prefs}` to the existing registration Lambda on subscribe and on any prefs change. Settings gains a prefs UI.

**Tech Stack:** Python 3.12 Lambda (`boto3`, DynamoDB, `pywebpush`, `zoneinfo`), vanilla-JS PWA, Node test runner, `pytest`.

**Scope:** Stage 2 of `docs/superpowers/specs/2026-07-09-push-notifications-stage2-design.md`. NOT in scope: intro slide, iOS onboarding, promotion to `beta`/GA (Stage 3).

---

## File Structure

**AWS (new):**
- `aws/lambda/notify_filter.py` — pure per-user filter (`filter_for_sub` + helpers).
- `aws/lambda/test_notify_filter.py` — pytest for it (mocked clock, in-memory subs).

**AWS (modified):**
- `aws/lambda/handler.py` — broaden detection; add UTC `start` to `release_record`; per-sub filtering in `send`; persist `notifyLog`/`pending`.
- `aws/cdk/lib/watcher-stack.ts` — `HORIZON_DAYS` 14→7 env (drop reliance on `URGENT_HOURS`).
- `aws/lambda-register/handler.py` — accept + validate `prefs`; upsert prefs without clobbering `notifyLog`/`pending`.
- `aws/lambda-register/test_register.py` — prefs validation tests.
- `.github/workflows/ci.yml` — run the new `test_notify_filter.py`.

**Client (modified):**
- `app/js/store.js` — `getNotifyPrefs`/`setNotifyPrefs`.
- `app/js/push.js` — send `prefs` on `subscribe`; add `syncPrefs()`.
- `app/js/views/settings.js` — prefs UI (days / types / travel) under the enable toggle.
- `app/js/config.js` + `app/sw.js` — v51→v52 bump.
- `app/test/push.test.js` / `app/test/store.test.js` — prefs helper + body-shape tests.

---

## Task 1: Broaden detection + absolute start on the record

**Files:** Modify `aws/lambda/handler.py`; Test `aws/lambda/test_push.py`.

- [ ] **Step 1: Write the failing test.** Append to `aws/lambda/test_push.py`:

```python
def test_release_record_includes_utc_start():
    import datetime as dt
    import handler

    class Slot:
        label = "Tech 30"; course_id = 50; run_id = 9
        free = 1; capacity = 2
        start = dt.datetime(2026, 7, 12, 17, 0, tzinfo=dt.timezone.utc)
        local = dt.datetime(2026, 7, 12, 18, 0)

    r = handler.release_record(Slot(), dt.datetime(2026, 7, 10, 12, 0, tzinfo=dt.timezone.utc))
    assert r["start"] == "2026-07-12T17:00:00+00:00"   # absolute UTC, for later reachability
    assert r["startLondon"] == "2026-07-12T18:00"       # unchanged display field


def test_run_detects_all_days_within_horizon():
    import datetime as dt
    import handler
    captured = {}

    def fake_find(courses, days_ahead, weekend_only, now):
        captured["days_ahead"] = days_ahead
        captured["weekend_only"] = weekend_only
        return []

    handler.run(read_state=lambda: {}, write_state=lambda f: None, courses=[],
                now=dt.datetime(2026, 7, 10, 12, 0, tzinfo=dt.timezone.utc),
                urgent_hours=168, horizon_days=7, find_openings=fake_find)
    assert captured["days_ahead"] == 7
    assert captured["weekend_only"] is False
```

- [ ] **Step 2: Run, verify FAIL.** `cd /Users/davidsmith/Development/lagoon/aws/lambda && PYTHONPATH=/Users/davidsmith/Development/lagoon /opt/homebrew/bin/python3 -m pytest test_push.py -q` → fails (`start` missing; `weekend_only` True).

- [ ] **Step 3: Implement.** In `aws/lambda/handler.py`, in `release_record` add the absolute start (after the `startLondon` line):

```python
        "start": slot.start.isoformat(),
```

In `run`, change the `find_openings(...)` call from `weekend_only=True` to `weekend_only=False`:

```python
    slots = find_openings(courses, days_ahead=horizon_days, weekend_only=False, now=now)
```

- [ ] **Step 4: Run, verify PASS.** Same pytest command → all pass.

- [ ] **Step 5: Commit.**
```bash
cd /Users/davidsmith/Development/lagoon && git add aws/lambda/handler.py aws/lambda/test_push.py && git commit -m "feat(push): broaden detection to 7-day all-days; add UTC start to record"
```

---

## Task 2: The per-user filter module (`notify_filter.py`)

The heart of Stage 2. All pure, no AWS. `filter_for_sub` returns `(records_to_send | None, updated_state)` where `updated_state = {"notifyLog": {...}, "pending": [...]}`.

**Records** are the dicts from `release_record` (`key, label, start, startLondon, free, book`). `key` is `"<courseId>@<utcISO>"` (from `Slot.key`). `notifyLog` is `{slotKey: epochSecs}`; distinct epochs today = pushes today (coalesced slots share one epoch). `pending` is a list of slotKeys held during quiet hours.

**Files:** Create `aws/lambda/notify_filter.py`; Test `aws/lambda/test_notify_filter.py`.

- [ ] **Step 1: Write the failing tests.** Create `aws/lambda/test_notify_filter.py`:

```python
import datetime as dt
import notify_filter as nf

UTC = dt.timezone.utc


def rec(key, label="Tech 30", start="2026-07-13T17:00:00+00:00", free=1):
    return {"key": key, "label": label, "start": start,
            "startLondon": start[:16], "free": free,
            "book": "https://booking.lagoon.co.uk/book?courseRunId=1"}


def sub(**kw):
    base = {"days": ["Mon"], "types": ["Tech 30"], "travelMins": 30,
            "notifyLog": {}, "pending": []}
    base.update(kw)
    return base


# 2026-07-13 is a Monday. now = Mon 12:00 UTC (13:00 London).
NOW = dt.datetime(2026, 7, 13, 12, 0, tzinfo=UTC)


def test_candidate_passes_all_gates():
    r = rec("1@a", start="2026-07-13T17:00:00+00:00")  # Mon 18:00 London, 5h ahead
    out, state = nf.filter_for_sub(sub(), [r], {}, NOW)
    assert out and out[0]["key"] == "1@a"
    assert state["notifyLog"]["1@a"] == int(NOW.timestamp())


def test_wrong_day_filtered():
    r = rec("1@a", start="2026-07-14T17:00:00+00:00")  # Tuesday
    out, _ = nf.filter_for_sub(sub(days=["Mon"]), [r], {}, NOW)
    assert out is None


def test_wrong_type_filtered():
    out, _ = nf.filter_for_sub(sub(types=["Air 30"]), [rec("1@a")], {}, NOW)
    assert out is None


def test_unreachable_same_day_filtered():
    # slot 20 min away, travel 30 + 15 buffer = 45 needed
    soon = (NOW + dt.timedelta(minutes=20)).isoformat()
    out, _ = nf.filter_for_sub(sub(), [rec("1@a", start=soon)], {}, NOW)
    assert out is None


def test_beyond_horizon_filtered():
    far = "2026-07-25T17:00:00+00:00"  # >7 days
    out, _ = nf.filter_for_sub(sub(days=nf.WEEKDAYS), [rec("1@a", start=far)], {}, NOW)
    assert out is None


def test_dedupe_same_slot_same_day():
    log = {"1@a": int(NOW.timestamp()) - 3600}   # already notified today
    out, _ = nf.filter_for_sub(sub(notifyLog=log), [rec("1@a")], {}, NOW)
    assert out is None


def test_cap_blocks_after_five_pushes_today():
    base = int(NOW.timestamp())
    log = {f"k{i}": base - i * 60 for i in range(5)}   # 5 distinct pushes today
    out, _ = nf.filter_for_sub(sub(notifyLog=log), [rec("1@z")], {}, NOW)
    assert out is None


def test_cooldown_blocks_within_30_min():
    log = {"old": int(NOW.timestamp()) - 600}   # last push 10 min ago
    out, _ = nf.filter_for_sub(sub(notifyLog=log), [rec("1@z")], {}, NOW)
    assert out is None


def test_quiet_hours_holds_then_returns_pending():
    quiet = dt.datetime(2026, 7, 13, 22, 0, tzinfo=UTC)   # 23:00 London — quiet
    # slot Tue is fine as long as it's a chosen day + reachable; use Tue for a future day
    r = rec("1@a", start="2026-07-14T18:00:00+00:00")
    out, state = nf.filter_for_sub(sub(days=nf.WEEKDAYS), [r], {}, quiet)
    assert out is None
    assert state["pending"] == ["1@a"]


def test_quiet_delivery_after_0800_if_still_open():
    morning = dt.datetime(2026, 7, 13, 7, 30, tzinfo=UTC)  # 08:30 London — past quiet
    held = rec("1@a", start="2026-07-13T18:00:00+00:00")   # Mon 19:00, still today
    out, state = nf.filter_for_sub(sub(days=nf.WEEKDAYS, pending=["1@a"]),
                                   [], {"1@a": held}, morning)
    assert out and out[0]["key"] == "1@a"
    assert state["pending"] == []


def test_quiet_pending_dropped_if_no_longer_open():
    morning = dt.datetime(2026, 7, 13, 7, 30, tzinfo=UTC)
    out, state = nf.filter_for_sub(sub(days=nf.WEEKDAYS, pending=["1@a"]),
                                   [], {}, morning)  # not in current open set
    assert out is None
    assert state["pending"] == []
```

- [ ] **Step 2: Run, verify FAIL.** `cd /Users/davidsmith/Development/lagoon/aws/lambda && /opt/homebrew/bin/python3 -m pytest test_notify_filter.py -q` → `ModuleNotFoundError: No module named 'notify_filter'`.

- [ ] **Step 3: Implement.** Create `aws/lambda/notify_filter.py`:

```python
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
```

- [ ] **Step 4: Run, verify PASS.** `cd /Users/davidsmith/Development/lagoon/aws/lambda && /opt/homebrew/bin/python3 -m pytest test_notify_filter.py -q` → 11 passed.

- [ ] **Step 5: Commit.**
```bash
cd /Users/davidsmith/Development/lagoon && git add aws/lambda/notify_filter.py aws/lambda/test_notify_filter.py && git commit -m "feat(push): per-user notify_filter (days/types/reachable/horizon + anti-spam)"
```

---

## Task 3: Apply the filter per-subscription in the watcher

**Files:** Modify `aws/lambda/handler.py`; `aws/lambda/build-lambda.sh`; `aws/lambda/test_push.py`.

The `send` callback must now receive the full current open set + `now` (to build `current_open_by_key` and re-check held slots), scan the prefs/state fields, filter per sub, send per sub, and persist `notifyLog`/`pending`.

- [ ] **Step 1: Write the failing wiring test.** Append to `aws/lambda/test_push.py`:

```python
def test_run_passes_slots_and_now_to_send():
    import datetime as dt
    import handler
    now = dt.datetime(2026, 7, 13, 12, 0, tzinfo=dt.timezone.utc)

    class Slot:
        key = "50@2026-07-13T17:00:00+00:00"; label = "Tech 30"; course_id = 50
        run_id = 9; free = 1; capacity = 2
        start = dt.datetime(2026, 7, 13, 17, 0, tzinfo=dt.timezone.utc)
        local = dt.datetime(2026, 7, 13, 18, 0)

    got = {}
    handler.run(read_state=lambda: {}, write_state=lambda f: None, courses=[],
                now=now, urgent_hours=168, horizon_days=7,
                find_openings=lambda *a, **k: [Slot()],
                send=lambda records, slots, when: got.update(
                    records=records, slots=slots, when=when))
    assert got["records"][0]["key"] == Slot.key
    assert got["slots"][0].key == Slot.key      # full current open set passed
    assert got["when"] == now
```

- [ ] **Step 2: Run, verify FAIL.** `...pytest test_push.py -q` → the current `send(records)` call fails the 3-arg lambda.

- [ ] **Step 3: Change `run` to pass slots + now to send.** In `aws/lambda/handler.py` `run`, replace:

```python
    if records and send:
        send(records)
```
with:
```python
    if records and send:
        send(records, slots, now)
```

- [ ] **Step 4: Run, verify PASS.** `...pytest test_push.py -q` → all pass.

- [ ] **Step 5: Rewrite the real `send` closure** in `lambda_handler`. Replace the whole `def send(records): ...` block with:

```python
    def send(records, slots, now):
        import push, notify_filter
        from pywebpush import webpush
        from py_vapid import Vapid01
        ddb = boto3.resource("dynamodb").Table(subs_table)
        subs = ddb.scan().get("Items", [])   # small items; no ProjectionExpression (reserved-word safe)
        if not subs:
            return
        current = {s.key: notify_filter_record(s, now) for s in slots}
        pem = boto3.client("ssm").get_parameter(
            Name=vapid_param, WithDecryption=True)["Parameter"]["Value"]
        vapid = Vapid01.from_pem(pem.encode())
        sent = 0
        for sub in subs:
            to_send, state = notify_filter.filter_for_sub(sub, records, current, now)
            # persist server-owned state (never touch prefs) — aliased (reserved words)
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
```

And add this helper next to `release_record` (module level in `handler.py`) so a live `Slot` becomes the record shape the filter expects:

```python
def notify_filter_record(slot, now):
    return release_record(slot, now)
```

(`release_record` already yields `key`? No — add `"key": slot.key` to `release_record`'s dict, after `"start"`, so `current_open_by_key` and dedupe share the slot key.)

- [ ] **Step 6: Add `key` to `release_record`.** In `release_record`, add after the `"start"` line:

```python
        "key": slot.key,
```

- [ ] **Step 7: Bundle `notify_filter.py`.** In `aws/lambda/build-lambda.sh`, add `notify_filter.py` to the `cp` line so it reads:

```bash
cp "$HERE/handler.py" "$HERE/push.py" "$HERE/notify_filter.py" "$ROOT/lagoon_client.py" "$ROOT/courses.json" "$BUILD/"
```

- [ ] **Step 8: Run the watcher suite.** `cd /Users/davidsmith/Development/lagoon/aws/lambda && PYTHONPATH=/Users/davidsmith/Development/lagoon /opt/homebrew/bin/python3 -m pytest test_push.py test_notify_filter.py -q` → all pass.

- [ ] **Step 9: Commit.**
```bash
cd /Users/davidsmith/Development/lagoon && git add aws/lambda/handler.py aws/lambda/build-lambda.sh aws/lambda/test_push.py && git commit -m "feat(push): per-sub filtering + persist notifyLog/pending in the watcher"
```

---

## Task 4: Registration Lambda accepts prefs

**Files:** Modify `aws/lambda-register/handler.py`; `aws/lambda-register/test_register.py`.

Prefs come in on subscribe and on prefs-only re-POSTs. Store validated prefs; never let the client set `notifyLog`/`pending`; a prefs update must not clobber server-owned state.

- [ ] **Step 1: Write failing tests.** Append to `aws/lambda-register/test_register.py`:

```python
def test_clean_prefs_defaults_and_validates():
    p = handler.clean_prefs({"days": ["Mon", "Xx", "Sun"], "types": ["Tech 30", "Bogus"],
                             "travelMins": "40"})
    assert p == {"days": ["Mon", "Sun"], "types": ["Tech 30"], "travelMins": 40}


def test_clean_prefs_falls_back_when_missing_or_bad():
    p = handler.clean_prefs(None)
    assert p["days"] == handler.ALL_DAYS and p["types"] == handler.DEFAULT_TYPES
    assert p["travelMins"] == 30
    assert handler.clean_prefs({"travelMins": -5})["travelMins"] == 30  # negative -> default


def test_sub_item_includes_clean_prefs_not_server_state():
    sub = {"endpoint": "https://push.example/abc", "keys": {"p256dh": "P", "auth": "A"}}
    item = handler.sub_item(sub, now_iso="2026-07-13T12:00:00Z",
                            prefs={"days": ["Sat"], "types": ["Air 30"], "travelMins": 20})
    assert item["days"] == ["Sat"] and item["types"] == ["Air 30"] and item["travelMins"] == 20
    assert "notifyLog" not in item and "pending" not in item  # server owns these
```

- [ ] **Step 2: Run, verify FAIL.** `cd /Users/davidsmith/Development/lagoon/aws/lambda-register && /opt/homebrew/bin/python3 -m pytest test_register.py -q` → fails (`clean_prefs` missing; `sub_item` takes no `prefs`).

- [ ] **Step 3: Implement.** In `aws/lambda-register/handler.py`, add near the top (after imports):

```python
ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
KNOWN_TYPES = ["Air 30", "Tech 30", "Air 15", "Tech 15", "Taster", "Jam", "Drop-in"]
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
```

Change `sub_item` to accept + include prefs:

```python
def sub_item(subscription: dict, now_iso: str, prefs=None) -> dict:
    """DynamoDB item for a browser PushSubscription JSON + cleaned prefs."""
    keys = subscription.get("keys", {})
    return {
        "subId": sub_id(subscription["endpoint"]),
        "endpoint": subscription["endpoint"],
        "p256dh": keys["p256dh"],
        "authKey": keys["auth"],
        "createdAt": now_iso,
        **clean_prefs(prefs),
    }
```

In `parse_request`, return the prefs alongside the subscription on POST — change the subscribe return:

```python
            return ("subscribe", {"subscription": sub, "prefs": data.get("prefs")})
```

In `lambda_handler`, update the subscribe branch to write prefs WITHOUT clobbering server state, and pass prefs through. Replace the subscribe handling:

```python
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
        return _resp(200, {"ok": True})
```

(`days` and `types` are aliased defensively; `travelMins`/`endpoint`/`p256dh`/`authKey`/`createdAt` are not reserved. Using `update_item` with `if_not_exists(createdAt)` means a prefs re-POST keeps the original createdAt and never touches `notifyLog`/`pending`.)

- [ ] **Step 4: Run, verify PASS.** `...pytest test_register.py -q` → all pass.

- [ ] **Step 5: Commit.**
```bash
cd /Users/davidsmith/Development/lagoon && git add aws/lambda-register/handler.py aws/lambda-register/test_register.py && git commit -m "feat(push): registration Lambda stores validated prefs (preserves server state)"
```

---

## Task 5: Client prefs store

**Files:** Modify `app/js/store.js`; Test `app/test/store.test.js`.

- [ ] **Step 1: Write the failing test.** Append to `app/test/store.test.js` (it already stubs `global.localStorage` — reuse it; clear between assertions):

```javascript
test("notify prefs round-trip with defaults", () => {
  mem.clear();
  const d = getNotifyPrefs();
  assert.deepEqual(d.days, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  assert.deepEqual(d.types, ["Air 30", "Tech 30"]);
  assert.equal(d.travelMins, 30);
  setNotifyPrefs({ days: ["Sat", "Sun"], types: ["Air 30"], travelMins: 45 });
  const p = getNotifyPrefs();
  assert.deepEqual(p.days, ["Sat", "Sun"]);
  assert.deepEqual(p.types, ["Air 30"]);
  assert.equal(p.travelMins, 45);
});
```

Add to the imports at the top of `store.test.js`: `getNotifyPrefs, setNotifyPrefs`.

- [ ] **Step 2: Run, verify FAIL.** `node --test app/test/store.test.js` → missing exports.

- [ ] **Step 3: Implement.** Append to `app/js/store.js`:

```javascript
const NOTIFY_PREFS_KEY = "lagoon.notifyPrefs";
const DEFAULT_NOTIFY_PREFS = {
  days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  types: ["Air 30", "Tech 30"],
  travelMins: 30,
};
export function getNotifyPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(NOTIFY_PREFS_KEY) || "null");
    return p && typeof p === "object" ? { ...DEFAULT_NOTIFY_PREFS, ...p } : { ...DEFAULT_NOTIFY_PREFS };
  } catch { return { ...DEFAULT_NOTIFY_PREFS }; }
}
export function setNotifyPrefs(prefs) {
  try { localStorage.setItem(NOTIFY_PREFS_KEY, JSON.stringify(prefs)); } catch {}
}
```

- [ ] **Step 4: Run, verify PASS.** `node --test app/test/store.test.js` → all pass.

- [ ] **Step 5: Commit.**
```bash
cd /Users/davidsmith/Development/lagoon && git add app/js/store.js app/test/store.test.js && git commit -m "feat(push): client notify-prefs store"
```

---

## Task 6: Send prefs on subscribe + syncPrefs()

**Files:** Modify `app/js/push.js`; Test `app/test/push.test.js`.

- [ ] **Step 1: Write the failing test.** Append to `app/test/push.test.js`:

```javascript
import { subscribeBody } from "../js/push.js";

test("subscribeBody wraps subscription + prefs", () => {
  const sub = { endpoint: "e", keys: { p256dh: "P", auth: "A" } };
  const body = JSON.parse(subscribeBody(sub, { days: ["Sat"], types: ["Air 30"], travelMins: 20 }));
  assert.deepEqual(body.subscription, sub);
  assert.deepEqual(body.prefs, { days: ["Sat"], types: ["Air 30"], travelMins: 20 });
});
```

- [ ] **Step 2: Run, verify FAIL.** `node --test app/test/push.test.js` → missing export.

- [ ] **Step 3: Implement.** In `app/js/push.js`, add the import of prefs + a pure body builder + wire it into subscribe + add `syncPrefs`. Change the config import line to also pull nothing new (prefs come from store):

```javascript
import { getNotifyPrefs } from "./store.js";
```

Add the pure helper (exported, testable):

```javascript
// Body for a subscribe / prefs-sync POST. Pure — unit-tested.
export function subscribeBody(subscription, prefs) {
  return JSON.stringify({ subscription, prefs });
}
```

In `subscribe()`, replace the `fetch(...)` body with the prefs-carrying one:

```javascript
  await fetch(PUSH_REGISTER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: subscribeBody(sub.toJSON(), getNotifyPrefs()),
  });
  return true;
```

Add `syncPrefs()` (re-POST current subscription + prefs when prefs change while subscribed; no-op if not subscribed):

```javascript
// Re-send prefs for the current subscription (upsert). No-op if not subscribed.
export async function syncPrefs() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await fetch(PUSH_REGISTER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: subscribeBody(sub.toJSON(), getNotifyPrefs()),
  });
}
```

- [ ] **Step 4: Run, verify PASS.** `node --test app/test/push.test.js` → all pass.

- [ ] **Step 5: Commit.**
```bash
cd /Users/davidsmith/Development/lagoon && git add app/js/push.js app/test/push.test.js && git commit -m "feat(push): send prefs on subscribe + syncPrefs()"
```

---

## Task 7: Prefs UI in Settings

**Files:** Modify `app/js/views/settings.js`.

Below the enable toggle (only when `notifOn`), render Days / Types / Travel controls bound to `getNotifyPrefs`/`setNotifyPrefs`; on change, persist + `syncPrefs()`.

- [ ] **Step 1: Imports.** In `app/js/views/settings.js`, extend the push import and add store + config:

```javascript
import { notifState, subscribe, unsubscribe, syncPrefs } from "../push.js";
import { getNotifyPrefs, setNotifyPrefs } from "../store.js";
import { COURSES } from "../config.js";
```

(Keep the existing `store.js` import line; add these names to it rather than duplicating.)

- [ ] **Step 2: Render the prefs block.** In the Notifications section template, extend the `isOn("notifications")` block so that when `notifOn` is true it also shows the prefs. Replace the existing notifications block with:

```javascript
    ${isOn("notifications") ? `<div class="t" style="margin-top:18px">Notifications</div>
    <div class="set-row"><span>Spot-opened alerts</span>${switchHtml("notif-toggle", notifOn)}</div>
    <div class="set-cap">Get a push when a spot opens. You'll be asked for permission.</div>
    ${notifOn ? notifPrefsHtml() : ""}` : ""}`;
```

Add these module-level render helpers (near `badgeHtml`):

```javascript
const NP_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function notifPrefsHtml() {
  const p = getNotifyPrefs();
  const day = (d) => `<button class="npday${p.days.includes(d) ? " active" : ""}" data-day="${d}">${d}</button>`;
  const type = (c) => `<button class="nptype${p.types.includes(c.label) ? " active" : ""}" data-type="${c.label}">${c.label}</button>`;
  return `
    <div class="np-lbl">Days</div>
    <div class="np-row">${NP_DAYS.map(day).join("")}</div>
    <div class="np-lbl">Session types</div>
    <div class="np-row">${COURSES.map(type).join("")}</div>
    <div class="np-lbl">Travel time</div>
    <div class="set-row"><span>Minutes to the lagoon</span>
      <input id="np-travel" class="np-travel" type="number" min="0" step="5" value="${p.travelMins}"></div>`;
}
```

- [ ] **Step 3: Wire the controls.** In `renderSettings`, after the `#notif-toggle` wiring, add:

```javascript
  const persist = (mut) => { const p = getNotifyPrefs(); mut(p); setNotifyPrefs(p); syncPrefs(); renderSettings(view, state, go); };
  for (const b of view.querySelectorAll(".npday")) b.addEventListener("click", () =>
    persist(p => { const d = b.dataset.day; p.days = p.days.includes(d) ? p.days.filter(x => x !== d) : [...p.days, d]; }));
  for (const b of view.querySelectorAll(".nptype")) b.addEventListener("click", () =>
    persist(p => { const t = b.dataset.type; p.types = p.types.includes(t) ? p.types.filter(x => x !== t) : [...p.types, t]; }));
  const tv = view.querySelector("#np-travel");
  if (tv) tv.addEventListener("change", () => { const p = getNotifyPrefs(); p.travelMins = Math.max(0, parseInt(tv.value, 10) || 0); setNotifyPrefs(p); syncPrefs(); });
```

- [ ] **Step 4: Add CSS.** In `injectSettingsStyles`, append to the style text (before the closing backtick):

```javascript
    .np-lbl{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:14px 2px 8px}
    .np-row{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:4px}
    .npday,.nptype{background:var(--surface);border:1px solid var(--border);color:var(--muted);border-radius:18px;padding:5px 13px;font-size:13px;cursor:pointer}
    .npday.active,.nptype.active{background:var(--accent);color:var(--accent-ink);border-color:var(--accent);font-weight:600}
    .np-travel{width:72px;background:var(--surface-2);color:var(--text);border:1px solid var(--border);border-radius:8px;padding:6px 10px;font-size:13px;text-align:right}
```

- [ ] **Step 5: Verify parse.** `node --check app/js/views/settings.js` → exit 0. (Importing it under Node throws `document is not defined` — pre-existing, via `app.js`; `--check` is the syntax gate.)

- [ ] **Step 6: Commit.**
```bash
cd /Users/davidsmith/Development/lagoon && git add app/js/views/settings.js && git commit -m "feat(push): notification prefs UI (days/types/travel)"
```

---

## Task 8: CI for the new suite + version bump

**Files:** Modify `.github/workflows/ci.yml`, `app/js/config.js`, `app/sw.js`.

- [ ] **Step 1: CI runs the new test file.** In `.github/workflows/ci.yml`, in the "AWS Lambda unit tests" step, change the watcher line to include the new suite:

```yaml
          PYTHONPATH="$PWD" python -m pytest aws/lambda/test_push.py aws/lambda/test_notify_filter.py -q
```

- [ ] **Step 2: Version bump.** `app/js/config.js`: `APP_RELEASE = "v51"` → `"v52"`. `app/sw.js`: `CACHE = "lagoon-v51"` → `"lagoon-v52"`. (No new client JS files — nothing to add to ASSETS.)

- [ ] **Step 3: Verify.** `node --check app/sw.js` → 0; `cd app && node -e "import('./js/config.js').then(m=>console.log(m.APP_RELEASE))"` → `v52`.

- [ ] **Step 4: Commit.**
```bash
cd /Users/davidsmith/Development/lagoon && git add .github/workflows/ci.yml app/js/config.js app/sw.js && git commit -m "chore(push): CI runs notify_filter suite; bump v52"
```

---

## Task 9: Full suite + build + deploy/device (ops)

**Files:** none (verification).

- [ ] **Step 1: All suites.**
```bash
cd /Users/davidsmith/Development/lagoon
node --test app/test/*.test.js
PYTHONPATH="$PWD" /opt/homebrew/bin/python3 -m pytest aws/lambda/test_push.py aws/lambda/test_notify_filter.py -q
/opt/homebrew/bin/python3 -m pytest aws/lambda-register/test_register.py -q
/opt/homebrew/bin/python3 -m unittest discover -s tests -p "test_*.py"
```
Expected: all green.

- [ ] **Step 2: PR + merge** (branch → PR → CI → squash-merge), per the project's PR-only workflow.

- [ ] **Step 3: Deploy the Lambdas** (USER runs — `cdk deploy` is classifier-blocked): `cd aws/cdk && npm run deploy` (Docker rebuilds the watcher asset incl. `notify_filter.py`; updates both Lambdas).

- [ ] **Step 4: Deploy the client**: merge lands on `main`; run `gh workflow run "Deploy Hugo Site (AWS)" -R davidfsmith/daves-adventures`; verify `curl …/sw.js | grep CACHE` → `lagoon-v52`.

- [ ] **Step 5: Device test.** On the phone: enable → set Days/Types/Travel → confirm they persist. Then force a send (reset `state/free.json` to `{}`, invoke the watcher — see [[lagoon-push-infra]]) and confirm: a matching opening pushes; a non-matching day/type does not; an unreachable imminent slot does not. Check `notifyLog`/`pending` populate on the item. (Quiet-hours hold is awkward to test live off-hours; the unit tests cover it.)

---

## Self-Review notes (author)

- **Spec coverage:** data model (T4 prefs + T3 notifyLog/pending) · detection broadening (T1) · filter pipeline day/type/reachable/horizon (T2) · dedupe/cap/coalesce/quiet-hours-hold (T2) · prefs sync reuse-endpoint (T4/T6) · prefs UI (T7) · testability pure-fn (T2/T4/T5/T6). Version bump (T8). CI (T8).
- **Type consistency:** record keys (`key,label,start,startLondon,free,book`) produced by `release_record` (T1/T3) match `notify_filter` reads (T2). `filter_for_sub(sub, new_openings, current_open_by_key, now) -> (list|None, {"notifyLog","pending"})` used identically in T2 tests and T3 wiring. `subscribeBody(subscription, prefs)` shape matches the registration Lambda's `parse_request` (`{subscription, prefs}`) in T4. `clean_prefs` field names (`days/types/travelMins`) match the store defaults (T5) and the filter reads (T2).
- **Reserved-word safety:** watcher scan drops `ProjectionExpression`; `notifyLog`/`pending`/`days`/`types` writes use `ExpressionAttributeNames` aliases where the name could be reserved.
- **Migration:** Stage-1 items lacking prefs read as defaults in `filter_for_sub` (`sub.get(...) or DEFAULT`); registration `update_item` preserves `notifyLog`/`pending` via `if_not_exists`/scoped SET.
- **DynamoDB Decimals:** `filter_for_sub` coerces `travelMins` and `notifyLog` values with `int(...)` (boto3 returns `Decimal`).
