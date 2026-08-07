# First-party cookieless RUM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a dev-gated, first-party, cookieless RUM pipeline — an in-app beacon posting anonymous events to our own AWS, queried with Athena — capturing SPA route views and the notification funnel that CloudFront logs can't see.

**Architecture:** Client `rum.js` (gated by `isOn("rum")` + opt-out) batches events and `sendBeacon`s them to a same-origin `/lagoon/rum` CloudFront behaviour → stdlib-only ingest Lambda hashes the visitor daily (no client identifier, raw IP/UA never stored) and writes NDJSON to S3 (dt-partitioned, 90-day TTL) → Athena external table with partition projection.

**Tech Stack:** Vanilla ES modules (no build, no deps) client; Python stdlib-only Lambda (no Docker, like `lambda-register`); CDK in the existing `LagoonWatcher` stack; Athena.

**Spec:** `docs/superpowers/specs/2026-08-07-rum-first-party-beacon-design.md`

## Global Constraints

- **No dependencies, no build step, vanilla ES modules** (client) — house rule (`app/CLAUDE.md`).
- **Lambda: Python standard library only** (no Docker build; `Code.fromAsset` directly).
- **Additive gating:** every `rum.js` public function no-ops unless `isOn("rum")`; with the flag off the app behaves exactly as today.
- **Cookieless / no client identifier:** no cookie, no persisted id. Session id is in-memory only. The opt-out preference is the only localStorage key added.
- **Privacy:** raw IP and User-Agent are hashed on arrival and NEVER written to storage.
- **Version bump rule:** when app-shell/cached code changes, bump `sw.js` `CACHE` AND `config.js` `APP_RELEASE` together, and add any new JS file to `sw.js` ASSETS. Current release: **v93 → v94**.
- **Allowlists (exact):** routes = `agenda, account, day, lastminute, settings, login`; events = `notify_enable, notify_disable, login_success, book_click, discipline_switch`.
- **PR workflow:** `main` is protected; work on the `feat/rum-analytics` branch, open a PR. Pre-commit hooks run.
- **Opt-out caption text:** "🍪 No cookies — anonymous, and nothing leaves Hove Lagoon."

## File Structure

- Create `aws/lambda-rum/handler.py` — ingest Lambda: pure core (`visitor_hash`, `device_os`, `parse_client`, `clean_events`, `build_records`, `ingest_request`) + thin `lambda_handler` (SSM salt cached on cold start, S3 put).
- Create `aws/lambda-rum/test_rum.py` — pytest for the pure core (no AWS).
- Create `app/js/rum.js` — client collector: pure `createCollector` factory + DOM wiring (`init`, `route`, `event`).
- Create `app/test/rum.test.js` — node tests for `createCollector`.
- Modify `app/js/store.js` — `getRumOptOut` / `setRumOptOut` (`lagoon.rumOptOut`).
- Modify `app/js/config.js` — add `rum: "internal"` to `FEATURES`; bump `APP_RELEASE` to `v94`.
- Modify `app/sw.js` — add `./js/rum.js` to ASSETS; bump `CACHE` to `lagoon-v94`.
- Modify `app/js/app.js` — `rum.init()` at boot; `rum.route()` in `go()`; `rum.event("book_click")`, `"login_success"`, `"discipline_switch"`.
- Modify `app/js/views/settings.js` — opt-out toggle + caption; `notify_enable`/`notify_disable` events.
- Modify `aws/cdk/lib/watcher-stack.ts` — `RumFn` + Function URL + `RumBucket` (+ lifecycle) + IAM + SSM read; output the URL.
- Create `docs/rum-analytics.md` — Athena DDL (partition projection) + query catalogue.
- (Cross-repo, documented) daves-adventures `infra/lib/site-stack.ts` — `/lagoon/rum*` CloudFront behaviour.

---

### Task 1: Lambda identity & enrichment helpers

**Files:**
- Create: `aws/lambda-rum/handler.py`
- Test: `aws/lambda-rum/test_rum.py`

**Interfaces:**
- Produces: `visitor_hash(secret:str, date_str:str, ip:str, ua:str) -> str` (16 hex chars); `device_os(ua:str) -> tuple[str,str]` (device, os); `parse_client(headers:dict) -> tuple[str,str,str]` (ip, ua, country).

- [ ] **Step 1: Write the failing test**

