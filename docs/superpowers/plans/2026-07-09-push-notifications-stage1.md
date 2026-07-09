# Push Notifications — Stage 1 (the pipe) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove an end-to-end Web Push pipe — a rider enables notifications in the app, and when the watcher next detects an opening it delivers a push to that device — gated behind the `internal` tier so only the developer sees it.

**Architecture:** The client subscribes via `PushManager` and POSTs the subscription to a new registration Lambda (function URL), which stores it in DynamoDB. The existing every-10-min watcher Lambda gains a send step: after detecting openings it loads subscriptions and sends via `pywebpush`, signing with a VAPID private key held in SSM. Stage 1 keeps filtering minimal (any detected opening → one summary push to every subscription); per-user filtering + anti-spam are Stage 2.

**Tech Stack:** AWS CDK (TypeScript), Python 3.12 Lambda (`pywebpush`, `boto3`, DynamoDB, SSM), vanilla-JS PWA (service worker `push`/`notificationclick`, `PushManager`), Node's built-in test runner, `pytest`.

**Scope note:** This is Stage 1 of the umbrella design `docs/superpowers/specs/2026-07-09-push-notifications-design.md`. It is deliberately the *pipe only*. Do NOT build days/types/travel-time filtering, coalescing, quiet hours, caps, the intro slide, or the iOS onboarding path — those are Stages 2–3.

---

## File Structure

**AWS (new):**
- `aws/lambda-register/handler.py` — registration Lambda: subscribe / unsubscribe, writes DynamoDB. Its own asset dir (no tzdata/webpush deps → tiny).
- `aws/lambda-register/test_register.py` — pytest for the pure item-building/parsing logic.
- `aws/lambda/push.py` — watcher-side push helpers: `build_payload`, `send_all`. Pure, injectable poster.
- `aws/lambda/test_push.py` — pytest for `push.py` and the send wiring in `handler.run`.

**AWS (modified):**
- `aws/cdk/lib/watcher-stack.ts` — add DynamoDB table, registration Lambda + function URL, SSM VAPID param import, watcher env + IAM grants, CfnOutputs.
- `aws/lambda/handler.py` — thread a `send` callback through `run()`; call it in `lambda_handler`.
- `aws/lambda/requirements.txt` — add `pywebpush`.
- `aws/lambda/build-lambda.sh` — install deps as **Linux** wheels (cryptography is native).

**Client (new):**
- `app/js/push.js` — `subscribe()`, `unsubscribe()`, `notifState()`, `urlBase64ToUint8Array()`.
- `app/test/push.test.js` — Node test for the pure helper.

**Client (modified):**
- `app/js/config.js` — `FEATURES.notifications = "internal"`; add `VAPID_PUBLIC_KEY`, `PUSH_REGISTER_URL`.
- `app/sw.js` — `push` + `notificationclick` handlers; bump `CACHE`; add `./js/push.js` to `ASSETS`.
- `app/js/views/settings.js` — a `Notifications` section (gated `isOn("notifications")`) with an enable toggle.
- `app/js/store.js` — no change (subscription state is read from the browser, not localStorage).

---

## Task 1: Generate the VAPID keypair and store it

VAPID is the signing identity for Web Push. The **private** key signs each push (server-side, secret); the **public** key is handed to the browser at subscribe time. This is a one-time ops step, not code — no test.

**Files:** none committed as secrets. Public key goes into `app/js/config.js` in Task 7. Private key goes into SSM.

- [ ] **Step 1: Generate the keypair**

The `py-vapid` CLI ships with `pywebpush`. Run:

```bash
/opt/homebrew/bin/python3 -m pip install py-vapid
cd /tmp && vapid --gen && vapid --applicationServerKey
```

`vapid --gen` writes `private_key.pem` and `public_key.pem` to the cwd. `vapid --applicationServerKey` prints the browser-facing key as `Application Server Key = <base64url>`.

Expected: a line `Application Server Key = BB....` (~87 chars, URL-safe base64, no padding).

- [ ] **Step 2: Store the private key in SSM as a SecureString**

