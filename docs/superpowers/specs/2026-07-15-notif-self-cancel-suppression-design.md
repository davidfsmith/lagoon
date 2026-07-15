# Notifications: suppress self-cancellation alerts — design

**Status:** approved approach, gated `internal` for the first release.
**Date:** 2026-07-15

## Goal

Stop a rider being notified about a slot **they themselves just freed**. Today: you cancel a
session on a day/type you have alerts for → the free count rises → the watcher detects a "new
opening" → and since it matches your prefs and is reachable, it pings *you* about the spot you
just vacated. Other riders *should* still be notified (a spot genuinely opened) — only the
canceller is suppressed.

## Why it's server-side

- The watcher only sees **free counts rising** — it doesn't know *who* cancelled.
- Subscriptions are keyed by push endpoint (device), **not** linked to a Lagoon account, so the
  server can't auto-correlate an opening with a subscriber's cancellation.
- Web Push is `userVisibleOnly` — the service worker **can't silently drop** a push (the browser
  will show a generic notification and may revoke the subscription). So the fix must be **don't
  send it**, decided server-side.

The device that cancelled *does* know which slot it freed — so it tells the server to suppress
that one slot for that one subscription.

## Slot key (verified)

Both sides key a slot as **`{courseId}@{startISO}`**:
- App: `slotKey(courseId, startISO)` in `model.js` (raw API `startDate`).
- Watcher: `f"{course_id}@{start.isoformat()}"` in `lagoon_client.py`.

Verified against the live API: `datetime.fromisoformat(raw).isoformat()` reproduces the API's
`+00:00` string exactly, so the app's raw-string key **byte-matches** the watcher's. **Risk:** if
the API ever serialises differently (e.g. `Z`, fractional seconds), the keys stop matching and
suppression silently no-ops — degrading to *today's* behaviour (self-notification), not an error.

## Gating

New flag **`FEATURES.cancelSuppress = "internal"`**, guarding only the **client** call. The
server pieces (register `suppress` action, watcher filter check) ship **unconditionally** — they
only ever act on suppress entries, which only opted-in (internal) devices create, so they're inert
for everyone else. Lifecycle: `internal → beta? → on → retire`, like the others.

## Design

### Data — a `suppress` map on the subscription item

Add `suppress` = `{ slotKey: expiryEpoch }` to the DynamoDB sub item (alongside the server-owned
`notifyLog` / `pending`). It's created lazily by the suppress action's `if_not_exists` guard
(below) — subscribe writes via a curated `SET`, not a wholesale put, so there's nothing to
initialise elsewhere.

### 1. Client — on cancel, tell the server (`account.js`, `push.js`)

After a successful `cancelParticipant`, `account.js` `onCancel` computes the freed slot's key from
the booking (`slotKey(booking.courseRun.course.id, booking.courseRun.startDate)`) and, **when
`isOn("cancelSuppress")`**, calls a new `push.js` helper:

```js
// push.js — best-effort; no-op if not subscribed. Never rejects.
export async function suppressSlot(key) {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  try {
    await fetch(PUSH_REGISTER_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ suppress: { endpoint: sub.endpoint, key } }),
    });
  } catch { /* best-effort */ }
}
```

If the rider isn't subscribed, or the fetch fails, nothing happens (they'd just get the current
behaviour). Fire-and-forget — the cancel UX doesn't wait on it.

### 2. Register Lambda — a `suppress` action (`aws/lambda-register/handler.py`)

`parse_request` recognises a body with a `suppress` object → `("suppress", {"endpoint", "key"})`.
`lambda_handler` adds it with **atomic nested sets** (no read, so it can't clobber the watcher's
concurrent `notifyLog`/`pending` write, and vice-versa). Because a nested `SET suppress.#k` fails
if the parent map is absent — and **subscriptions created before this change have no `suppress`
map** — do it in two steps: ensure the parent exists (idempotent), then set the key:

```python
SUPPRESS_TTL_SECS = 6 * 3600  # covers the ≤10-min detect window with wide margin

# handler:
if action == "suppress":
    key = {"subId": sub_id(data["endpoint"])}
    exp = int(now.timestamp()) + SUPPRESS_TTL_SECS
    table.update_item(Key=key,                                  # create parent if missing
        UpdateExpression="SET suppress = if_not_exists(suppress, :empty)",
        ExpressionAttributeValues={":empty": {}})
    table.update_item(Key=key,                                  # then the atomic nested set
        UpdateExpression="SET suppress.#k = :exp",
        ExpressionAttributeNames={"#k": data["key"]},
        ExpressionAttributeValues={":exp": exp})
    return _resp(200, {"ok": True})
```

Two round-trips, but `suppress` is a rare op (a cancel), and both are atomic/idempotent so no read
and no cross-writer clobber. 6-hour TTL is ample: the opening is detected on the watcher's *next*
run (≤10 min after the cancel), a **one-time** free-count-rise diff, so the suppress only needs to
survive that single detection.

(The `if_not_exists` guard is what makes this correct for *every* subscription — new and
pre-existing — without a migration.)

### 3. Watcher filter — skip suppressed slots (`aws/lambda/notify_filter.py`)

`filter_for_sub` reads `sub.get("suppress")` and excludes any opening whose key is suppressed and
unexpired — both in the new-openings pass and the quiet-hours `pending` re-check:

```python
suppress = sub.get("suppress") or {}
now_epoch = int(now.timestamp())
def _suppressed(key):
    exp = suppress.get(key)
    return exp is not None and int(exp) > now_epoch
# new-openings candidate filter gains:  and not _suppressed(r["key"])
# pending re-check gains:                and not _suppressed(key)
```

### Concurrency (two writers, no clobber)

- **Register Lambda** writes *only* `suppress.<key>` (atomic nested `SET`).
- **Watcher** writes *only* `notifyLog` / `pending` (its existing `SET #nl, #pd`) and **reads**
  `suppress` — it never writes it. Different attributes → no clobber either way.
- Expired `suppress` entries are ignored at read time and left in place (not pruned). They're tiny
  (~40 bytes) and rare (one per cancel), so accumulation is negligible against the 400 KB item
  limit. (A periodic prune can be added later if ever needed — out of scope.)

## Files

- `app/js/config.js` — `FEATURES.cancelSuppress = "internal"`; version bump.
- `app/js/push.js` — new `suppressSlot(key)`.
- `app/js/views/account.js` — `onCancel` computes the key + calls `suppressSlot` behind
  `isOn("cancelSuppress")`; import `isOn`, `suppressSlot`, `slotKey`.
- `aws/lambda-register/handler.py` — `parse_request` suppress case + handler action (with the
  `if_not_exists` parent guard).
- `aws/lambda/notify_filter.py` — `_suppressed` check in both passes.
- `app/sw.js` — CACHE bump.

## Testing

- **notify_filter (pytest):** a matching opening whose key is in `suppress` (unexpired) is **not**
  sent; an **expired** suppress entry does **not** block it; a suppressed key still blocks on the
  `pending` re-check. (Extends `test_notify_filter.py`.)
- **register (pytest):** `parse_request` maps a `{suppress:{endpoint,key}}` body to
  `("suppress", {"endpoint", "key"})`, and rejects a malformed suppress body.
- **push (JS):** `suppressSlot` builds the right body / no-ops without a subscription (as far as
  the pure/mocked parts allow — mirror the existing `subscribeBody` test).
- **Key-match guard:** a small test asserting `slotKey(id, "…+00:00")` equals the documented
  watcher format, so a future drift is caught.

## Deployment

Two runtimes: the **app** (site deploy) ships the client + flag; the **watcher + register
Lambdas** need `cd aws/cdk && npm run deploy` (Docker; user-run, classifier-gated). The server
pieces are inert until an `internal` device posts a suppress, so order doesn't matter — but both
must be deployed for the fix to actually fire.

## Rollout / testing (internal)

Dave enables dev mode, books then cancels a session on a watched day/type, and confirms **no**
self-notification arrives on the next watcher run — while a second device (or the force-send
recipe) still would. Then `internal → on`.