```python
# aws/lambda-rum/test_rum.py
import handler as h


def test_visitor_hash_is_16_hex_and_rotates_by_date():
    a = h.visitor_hash("secret", "2026-08-07", "1.2.3.4", "UA")
    b = h.visitor_hash("secret", "2026-08-08", "1.2.3.4", "UA")  # next day
    assert len(a) == 16 and all(c in "0123456789abcdef" for c in a)
    assert a != b                      # rotates daily
    assert a == h.visitor_hash("secret", "2026-08-07", "1.2.3.4", "UA")  # stable within a day


def test_visitor_hash_differs_by_ip_and_secret():
    base = h.visitor_hash("s", "2026-08-07", "1.2.3.4", "UA")
    assert base != h.visitor_hash("s", "2026-08-07", "9.9.9.9", "UA")
    assert base != h.visitor_hash("other", "2026-08-07", "1.2.3.4", "UA")


def test_device_os():
    assert h.device_os("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)") == ("mobile", "iOS")
    assert h.device_os("Mozilla/5.0 (Linux; Android 14)") == ("mobile", "Android")
    assert h.device_os("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)") == ("desktop", "macOS")
    assert h.device_os("") == ("desktop", "Other")


def test_parse_client_reads_headers_case_insensitively():
    ip, ua, country = h.parse_client({
        "CloudFront-Viewer-Address": "203.0.113.5:51000",
        "User-Agent": "UA/1.0",
        "CloudFront-Viewer-Country": "gb",
    })
    assert ip == "203.0.113.5" and ua == "UA/1.0" and country == "GB"


def test_parse_client_falls_back_to_xff():
    ip, _, _ = h.parse_client({"X-Forwarded-For": "198.51.100.7, 70.0.0.1"})
    assert ip == "198.51.100.7"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd aws/lambda-rum && python3 -m pytest test_rum.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'handler'` / attributes undefined.

- [ ] **Step 3: Write minimal implementation**

```python
# aws/lambda-rum/handler.py
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd aws/lambda-rum && python3 -m pytest test_rum.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add aws/lambda-rum/handler.py aws/lambda-rum/test_rum.py
git commit -m "feat(rum): lambda identity + enrichment helpers"
```

---

### Task 2: Lambda payload validation (`clean_events`)

**Files:**
- Modify: `aws/lambda-rum/handler.py`
- Test: `aws/lambda-rum/test_rum.py`

**Interfaces:**
- Consumes: `ROUTES`, `EVENTS`, `MAX_EVENTS`, `MAX_STR` from Task 1.
- Produces: `clean_events(payload:dict) -> tuple[str,dict,list[dict]] | None` — returns `(sid, meta, events)`; `None` if invalid. Off-allowlist routes/events are dropped; returns `None` if nothing valid remains.

- [ ] **Step 1: Write the failing test**

```python
# append to aws/lambda-rum/test_rum.py
def _payload(**kw):
    base = {"sid": "sess-1", "meta": {"ver": "v94", "theme": "dark", "disc": "wake",
            "standalone": True, "ref": "https://wa.me"}, "events": [{"t": "route", "route": "agenda"}]}
    base.update(kw)
    return base


def test_clean_events_happy_path():
    sid, meta, events = h.clean_events(_payload())
    assert sid == "sess-1"
    assert meta["theme"] == "dark" and meta["disc"] == "wake" and meta["standalone"] is True
    assert events == [{"t": "route", "route": "agenda"}]


def test_clean_events_drops_offlist_routes_and_events():
    p = _payload(events=[{"t": "route", "route": "hacker"},
                         {"t": "event", "name": "evil"},
                         {"t": "route", "route": "settings"}])
    sid, meta, events = h.clean_events(p)
    assert events == [{"t": "route", "route": "settings"}]


def test_clean_events_keeps_discipline_switch_to_prop_only():
    p = _payload(events=[{"t": "event", "name": "discipline_switch", "props": {"to": "sup", "x": "drop"}}])
    _, _, events = h.clean_events(p)
    assert events == [{"t": "event", "name": "discipline_switch", "to": "sup"}]


def test_clean_events_none_when_no_valid_events():
    assert h.clean_events(_payload(events=[{"t": "route", "route": "nope"}])) is None
    assert h.clean_events(_payload(events=[])) is None
    assert h.clean_events({"events": [{"t": "route", "route": "agenda"}]}) is None  # no sid
    assert h.clean_events("notadict") is None


def test_clean_events_sanitises_bad_meta_and_caps_count():
    p = _payload(meta={"theme": "rainbow", "disc": "surf", "standalone": "yes", "ver": "x" * 99},
                 events=[{"t": "route", "route": "agenda"}] * 100)
    sid, meta, events = h.clean_events(p)
    assert meta["theme"] is None and meta["disc"] is None and meta["standalone"] is True
    assert len(meta["ver"]) <= 16
    assert len(events) <= h.MAX_EVENTS
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd aws/lambda-rum && python3 -m pytest test_rum.py -v -k clean_events`
Expected: FAIL — `clean_events` undefined.

- [ ] **Step 3: Write minimal implementation**