```bash
aws ssm put-parameter --region eu-west-1 \
  --name /lagoon/push/vapid-private \
  --type SecureString \
  --value "$(cat /tmp/private_key.pem)"
```

Expected: `{ "Version": 1, "Tier": "Standard" }`.

- [ ] **Step 3: Record the public key for Task 7 and scrub temp files**

Copy the `Application Server Key` value somewhere for Task 7, then:

```bash
shred -u /tmp/private_key.pem /tmp/public_key.pem 2>/dev/null || rm -f /tmp/private_key.pem /tmp/public_key.pem
```

No commit — nothing secret enters the repo (public repo rule). The private key lives only in SSM.

---

## Task 2: DynamoDB subscriptions table (CDK)

**Files:**
- Modify: `aws/cdk/lib/watcher-stack.ts`

- [ ] **Step 1: Import the DynamoDB module**

At the top of `aws/cdk/lib/watcher-stack.ts`, after the existing `import * as logs ...` line, add:

```typescript
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
```

- [ ] **Step 2: Create the table**

Immediately after the `stateBucket` block (before the `WatcherFn` function), add:

```typescript
// Push subscriptions. PK = subId (a sha256 of the push endpoint — deterministic,
// bounded length). Pay-per-request: traffic is tiny and spiky. Stage 1 stores the
// subscription only; Stage 2 adds prefs columns to the same item.
const subsTable = new dynamodb.Table(this, "PushSubs", {
  partitionKey: { name: "subId", type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: RemovalPolicy.DESTROY, // subscriptions are re-createable from the client
});
```

- [ ] **Step 3: Synth to verify it compiles**