```python
# add to aws/lambda-rum/handler.py
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd aws/lambda-rum && python3 -m pytest test_rum.py -v`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add aws/lambda-rum/handler.py aws/lambda-rum/test_rum.py
git commit -m "feat(rum): validate + allowlist beacon payloads"
```

---

### Task 3: Lambda record builder + request orchestrator

**Files:**
- Modify: `aws/lambda-rum/handler.py`
- Test: `aws/lambda-rum/test_rum.py`

**Interfaces:**
- Consumes: all Task 1–2 functions.
- Produces:
  - `build_records(sid, meta, events, visitor_id, country, device, os_, now:datetime) -> list[dict]` — one flat dict per event with `ts, dt, visitorId, sid, type, route|name, to?, ver, theme, disc, standalone, ref, country, device, os`.
  - `ingest_request(body, headers:dict, secret:str, now:datetime) -> tuple[int, list[dict]]` — pure; `(status, records)`. `200` with records on success; `400`/`413` with `[]` otherwise.

- [ ] **Step 1: Write the failing test**

```python
# append to aws/lambda-rum/test_rum.py
import datetime as dt
import json

NOW = dt.datetime(2026, 8, 7, 12, 0, tzinfo=dt.timezone.utc)
HEADERS = {"CloudFront-Viewer-Address": "203.0.113.5:443", "User-Agent": "Mozilla/5.0 (iPhone)",
           "CloudFront-Viewer-Country": "GB"}


def test_build_records_flattens_events_with_shared_context():
    recs = h.build_records("s1", {"ver": "v94", "theme": "dark", "disc": "wake",
                                  "standalone": True, "ref": None},
                           [{"t": "route", "route": "agenda"},
                            {"t": "event", "name": "discipline_switch", "to": "sup"}],
                           "vid123", "GB", "mobile", "iOS", NOW)
    assert len(recs) == 2
    assert recs[0]["dt"] == "2026-08-07" and recs[0]["visitorId"] == "vid123"
    assert recs[0]["type"] == "route" and recs[0]["route"] == "agenda"
    assert recs[1]["type"] == "event" and recs[1]["name"] == "discipline_switch" and recs[1]["to"] == "sup"
    assert recs[0]["country"] == "GB" and recs[0]["device"] == "mobile" and recs[0]["os"] == "iOS"


def test_ingest_request_end_to_end_no_raw_pii():
    body = json.dumps({"sid": "s1", "meta": {"ver": "v94"}, "events": [{"t": "route", "route": "agenda"}]})
    status, recs = h.ingest_request(body, HEADERS, "secret", NOW)
    assert status == 200 and len(recs) == 1
    blob = json.dumps(recs)
    assert "203.0.113.5" not in blob and "iPhone" not in blob   # raw IP/UA never stored
    assert recs[0]["visitorId"] == h.visitor_hash("secret", "2026-08-07", "203.0.113.5", "Mozilla/5.0 (iPhone)")


def test_ingest_request_rejects_oversize_and_garbage():
    assert h.ingest_request("x" * (h.MAX_BYTES + 1), HEADERS, "s", NOW) == (413, [])
    assert h.ingest_request("not json", HEADERS, "s", NOW) == (400, [])
    assert h.ingest_request(json.dumps({"sid": "s", "events": []}), HEADERS, "s", NOW) == (400, [])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd aws/lambda-rum && python3 -m pytest test_rum.py -v -k "build_records or ingest_request"`
Expected: FAIL — functions undefined.

- [ ] **Step 3: Write minimal implementation**

```python
# add to aws/lambda-rum/handler.py
def build_records(sid, meta, events, visitor_id, country, device, os_, now):
    base = {"ts": now.isoformat(), "dt": now.strftime("%Y-%m-%d"),
            "visitorId": visitor_id, "sid": sid,
            "ver": meta.get("ver"), "theme": meta.get("theme"), "disc": meta.get("disc"),
            "standalone": meta.get("standalone"), "ref": meta.get("ref"),
            "country": country, "device": device, "os": os_}
    recs = []
    for e in events:
        r = dict(base, type=e["t"])
        if e["t"] == "route":
            r["route"] = e["route"]
        else:
            r["name"] = e["name"]
            if "to" in e:
                r["to"] = e["to"]
        recs.append(r)
    return recs


def ingest_request(body, headers, secret, now):
    """Pure: raw body (str|bytes) + headers -> (status, records). No AWS."""
    if body is None:
        return 400, []
    b = body.encode() if isinstance(body, str) else body
    if len(b) > MAX_BYTES:
        return 413, []
    try:
        payload = json.loads(b)
    except Exception:
        return 400, []
    cleaned = clean_events(payload)
    if not cleaned:
        return 400, []
    sid, meta, events = cleaned
    ip, ua, country = parse_client(headers)
    vid = visitor_hash(secret, now.strftime("%Y-%m-%d"), ip, ua)
    device, os_ = device_os(ua)
    return 200, build_records(sid, meta, events, vid, country, device, os_, now)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd aws/lambda-rum && python3 -m pytest test_rum.py -v`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add aws/lambda-rum/handler.py aws/lambda-rum/test_rum.py
git commit -m "feat(rum): record builder + pure ingest orchestrator"
```

---

### Task 4: Lambda AWS handler (SSM salt + S3 write)

**Files:**
- Modify: `aws/lambda-rum/handler.py`

**Interfaces:**
- Consumes: `ingest_request` (Task 3).
- Produces: `lambda_handler(event, context) -> dict` — Function-URL handler. POST only (else 405); on valid beacon writes one NDJSON object to `rum/dt=<dt>/<uuid>.ndjson` and returns 204; invalid returns the status from `ingest_request`. Salt read from SSM (`SALT_PARAM`) once per cold start; bucket from `RUM_BUCKET`.

- [ ] **Step 1: Write the handler (IO-bound; verified at deploy, not unit-tested)**

Rationale: `lambda_handler` only wires `ingest_request` (already tested) to SSM/S3. Per the watcher's pattern, the pure logic is tested and the thin IO wrapper is verified on deploy.

```python
# add to aws/lambda-rum/handler.py
_SALT = None


def _salt():
    global _SALT
    if _SALT is None:
        import os
        import boto3
        _SALT = boto3.client("ssm").get_parameter(
            Name=os.environ["SALT_PARAM"], WithDecryption=True)["Parameter"]["Value"]
    return _SALT


def lambda_handler(event, context):
    import os
    import base64
    import boto3
    method = ((event.get("requestContext") or {}).get("http") or {}).get("method", "")
    if method != "POST":
        return {"statusCode": 405, "body": ""}
    body = event.get("body") or ""
    if event.get("isBase64Encoded"):
        body = base64.b64decode(body)
    now = dt.datetime.now(dt.timezone.utc)
    status, records = ingest_request(body, event.get("headers") or {}, _salt(), now)
    if status == 200 and records:
        boto3.client("s3").put_object(
            Bucket=os.environ["RUM_BUCKET"],
            Key=f"rum/dt={records[0]['dt']}/{uuid.uuid4().hex}.ndjson",
            Body=("\n".join(json.dumps(r) for r in records) + "\n").encode(),
            ContentType="application/x-ndjson")
    return {"statusCode": 204 if status == 200 else status,
            "headers": {"access-control-allow-origin": "*"}, "body": ""}
```

- [ ] **Step 2: Verify the module imports cleanly (no AWS needed for import)**

Run: `cd aws/lambda-rum && python3 -c "import handler; print('ok', handler.lambda_handler.__name__)"`
Expected: prints `ok lambda_handler` (boto3 is imported lazily inside the function, so import succeeds without it).

- [ ] **Step 3: Re-run the full suite to confirm nothing broke**

Run: `cd aws/lambda-rum && python3 -m pytest test_rum.py -v`
Expected: PASS (all).

- [ ] **Step 4: Commit**

```bash
git add aws/lambda-rum/handler.py
git commit -m "feat(rum): function-url handler with SSM salt + S3 write"
```

---

### Task 5: Client store opt-out preference

**Files:**
- Modify: `app/js/store.js`
- Test: `app/test/rum.test.js`

**Interfaces:**
- Produces: `getRumOptOut() -> boolean`; `setRumOptOut(v:boolean) -> void` (key `lagoon.rumOptOut`; default opted-in i.e. `false`).

- [ ] **Step 1: Write the failing test**

```javascript
// app/test/rum.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

const mem = new Map();
global.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { getRumOptOut, setRumOptOut } = await import("../js/store.js");

test("rum opt-out defaults to false (opted-in)", () => {
  mem.clear();
  assert.equal(getRumOptOut(), false);
});

test("rum opt-out round-trips", () => {
  mem.clear();
  setRumOptOut(true);
  assert.equal(getRumOptOut(), true);
  setRumOptOut(false);
  assert.equal(getRumOptOut(), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test app/test/rum.test.js`
Expected: FAIL — `getRumOptOut` is not a function.

- [ ] **Step 3: Write minimal implementation**