Run: `cd aws/cdk && npx cdk synth > /dev/null`
Expected: exits 0, no TypeScript errors. (It builds the Lambda asset first via the `synth` npm script only when run through `npm run synth`; `npx cdk synth` alone still type-checks the stack. If the asset is stale that's fine here — we only care the stack compiles.)

- [ ] **Step 4: Commit**

```bash
git add aws/cdk/lib/watcher-stack.ts
git commit -m "feat(push): DynamoDB subscriptions table"
```

---

## Task 3: Registration Lambda logic + tests

The registration Lambda is the client's only HTTP surface: POST a subscription to store it, DELETE to remove it. Keep the AWS-touching code in `lambda_handler` and the decision logic pure (like `handler.py` does).

**Files:**
- Create: `aws/lambda-register/handler.py`
- Test: `aws/lambda-register/test_register.py`

- [ ] **Step 1: Write the failing test**

Create `aws/lambda-register/test_register.py`:

```python
import json
import handler


def test_sub_id_is_stable_sha256_of_endpoint():
    a = handler.sub_id("https://push.example/abc")
    b = handler.sub_id("https://push.example/abc")
    c = handler.sub_id("https://push.example/xyz")
    assert a == b            # deterministic
    assert a != c            # endpoint-specific
    assert len(a) == 64      # hex sha256


def test_sub_item_extracts_endpoint_and_keys():
    sub = {"endpoint": "https://push.example/abc",
           "keys": {"p256dh": "PUB", "auth": "AUTH"}}
    item = handler.sub_item(sub, now_iso="2026-07-09T12:00:00Z")
    assert item == {
        "subId": handler.sub_id("https://push.example/abc"),
        "endpoint": "https://push.example/abc",
        "p256dh": "PUB",
        "auth": "AUTH",
        "createdAt": "2026-07-09T12:00:00Z",
    }


def test_parse_request_subscribe_and_unsubscribe():
    sub = {"endpoint": "https://push.example/abc",
           "keys": {"p256dh": "PUB", "auth": "AUTH"}}
    assert handler.parse_request("POST", json.dumps({"subscription": sub})) == ("subscribe", sub)
    assert handler.parse_request("DELETE", json.dumps({"endpoint": "https://push.example/abc"})) == \
        ("unsubscribe", "https://push.example/abc")


def test_parse_request_rejects_bad_input():
    assert handler.parse_request("POST", "{}")[0] == "error"
    assert handler.parse_request("PATCH", "{}")[0] == "error"
    assert handler.parse_request("POST", "not json")[0] == "error"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd aws/lambda-register && /opt/homebrew/bin/python3 -m pytest test_register.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'handler'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `aws/lambda-register/handler.py`:

```python
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
        "auth": keys["auth"],
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
        if isinstance(sub, dict) and sub.get("endpoint") and sub.get("keys"):
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd aws/lambda-register && /opt/homebrew/bin/python3 -m pytest test_register.py -q`
Expected: PASS — 4 passed.

- [ ] **Step 5: Commit**

```bash
git add aws/lambda-register/handler.py aws/lambda-register/test_register.py
git commit -m "feat(push): registration Lambda subscribe/unsubscribe logic"
```

---

## Task 4: Wire the registration Lambda + function URL (CDK)

**Files:**
- Modify: `aws/cdk/lib/watcher-stack.ts`

- [ ] **Step 1: Add the CfnOutput import**

In `aws/cdk/lib/watcher-stack.ts`, change the first import line to also pull `CfnOutput`:

```typescript
import { Stack, StackProps, Duration, RemovalPolicy, CfnOutput } from "aws-cdk-lib";
```

- [ ] **Step 2: Create the registration function + URL**

After the `subsTable` block, add:

```typescript
// Registration endpoint the client POSTs subscriptions to. Its own tiny asset dir
// (no tzdata/webpush). Function URL = a plain HTTPS endpoint, no API Gateway.
const registerFn = new lambda.Function(this, "RegisterFn", {
  runtime: lambda.Runtime.PYTHON_3_12,
  handler: "handler.lambda_handler",
  code: lambda.Code.fromAsset(path.join(__dirname, "..", "..", "lambda-register")),
  timeout: Duration.seconds(10),
  memorySize: 128,
  logRetention: logs.RetentionDays.ONE_MONTH,
  environment: { SUBS_TABLE: subsTable.tableName },
});
subsTable.grantWriteData(registerFn); // put_item + delete_item

const registerUrl = registerFn.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE, // opaque endpoint; subscription itself is the capability
});
new CfnOutput(this, "RegisterUrl", { value: registerUrl.url });
```

- [ ] **Step 3: Synth to verify**

Run: `cd aws/cdk && npx cdk synth > /dev/null`
Expected: exits 0. (The `lambda-register` asset dir now exists from Task 3, so the asset bundles.)

- [ ] **Step 4: Commit**

```bash
git add aws/cdk/lib/watcher-stack.ts
git commit -m "feat(push): registration Lambda + function URL"
```

---

## Task 5: Watcher push helpers + tests

**Files:**
- Create: `aws/lambda/push.py`
- Test: `aws/lambda/test_push.py`

- [ ] **Step 1: Write the failing test**

Create `aws/lambda/test_push.py`:

```python
import push


def _rec(label="Tech", start="2026-07-12T18:00", free=2):
    return {"label": label, "startLondon": start, "free": free,
            "book": "https://booking.lagoon.co.uk/book?courseRunId=1"}


def test_build_payload_single():
    p = push.build_payload([_rec()])
    assert p["title"] == "A spot opened at Hove Lagoon"
    assert "Tech" in p["body"] and "18:00" in p["body"]
    assert p["url"].endswith("/lagoon/")


def test_build_payload_coalesces_count():
    p = push.build_payload([_rec(), _rec(start="2026-07-12T19:00")])
    assert "2 spots" in p["body"]


def test_send_all_posts_each_and_drops_410():
    subs = [
        {"subId": "a", "endpoint": "e1", "p256dh": "k1", "auth": "x1"},
        {"subId": "b", "endpoint": "e2", "p256dh": "k2", "auth": "x2"},
    ]
    sent, gone = [], []

    class Gone(Exception):
        def __init__(self):
            self.response = type("R", (), {"status_code": 410})()

    def poster(sub_info, data, vapid_private_key, vapid_claims):
        sent.append(sub_info["endpoint"])
        if sub_info["endpoint"] == "e2":
            raise Gone()

    dead = push.send_all(subs, {"title": "t"}, "PEM", "mailto:x@y.z",
                         poster=poster, on_gone=lambda s: gone.append(s["subId"]))
    assert sent == ["e1", "e2"]
    assert dead == ["b"] and gone == ["b"]
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd aws/lambda && /opt/homebrew/bin/python3 -m pytest test_push.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'push'`.

- [ ] **Step 3: Write the implementation**

Create `aws/lambda/push.py`:

```python
"""Watcher-side Web Push helpers. Pure/injectable so they unit-test without AWS
or network. Stage 1: one summary notification per run to every subscription.
"""
from __future__ import annotations