```javascript
// add to app/js/store.js
const RUM_OPTOUT_KEY = "lagoon.rumOptOut";
// Anonymous-analytics opt-out (a user preference, NOT a tracking identifier). Default in.
export function getRumOptOut() { return localStorage.getItem(RUM_OPTOUT_KEY) === "1"; }
export function setRumOptOut(v) {
  if (v) localStorage.setItem(RUM_OPTOUT_KEY, "1"); else localStorage.removeItem(RUM_OPTOUT_KEY);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test app/test/rum.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/js/store.js app/test/rum.test.js
git commit -m "feat(rum): analytics opt-out preference in store"
```

---

### Task 6: Client collector core (`createCollector`)

**Files:**
- Create: `app/js/rum.js`
- Test: `app/test/rum.test.js`

**Interfaces:**
- Produces: `createCollector({ send, isEnabled, now?, sizeCap? }) -> { setSession(sid, meta), record(evt), flush(), buildPayload(), queueLength() }`. `record`/`flush` no-op when `isEnabled()` is false; `record` auto-flushes at `sizeCap` (default 20); `buildPayload()` returns `{ v:1, sid, sent:now(), meta, events:[...] }`.

- [ ] **Step 1: Write the failing test**

```javascript
// append to app/test/rum.test.js
const { createCollector } = await import("../js/rum.js");

test("record queues; flush sends payload and clears when enabled", () => {
  const sent = [];
  const c = createCollector({ send: (j) => sent.push(j), isEnabled: () => true, now: () => "T" });
  c.setSession("s1", { ver: "v94" });
  c.record({ t: "route", route: "agenda" });
  assert.equal(c.queueLength(), 1);
  c.flush();
  const p = JSON.parse(sent[0]);
  assert.equal(p.v, 1);
  assert.equal(p.sid, "s1");
  assert.equal(p.sent, "T");
  assert.deepEqual(p.events, [{ t: "route", route: "agenda" }]);
  assert.equal(c.queueLength(), 0);
});

test("disabled: never queues or sends", () => {
  const sent = [];
  const c = createCollector({ send: (j) => sent.push(j), isEnabled: () => false });
  c.record({ t: "route", route: "agenda" });
  c.flush();
  assert.equal(c.queueLength(), 0);
  assert.equal(sent.length, 0);
});

test("size cap auto-flushes", () => {
  const sent = [];
  const c = createCollector({ send: (j) => sent.push(j), isEnabled: () => true, sizeCap: 2 });
  c.setSession("s", {});
  c.record({ t: "route", route: "agenda" });
  assert.equal(sent.length, 0);
  c.record({ t: "route", route: "account" });
  assert.equal(sent.length, 1);
  assert.equal(c.queueLength(), 0);
});

test("flush is a no-op when the queue is empty", () => {
  const sent = [];
  const c = createCollector({ send: (j) => sent.push(j), isEnabled: () => true });
  c.flush();
  assert.equal(sent.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test app/test/rum.test.js`
Expected: FAIL — `createCollector` is not exported.

- [ ] **Step 3: Write minimal implementation**

```javascript
// app/js/rum.js
// First-party, cookieless RUM. createCollector is the pure, DOM-free core (unit-tested);
// the wiring below (Task 7) adds sendBeacon + listeners. Nothing here persists an identifier.

export function createCollector({ send, isEnabled, now = () => new Date().toISOString(), sizeCap = 20 }) {
  let queue = [], meta = null, sid = null;
  const buildPayload = () => ({ v: 1, sid, sent: now(), meta, events: queue.slice() });
  function flush() {
    if (!isEnabled() || queue.length === 0) return;
    send(JSON.stringify(buildPayload()));
    queue = [];
  }
  function record(evt) {
    if (!isEnabled()) return;
    queue.push(evt);
    if (queue.length >= sizeCap) flush();
  }
  return {
    setSession(s, m) { sid = s; meta = m; },
    record, flush, buildPayload,
    queueLength: () => queue.length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test app/test/rum.test.js`
Expected: PASS (all 6 in the file).

- [ ] **Step 5: Commit**

```bash
git add app/js/rum.js app/test/rum.test.js
git commit -m "feat(rum): pure client collector core"
```

---

### Task 7: Client wiring (init/route/event) + flag + service worker

**Files:**
- Modify: `app/js/rum.js` (add DOM wiring under `createCollector`)
- Modify: `app/js/config.js` (add `rum: "internal"` to `FEATURES`; bump `APP_RELEASE` to `v94`)
- Modify: `app/sw.js` (add `./js/rum.js` to ASSETS; `CACHE` → `lagoon-v94`)

**Interfaces:**
- Consumes: `createCollector` (Task 6); `getRumOptOut` (Task 5); `isOn` (`features.js`); `getDiscipline` (`store.js`); `APP_RELEASE` (`config.js`).
- Produces: `init() -> void`; `route(name:string) -> void`; `event(name:string, props?) -> void`. All no-op unless the feature tier is on; `init` is idempotent.

- [ ] **Step 1: Add the wiring (DOM/beacon; verified manually, not unit-tested)**

```javascript
// append to app/js/rum.js
import { isOn } from "./features.js";
import { getRumOptOut, getDiscipline } from "./store.js";
import { APP_RELEASE } from "./config.js";

const RUM_URL = "/lagoon/rum";
const dnt = () => (navigator.doNotTrack === "1" || window.doNotTrack === "1");
// Send only when the user hasn't opted out and DNT is off. (Tier gate is checked once in init.)
const sendable = () => !getRumOptOut() && !dnt();
const beacon = (json) => {
  try { navigator.sendBeacon(RUM_URL, new Blob([json], { type: "application/json" })); } catch (_) {}
};

let collector = null;
let firstLoad = true;

function buildMeta() {
  const m = {
    ver: APP_RELEASE,
    theme: document.documentElement.classList.contains("light") ? "light"
      : document.documentElement.classList.contains("dark") ? "dark" : undefined,
    disc: getDiscipline(),
    standalone: matchMedia("(display-mode: standalone)").matches,
  };
  if (firstLoad && document.referrer) m.ref = document.referrer;
  firstLoad = false;
  return m;
}

export function init() {
  if (collector || !isOn("rum")) return;   // tier gate — once
  collector = createCollector({ send: beacon, isEnabled: sendable });
  collector.setSession(crypto.randomUUID(), buildMeta());
  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") collector.flush();
  });
  addEventListener("pagehide", () => collector.flush());
}

export function route(name) { if (collector) collector.record({ t: "route", route: name }); }
export function event(name, props) {
  if (collector) collector.record(props ? { t: "event", name, props } : { t: "event", name });
}
```

- [ ] **Step 2: Add the flag and bump the version**

In `app/js/config.js`, add to the `FEATURES` object:
```javascript
  rum: "internal", // first-party cookieless usage analytics (dev-only while validated)
```
and change:
```javascript
export const APP_RELEASE = "v94"; // release/version — bump together with sw.js CACHE
```

In `app/sw.js`, change `CACHE` and add the file to `ASSETS`:
```javascript
const CACHE = "lagoon-v94";
```
Add `"./js/rum.js"` to the `ASSETS` array (in the `./js/...` group).

- [ ] **Step 3: Verify tests + module still import**