APP_URL = "https://www.dave-smith.co.uk/lagoon/"


def build_payload(records: list[dict]) -> dict:
    """Notification payload (title/body/url) for a batch of opening records."""
    n = len(records)
    if n == 1:
        r = records[0]
        body = f"{r['label']} · {r['startLondon'][11:]} · {r['free']} free — tap to view"
    else:
        body = f"{n} spots opened — tap to view"
    return {"title": "A spot opened at Hove Lagoon", "body": body, "url": APP_URL}


def send_all(subs, payload, vapid_private_key, vapid_subject, poster, on_gone=None):
    """Send `payload` to every subscription via `poster`. Returns subIds that are
    Gone (HTTP 410) — expired subscriptions the caller should delete. `poster` has
    the pywebpush.webpush signature; `on_gone(sub)` is called per dead sub.
    """
    import json

    dead = []
    for s in subs:
        sub_info = {"endpoint": s["endpoint"],
                    "keys": {"p256dh": s["p256dh"], "auth": s["auth"]}}
        try:
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd aws/lambda && /opt/homebrew/bin/python3 -m pytest test_push.py -q`
Expected: PASS — 3 passed.

- [ ] **Step 5: Commit**

```bash
git add aws/lambda/push.py aws/lambda/test_push.py
git commit -m "feat(push): watcher build_payload + send_all helpers"
```

---

## Task 6: Thread send into the watcher run + build/IAM

**Files:**
- Modify: `aws/lambda/handler.py`
- Modify: `aws/lambda/requirements.txt`
- Modify: `aws/lambda/build-lambda.sh`
- Modify: `aws/cdk/lib/watcher-stack.ts`
- Test: `aws/lambda/test_push.py` (add one wiring test)

- [ ] **Step 1: Write the failing wiring test**

Append to `aws/lambda/test_push.py`:

```python
import datetime as dt
import handler


def test_run_calls_send_when_releases_found():
    now = dt.datetime(2026, 7, 10, 12, 0, tzinfo=dt.timezone.utc)

    class Slot:
        key = "1@x"; label = "Tech"; course_id = 1; run_id = 9
        free = 2; capacity = 6
        start = dt.datetime(2026, 7, 11, 17, 0, tzinfo=dt.timezone.utc)
        local = dt.datetime(2026, 7, 11, 18, 0)

    calls = []
    handler.run(
        read_state=lambda: {},                       # prev free = 0 for our key
        write_state=lambda free: None,
        courses=[], now=now, urgent_hours=48, horizon_days=14,
        find_openings=lambda *a, **k: [Slot()],
        send=lambda records: calls.append(records),
    )
    assert len(calls) == 1 and calls[0][0]["label"] == "Tech"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd aws/lambda && /opt/homebrew/bin/python3 -m pytest test_push.py::test_run_calls_send_when_releases_found -q`
Expected: FAIL — `TypeError: run() got an unexpected keyword argument 'send'`.

- [ ] **Step 3: Add the `send` hook to `run()`**

In `aws/lambda/handler.py`, change the `run` signature and body. Replace:

```python
def run(read_state, write_state, courses, now, urgent_hours, horizon_days,
        find_openings=lc.find_openings):
```
with:
```python
def run(read_state, write_state, courses, now, urgent_hours, horizon_days,
        find_openings=lc.find_openings, send=None):
```

Then, in `run`, after the `for r in records: print(...)` loop and before the `summary` print, add:

```python
    if records and send:
        send(records)
```

- [ ] **Step 4: Run the wiring test to verify it passes**

Run: `cd aws/lambda && /opt/homebrew/bin/python3 -m pytest test_push.py -q`
Expected: PASS — 4 passed.

- [ ] **Step 5: Wire the real sender in `lambda_handler`**

In `aws/lambda/handler.py`, inside `lambda_handler`, after the `write_state` def and before `courses = lc.resolve_courses(...)`, add:

```python
    subs_table = os.environ.get("SUBS_TABLE")
    vapid_param = os.environ.get("VAPID_PRIVATE_PARAM")

    def send(records):
        import push
        from pywebpush import webpush
        ddb = boto3.resource("dynamodb").Table(subs_table)
        subs = ddb.scan(ProjectionExpression="subId,endpoint,p256dh,auth").get("Items", [])
        if not subs:
            return
        priv = boto3.client("ssm").get_parameter(
            Name=vapid_param, WithDecryption=True)["Parameter"]["Value"]
        dead = push.send_all(
            subs, push.build_payload(records), priv, "mailto:dave@dave-smith.co.uk",
            poster=webpush, on_gone=lambda s: ddb.delete_item(Key={"subId": s["subId"]}))
        print(json.dumps({"pushSummary": {"subs": len(subs), "dead": len(dead)}}))