Run: `node --test app/test/*.test.js`
Expected: PASS (all existing + rum tests). `createCollector` tests unaffected by the added imports (wiring code isn't executed at import).

- [ ] **Step 4: Commit**

```bash
git add app/js/rum.js app/js/config.js app/sw.js
git commit -m "feat(rum): client wiring, rum flag (internal), sw v94"
```

---

### Task 8: Integration hooks in the router

**Files:**
- Modify: `app/js/app.js`

**Interfaces:**
- Consumes: `init`, `route`, `event` from `rum.js`.

- [ ] **Step 1: Add the import**

At the top of `app/js/app.js`, with the other imports:
```javascript
import * as rum from "./rum.js";
```

- [ ] **Step 2: Initialise at boot and record routes**

Add `rum.init();` at the app's boot entry point (where the initial route is decided / `applyTheme` is called). Then, inside `go(route, arg)`, immediately after the `currentRoute = route;` line (so the SUP→agenda redirect above it has already normalised the route):
```javascript
  rum.route(route);
```

- [ ] **Step 3: Add event hooks**

In the `a.bk` click handler (the `document.addEventListener("click", ...)` that sets `pendingBookingReturn`):
```javascript
  if (e.target.closest("a.bk")) { pendingBookingReturn = true; rum.event("book_click"); }
```
In `switchDiscipline(disc)` (after `setDiscipline` / before reload):
```javascript
  rum.event("discipline_switch", { to: disc });
```
In `onLoggedIn` (after a successful login sets up `state`):
```javascript
  rum.event("login_success");
```

- [ ] **Step 4: Verify**

Run: `node --check app/js/app.js && node --test app/test/*.test.js`
Expected: `app.js` parses; all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/js/app.js
git commit -m "feat(rum): route + book/login/discipline event hooks"
```

---

### Task 9: Settings opt-out toggle + notification-funnel events

**Files:**
- Modify: `app/js/views/settings.js`

**Interfaces:**
- Consumes: `getRumOptOut`, `setRumOptOut` (Task 5); `isOn` (already imported); `event` from `rum.js`.

- [ ] **Step 1: Add imports**

Add `getRumOptOut, setRumOptOut` to the existing `../store.js` import, and:
```javascript
import * as rum from "../rum.js";
```

- [ ] **Step 2: Add the opt-out row to the Settings tab markup**

Add, gated on `isOn("rum")`, a Privacy section (place it after the Notifications block). The toggle reads inverted (ON = analytics enabled = not opted-out):
```javascript
    ${isOn("rum") ? `<div class="t" style="margin-top:18px">Privacy</div>
    <div class="set-row"><span>Anonymous usage analytics</span>${switchHtml("rum-optout", !getRumOptOut())}</div>
    <div class="set-cap" style="margin:0 2px 6px">🍪 No cookies — anonymous, and nothing leaves Hove Lagoon.</div>` : ""}
```
(Use the same `switchHtml(id, checked)` helper the other toggles use.)

- [ ] **Step 3: Wire the toggle**

In the settings wiring function (where `#beta-toggle` etc. are wired):
```javascript
  const ro = view.querySelector("#rum-optout");
  if (ro) ro.addEventListener("change", () => setRumOptOut(!ro.checked)); // checked = analytics ON
```

- [ ] **Step 4: Fire notification-funnel events**

Find the notifications enable/disable handler (the switch that subscribes/unsubscribes to push). On the branch that enables/subscribes add `rum.event("notify_enable");`, and on the disable/unsubscribe branch add `rum.event("notify_disable");`.

- [ ] **Step 5: Verify**

Run: `node --check app/js/views/settings.js && node --test app/test/*.test.js`
Expected: parses; tests PASS.

- [ ] **Step 6: Commit**

```bash
git add app/js/views/settings.js
git commit -m "feat(rum): settings opt-out toggle + notify funnel events"
```

---

### Task 10: CDK infra — RumFn, bucket, Function URL, IAM

**Files:**
- Modify: `aws/cdk/lib/watcher-stack.ts`

**Interfaces:**
- Produces: a deployed `RumFn` Lambda (`aws/lambda-rum`), its Function URL (output `RumUrl`), a `RumBucket` S3 bucket with a 90-day lifecycle on `rum/`, IAM (Lambda → `s3:PutObject` on the bucket + `ssm:GetParameter` on the salt), env `RUM_BUCKET` + `SALT_PARAM`.

- [ ] **Step 1: Add the constructs**

In `aws/cdk/lib/watcher-stack.ts`, inside the stack constructor (after the existing `registerFn` / watcher `fn` definitions), add:
```typescript
    // RUM analytics: raw NDJSON events, dt-partitioned, expired after 90 days.
    const rumBucket = new s3.Bucket(this, "RumBucket", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{ prefix: "rum/", expiration: Duration.days(90) }],
    });

    // Stdlib-only ingest Lambda (no Docker). Salt lives in SSM (create it once — see plan).
    const rumFn = new lambda.Function(this, "RumFn", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "handler.lambda_handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "..", "..", "lambda-rum")),
      timeout: Duration.seconds(10),
      memorySize: 128,
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: { RUM_BUCKET: rumBucket.bucketName, SALT_PARAM: "/lagoon/rum/salt" },
    });
    rumBucket.grantPut(rumFn);
    rumFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ["ssm:GetParameter"],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/lagoon/rum/salt`],
    }));
    const rumUrl = rumFn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });
    new CfnOutput(this, "RumUrl", { value: rumUrl.url });
```

- [ ] **Step 2: Synthesize to verify the stack compiles**

Run: `cd aws/cdk && npx cdk synth LagoonWatcher > /dev/null && echo OK`
Expected: `OK` (no TypeScript/synice errors). Note: `cdk synth` is local and safe to run; `cdk deploy` is user-run (classifier-blocked for the assistant).

- [ ] **Step 3: Commit**

```bash
git add aws/cdk/lib/watcher-stack.ts
git commit -m "feat(rum): CDK RumFn + bucket + function url + iam"
```

- [ ] **Step 4: One-time salt creation (documented; user runs at deploy)**

Record in the PR description that before/at deploy the user runs, once:
```bash
aws ssm put-parameter --region eu-west-1 --name /lagoon/rum/salt --type SecureString \
  --value "$(python3 -c 'import secrets;print(secrets.token_hex(32))')"