```

Then pass it to `run(...)` — change the `run(` call to include `send=send if subs_table else None,` as a new keyword argument (add it after `horizon_days=...`).

- [ ] **Step 6: Add pywebpush to requirements**

`aws/lambda/requirements.txt` currently holds `tzdata`. Add a line so it reads:

```
tzdata
pywebpush
```

- [ ] **Step 7: Fix the build for native (Linux) wheels**

`pywebpush` pulls in `cryptography`, which is a **native** package — a macOS wheel won't run on the Lambda Linux runtime. Edit `aws/lambda/build-lambda.sh`, replacing the single `pip install` line:

```bash
"$PYTHON" -m pip install -r "$HERE/requirements.txt" -t "$BUILD" --quiet
```
with a Linux-targeted install:
```bash
"$PYTHON" -m pip install -r "$HERE/requirements.txt" -t "$BUILD" --quiet \
  --platform manylinux2014_x86_64 --implementation cp --python-version 3.12 \
  --only-binary=:all: --upgrade
```

(The watcher's `lambda.Runtime.PYTHON_3_12` is x86_64 by default, matching `manylinux2014_x86_64`.)

- [ ] **Step 8: Grant the watcher table + SSM access and pass env (CDK)**

In `aws/cdk/lib/watcher-stack.ts`, in the `WatcherFn` `environment` block, add two entries:

```typescript
        SUBS_TABLE: subsTable.tableName,
        VAPID_PRIVATE_PARAM: "/lagoon/push/vapid-private",
```

After the existing `stateBucket.grantRead(fn); stateBucket.grantPut(fn);` lines, add:

```typescript
subsTable.grantReadWriteData(fn); // scan + delete expired (410) subscriptions
fn.addToRolePolicy(new iam.PolicyStatement({
  actions: ["ssm:GetParameter"],
  resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/lagoon/push/vapid-private`],
}));
```

Add the IAM import at the top with the other imports:

```typescript
import * as iam from "aws-cdk-lib/aws-iam";
```

- [ ] **Step 9: Build + synth to verify end-to-end compile**

Run: `cd aws/cdk && npm run synth > /dev/null`
Expected: exits 0 — the build script installs Linux wheels into `aws/lambda/build` and cdk synth succeeds. If pip errors on `--platform`, ensure pip ≥ 22 (`$PYTHON -m pip install -U pip`).

- [ ] **Step 10: Commit**

```bash
git add aws/lambda/handler.py aws/lambda/requirements.txt aws/lambda/build-lambda.sh aws/lambda/test_push.py aws/cdk/lib/watcher-stack.ts
git commit -m "feat(push): watcher sends via pywebpush; VAPID from SSM"
```

- [ ] **Step 11: Deploy the stack**

Run: `cd aws/cdk && npm run deploy` (approve IAM changes when prompted).
Expected: `WatcherStack` updates; the outputs print `WatcherStack.RegisterUrl = https://<id>.lambda-url.eu-west-1.on.aws/`. **Record that URL for Task 7.**

---

## Task 7: Client config — feature flag + push endpoints

**Files:**
- Modify: `app/js/config.js`

- [ ] **Step 1: Add the notifications flag**

In `app/js/config.js`, change the `FEATURES` object to:

```javascript
export const FEATURES = {
  notifications: "internal", // push notifications — Stage 1 pipe, dev-only
};
```

- [ ] **Step 2: Add the VAPID public key + register URL**

After the `BOOKING_SITE` line, add (using the values from Task 1 Step 3 and Task 6 Step 11):

```javascript
// Web Push (see docs/superpowers/specs/2026-07-09-push-notifications-design.md).
// Public key is safe to ship; the private key lives only in SSM.
export const VAPID_PUBLIC_KEY = "PASTE_APPLICATION_SERVER_KEY_FROM_TASK_1";
export const PUSH_REGISTER_URL = "PASTE_REGISTER_URL_FROM_TASK_6";
```

- [ ] **Step 3: Verify the module still parses**

Run: `cd app && node -e "import('./js/config.js').then(m => console.log(m.FEATURES.notifications, m.VAPID_PUBLIC_KEY.slice(0,4)))"`
Expected: prints `internal` and the first 4 chars of the key (e.g. `BB..`).

- [ ] **Step 4: Commit**

```bash
git add app/js/config.js
git commit -m "feat(push): notifications flag + VAPID public key + register URL"
```

---

## Task 8: Client push module + test

**Files:**
- Create: `app/js/push.js`
- Test: `app/test/push.test.js`

- [ ] **Step 1: Write the failing test**

Create `app/test/push.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { urlBase64ToUint8Array } from "../js/push.js";

test("urlBase64ToUint8Array decodes URL-safe base64 to bytes", () => {
  // "hello" in standard base64 is "aGVsbG8"; URL-safe, unpadded here.
  const out = urlBase64ToUint8Array("aGVsbG8");
  assert.ok(out instanceof Uint8Array);
  assert.deepEqual([...out], [104, 101, 108, 108, 111]); // h e l l o
});

test("urlBase64ToUint8Array handles - and _ (URL-safe alphabet)", () => {
  // 0xfb 0xff 0xbf encodes to "-_-_" in URL-safe base64.
  const out = urlBase64ToUint8Array("-_-_");
  assert.deepEqual([...out], [0xfb, 0xff, 0xbf]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test app/test/push.test.js`
Expected: FAIL — cannot find export `urlBase64ToUint8Array` (file doesn't exist).

- [ ] **Step 3: Write the implementation**

Create `app/js/push.js`:

```javascript
// Web Push client: subscribe/unsubscribe via the service worker's PushManager and
// register the subscription with our Lambda. Gated by the `notifications` flag; the
// enable toggle lives in Settings. Browser-only APIs (navigator.serviceWorker,
// PushManager, Notification) — only urlBase64ToUint8Array is pure/unit-tested.
import { VAPID_PUBLIC_KEY, PUSH_REGISTER_URL } from "./config.js";

// VAPID public key (URL-safe base64) -> Uint8Array for applicationServerKey.
export function urlBase64ToUint8Array(base64) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// "unsupported" | "denied" | "granted-unsubscribed" | "subscribed"
export async function notifState() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window))
    return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub ? "subscribed" : "granted-unsubscribed";
}

// Request permission, subscribe, and POST the subscription to our Lambda.
// Returns true on success. Throws if permission is refused.
export async function subscribe() {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("permission " + perm);
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  await fetch(PUSH_REGISTER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  });
  return true;
}

// Unsubscribe locally and tell the Lambda to drop it.
export async function unsubscribe() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await fetch(PUSH_REGISTER_URL, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test app/test/push.test.js`
Expected: PASS — 2 passed. (The pure helper works under Node; the browser functions aren't exercised here.)

- [ ] **Step 5: Commit**

```bash
git add app/js/push.js app/test/push.test.js
git commit -m "feat(push): client subscribe/unsubscribe module"
```

---

## Task 9: Service worker push + notificationclick handlers

**Files:**
- Modify: `app/sw.js`

- [ ] **Step 1: Add the handlers**

At the end of `app/sw.js` (after the `fetch` listener), add:

```javascript
// Web Push: show the notification from the pushed JSON payload.
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = {}; }
  const title = d.title || "Hove Lagoon";
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || "",
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    data: { url: d.url || "./" },
    tag: "lagoon-opening", // coalesce onto one notification per device
  }));
});

// Tap → focus an existing app tab (or open one) at the payload URL.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
    for (const w of wins) { if ("focus" in w) return w.focus(); }
    return clients.openWindow(url);
  }));
});
```

- [ ] **Step 2: Bump the cache version + precache push.js**

In `app/sw.js`, change the first line:

```javascript
const CACHE = "lagoon-v50";
```

and add `"./js/push.js"` to the `ASSETS` array (append it to the line that lists the other `./js/*.js` modules).

- [ ] **Step 3: Bump APP_RELEASE to match**

In `app/js/config.js`, change `APP_RELEASE` to `"v50"` (keep it in sync with the SW cache — the project's hard rule).

- [ ] **Step 4: Verify the SW file is valid JS**

Run: `node --check app/sw.js`
Expected: exits 0 (no syntax error). (`self`/`clients` are runtime globals — `--check` only parses, so this is a valid syntax gate.)

- [ ] **Step 5: Commit**

```bash
git add app/sw.js app/js/config.js
git commit -m "feat(push): service worker push + notificationclick; bump v50"
```

---

## Task 10: Settings — Notifications section

**Files:**
- Modify: `app/js/views/settings.js`

- [ ] **Step 1: Import the flag check + push module**

In `app/js/views/settings.js`, add to the imports:

```javascript
import { isOn } from "../features.js";
import { notifState, subscribe, unsubscribe } from "../push.js";
```

(Note: `accessTier` is already imported from `../features.js` — extend that import line to `import { accessTier, isOn } from "../features.js";` rather than adding a duplicate import.)

- [ ] **Step 2: Add a module-level notif-state cache**

Near the top, beside `let devTaps = 0;`, add:

```javascript
let notifOn = false; // last-read push subscription state, refreshed on render
```

- [ ] **Step 3: Render the section (gated) in the Settings tab**

In the `settingsTab` template, immediately after the Beta section block and before the Developer block, add:

```javascript
    ${isOn("notifications") ? `<div class="t" style="margin-top:18px">Notifications</div>
    <div class="set-row"><span>Spot-opened alerts</span>${switchHtml("notif-toggle", notifOn)}</div>
    <div class="set-cap">Get a push when a spot opens. You'll be asked for permission.</div>` : ""}`;
```

- [ ] **Step 4: Refresh the state + wire the toggle**

In `renderSettings`, after the `it` (internal-toggle) wiring block and before the `ver` wiring, add:

```javascript
  const nt = view.querySelector("#notif-toggle");
  if (nt) {
    notifState().then((s) => { notifOn = s === "subscribed"; nt.checked = notifOn; });
    nt.addEventListener("change", async () => {
      nt.disabled = true;
      try {
        if (nt.checked) { await subscribe(); notifOn = true; }
        else { await unsubscribe(); notifOn = false; }
      } catch { notifOn = false; nt.checked = false; }
      finally { nt.disabled = false; renderSettings(view, state, go); }
    });
  }
```

- [ ] **Step 5: Verify the module parses**

Run: `cd app && node -e "import('./js/views/settings.js').then(() => console.log('ok'))"`
Expected: prints `ok` (imports resolve; note this loads `push.js`/`config.js` too — no browser calls run at import time).

- [ ] **Step 6: Commit**

```bash
git add app/js/views/settings.js
git commit -m "feat(push): Settings notifications toggle (gated internal)"
```

---

## Task 11: Full suite + end-to-end manual verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole JS suite**

Run: `node --test app/test/*.test.js`
Expected: all pass (previous 57 + 2 new push helper tests = 59).

- [ ] **Step 2: Run the Python suites**

Run: `cd aws/lambda && /opt/homebrew/bin/python3 -m pytest -q && cd ../lambda-register && /opt/homebrew/bin/python3 -m pytest -q`
Expected: both green (push: 4, register: 4).

- [ ] **Step 3: Deploy the client**

The client is live-served from the `daves-adventures` site. Merge this branch to `main` (PR), then:
Run: `gh workflow run "Deploy Hugo Site (AWS)" -R davidfsmith/daves-adventures`
Wait: `gh run watch <id> -R davidfsmith/daves-adventures`
Verify: `curl -s https://www.dave-smith.co.uk/lagoon/sw.js | grep CACHE` → `lagoon-v50`.

- [ ] **Step 4: Enable notifications on a real device (internal tier)**

On your phone (iPhone: add the PWA to the home screen first; Android: browser is fine), open the app → Settings → unlock Developer (tap the About version row 7×) → the **Notifications** section appears (it's `internal`-gated) → toggle **Spot-opened alerts** on → accept the OS permission prompt.
Verify: `aws dynamodb scan --region eu-west-1 --table-name <PushSubs table name> --select COUNT` shows `Count: 1`. (Find the table name: `aws cloudformation describe-stack-resources --region eu-west-1 --stack-name WatcherStack --query "StackResources[?ResourceType=='AWS::DynamoDB::Table'].PhysicalResourceId".)

- [ ] **Step 5: Force a send and confirm delivery**

Manually invoke the watcher so it detects an opening. Easiest: temporarily clear the state object so the next run treats current free counts as a release, then invoke:
```bash
BUCKET=$(aws cloudformation describe-stack-resources --region eu-west-1 --stack-name WatcherStack --query "StackResources[?ResourceType=='AWS::S3::Bucket'].PhysicalResourceId" --output text)
aws s3 rm "s3://$BUCKET/state/free.json"   # next run has prev=None -> baseline only, so run twice
FN=$(aws cloudformation describe-stack-resources --region eu-west-1 --stack-name WatcherStack --query "StackResources[?ResourceType=='AWS::Lambda::Function' && contains(PhysicalResourceId, 'Watcher')].PhysicalResourceId" --output text)
aws lambda invoke --region eu-west-1 --function-name "$FN" /dev/stdout   # run 1: baseline
aws lambda invoke --region eu-west-1 --function-name "$FN" /dev/stdout   # run 2: sends if free rose
```
Expected: a push notification arrives on the device; CloudWatch logs show `{"pushSummary": {"subs": 1, "dead": 0}}`. If nothing currently free changed between runs, wait for a genuine opening or book/cancel a throwaway spot to create one.

- [ ] **Step 6: Confirm tap deep-links and opt-out works**

Tap the notification → the app opens/focuses at `/lagoon/`. Then Settings → toggle **Spot-opened alerts** off → re-scan DynamoDB shows `Count: 0`.

- [ ] **Step 7: Final commit (if any verification fixups were needed)**

```bash
git add -A && git commit -m "chore(push): stage 1 verification fixups" || echo "nothing to fix"
```

---

## Self-Review notes (author)

- **Spec coverage (Stage 1 slice):** VAPID (T1), DynamoDB store (T2), registration Lambda + URL (T3–T4), watcher send via pywebpush (T5–T6), `sw.js` push/notificationclick (T9), client subscribe + enable toggle gated `internal` (T7–T10), deploy + e2e (T11). Deferred by design to Stage 2/3: per-user day/type/travel filtering, coalesce/quiet-hours/cap, intro slide, iOS onboarding path. The Stage 1 `build_payload` already emits a single coalesced-ish summary so the barrage risk is bounded even before Stage 2.
- **Type consistency:** DynamoDB item fields (`subId`, `endpoint`, `p256dh`, `auth`) are identical in the registration Lambda (`sub_item`) and the watcher (`send_all` reads `p256dh`/`auth`). `build_payload` consumes `record` dicts exactly as `handler.release_record` produces them (`label`, `startLondon`, `free`, `book`). `send=` kwarg added to `run()` matches the call site. `urlBase64ToUint8Array` name matches between `push.js` and its test.
- **Native-deps gotcha** is handled explicitly (T6 S7 Linux wheels) — the most likely deploy failure if missed.