```

---

### Task 11: CloudFront behaviour (daves-adventures — documented, user-deployed)

**Files:**
- (Cross-repo) `davidfsmith/daves-adventures` → `infra/lib/site-stack.ts`

This mirrors the existing `/lagoon/push*` behaviour. It is NOT in this repo and is deployed by the user (`cd infra && npx cdk deploy HugoSiteStack --exclusively`).

- [ ] **Step 1: Document the behaviour to add (in the PR description)**

Add a behaviour on the Hugo site distribution for path pattern `/lagoon/rum*`:
```typescript
// origin = HttpOrigin(<RumUrl host from LagoonWatcher output "RumUrl">)
distribution.addBehavior("/lagoon/rum*", new origins.HttpOrigin(rumFnUrlHost), {
  viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
  allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,               // POST beacons
  cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
  // Forward viewer headers PLUS CloudFront geo/address headers the Lambda reads.
  originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_AND_CLOUDFRONT_2022,
});
```

- [ ] **Step 2: Note the deploy step**

In the PR description, record: "Deploy order — (1) `LagoonWatcher` (`npm run deploy`) to create `RumUrl`; (2) add the `/lagoon/rum*` behaviour in daves-adventures using that URL host and `cdk deploy HugoSiteStack`; (3) merge + site-deploy the app." No code change in this repo for this task.

---

### Task 12: Athena table + query catalogue

**Files:**
- Create: `docs/rum-analytics.md`

**Interfaces:**
- Produces: the external-table DDL (partition projection) + a starter query catalogue. Run the DDL once in Athena after data first flows.

- [ ] **Step 1: Write the doc**

```markdown
# RUM analytics (first-party) — Athena

Raw events: `s3://<RumBucket>/rum/dt=YYYY-MM-DD/*.ndjson` (one JSON object per line).
Query in Athena (eu-west-1, database `default`; results → the existing
`s3://dave-smith-co-uk-cf-logs/athena-results/`). See [[lagoon-cloudfront-analytics]].

## One-time: create the table (partition projection — no MSCK needed)

​```sql
CREATE EXTERNAL TABLE rum_events (
  ts string, visitorId string, sid string, type string,
  route string, name string, `to` string,
  ver string, theme string, disc string, standalone boolean, ref string,
  country string, device string, os string
)
PARTITIONED BY (dt string)
ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'
LOCATION 's3://<RumBucket>/rum/'
TBLPROPERTIES (
  'projection.enabled'='true',
  'projection.dt.type'='date',
  'projection.dt.format'='yyyy-MM-dd',
  'projection.dt.range'='2026-08-01,NOW',
  'projection.dt.interval'='1',
  'projection.dt.interval.unit'='DAYS',
  'storage.location.template'='s3://<RumBucket>/rum/dt=${dt}/'
);
​```

## Queries

​```sql
-- Unique visitors + sessions per day (deduped, not fuzzy IPs)
SELECT dt, count(DISTINCT visitorId) AS visitors, count(DISTINCT sid) AS sessions
FROM rum_events WHERE dt >= date_format(current_date - interval '30' day, '%Y-%m-%d')
GROUP BY dt ORDER BY dt;

-- Route popularity (the in-app navigation CloudFront can't see)
SELECT route, count(*) AS views FROM rum_events
WHERE type='route' AND dt >= date_format(current_date - interval '7' day, '%Y-%m-%d')
GROUP BY route ORDER BY views DESC;

-- Notification funnel: reached Settings -> enabled, vs sessions
SELECT
  count(DISTINCT sid) FILTER (WHERE type='route' AND route='settings') AS reached_settings,
  count(DISTINCT sid) FILTER (WHERE name='notify_enable') AS enabled,
  count(DISTINCT sid) AS sessions
FROM rum_events WHERE dt >= date_format(current_date - interval '30' day, '%Y-%m-%d');

-- Installed-PWA vs browser, device/OS, country
SELECT standalone, device, os, count(DISTINCT sid) AS sessions
FROM rum_events GROUP BY standalone, device, os ORDER BY sessions DESC;
​```
```
(Replace `<RumBucket>` with the deployed bucket name from the `LagoonWatcher` stack outputs.)

- [ ] **Step 2: Commit**

```bash
git add docs/rum-analytics.md
git commit -m "docs(rum): athena table DDL + query catalogue"
```

---

### Task 13: Final verification & PR

- [ ] **Step 1: Full app + lambda test sweep**

Run:
```bash
node --test app/test/*.test.js
cd aws/lambda-rum && python3 -m pytest test_rum.py -q && cd ../..
for f in app/js/rum.js app/js/app.js app/js/views/settings.js app/js/config.js app/sw.js; do node --check "$f"; done
```
Expected: all green.

- [ ] **Step 2: Grep guard — no raw identifiers, flag present, version synced**

Run:
```bash
grep -n "APP_RELEASE" app/js/config.js; grep -n "lagoon-v94" app/sw.js; grep -n '"./js/rum.js"' app/sw.js
grep -rn "rum" app/js/config.js
```
Expected: `APP_RELEASE = "v94"`, `CACHE = "lagoon-v94"`, `rum.js` in ASSETS, `rum: "internal"` present.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/rum-analytics
```
Open a PR summarising: dev-gated cookieless RUM; the three deploy touchpoints (Task 10 salt + `npm run deploy`; Task 11 CloudFront behaviour in daves-adventures; app site-deploy); and that it's `internal` so it ships dormant.
