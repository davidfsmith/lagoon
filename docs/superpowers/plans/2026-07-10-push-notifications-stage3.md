# Push Notifications — Stage 3 (onboarding, deep-link, polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tapping a notification deep-links to the freed slot's Day view (scrolled + highlighted); iOS-not-installed users get inline add-to-home-screen guidance; a gated intro slide introduces notifications. Feature stays `internal`.

**Architecture:** The push payload carries the earliest freed slot's date + key. The service worker routes a tap to the app (postMessage to a focused window, or `openWindow` with a `#day/...` hash for cold-open); `app.js` consumes either and calls `go("day", {date, key})`, which reuses `day.js`'s existing scroll-to-slot + highlight. Settings shows a synchronous iOS-install state when push is unsupported. The intro carousel gains a gated slide.

**Tech Stack:** Python 3.12 Lambda, vanilla-JS PWA (service worker, `postMessage`, hash routing), Node test runner, `pytest`.

**Scope:** Stage 3 of `docs/superpowers/specs/2026-07-10-push-notifications-stage3-design.md`. NOT in scope: beta/GA promotion (flag stays `internal`; intro `VERSION` unchanged).

---

## File Structure

**New:**
- `app/js/deeplink.js` — pure `parseDayHash(hash)` for the cold-open deep-link.
- `app/test/deeplink.test.js` — its test.

**Modified:**
- `aws/lambda/push.py` — `build_payload` adds `date` + `key` (earliest slot).
- `aws/lambda/test_push.py` — deep-link-target tests.
- `app/sw.js` — `push` stores date/key; `notificationclick` routes to the Day view; CACHE→v56; ASSETS += deeplink.js.
- `app/js/app.js` — service-worker `message` listener + boot `#day/...` hash → `go("day", …)`.
- `app/js/views/settings.js` — iOS add-to-home-screen inline guidance.
- `app/js/intro.js` — gated Notifications slide.
- `app/js/config.js` — `APP_RELEASE` → v56.

`app/js/views/day.js` is deliberately **unchanged** — it already scroll-highlights `{date, key}`.

---

## Task 1: Deep-link target in the payload

**Files:** Modify `aws/lambda/push.py`; Test `aws/lambda/test_push.py`.

- [ ] **Step 1: Write the failing tests.** Append to `aws/lambda/test_push.py`:

```python
def test_build_payload_carries_deeplink_target_single():
    p = push.build_payload([_rec(start="2026-07-13T18:00")])  # _rec: key="1@x"? see below
    assert p["date"] == "2026-07-13"
    assert p["key"] == "k1"


def test_build_payload_deeplink_targets_earliest_slot():
    early = _rec(key="kA", start="2026-07-12T17:00")
    late = _rec(key="kB", start="2026-07-14T19:00")
    p = push.build_payload([late, early])   # unordered
    assert p["date"] == "2026-07-12" and p["key"] == "kA"
```

Update the existing `_rec` helper at the top of `test_push.py` so records carry a `key` and a UTC `start` the payload can sort on. Replace the current `_rec` with:

```python
def _rec(label="Tech", start="2026-07-12T18:00", free=2, key="k1"):
    return {"key": key, "label": label, "startLondon": start,
            "start": start + ":00+00:00", "free": free,
            "book": "https://booking.lagoon.co.uk/book?courseRunId=1"}
```

(`start` here is a UTC ISO string; `min(..., key=start)` sorts lexicographically, which is
correct for same-format ISO timestamps. `date` derives from `startLondon[:10]`.)

- [ ] **Step 2: Run, verify FAIL.** `cd /Users/davidsmith/Development/lagoon/aws/lambda && /opt/homebrew/bin/python3 -m pytest test_push.py -q` → the two new tests fail (`KeyError: 'date'`).

- [ ] **Step 3: Implement.** In `aws/lambda/push.py`, replace `build_payload` with:

```python
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
```

- [ ] **Step 4: Run, verify PASS.** `cd /Users/davidsmith/Development/lagoon/aws/lambda && /opt/homebrew/bin/python3 -m pytest test_push.py -q` → all pass (existing build_payload tests still green — they don't assert on the extra keys).

- [ ] **Step 5: Commit.**
```bash
cd /Users/davidsmith/Development/lagoon && git add aws/lambda/push.py aws/lambda/test_push.py && git commit -m "feat(push): payload carries deep-link target (earliest slot date+key)"
```

---

## Task 2: `deeplink.js` — parse the cold-open hash

**Files:** Create `app/js/deeplink.js`; Test `app/test/deeplink.test.js`.

- [ ] **Step 1: Write the failing test.** Create `app/test/deeplink.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDayHash } from "../js/deeplink.js";

test("parseDayHash extracts date + decoded key", () => {
  const key = "50@2026-07-11T17:00:00+00:00";
  const hash = "#day/2026-07-11/" + encodeURIComponent(key);
  assert.deepEqual(parseDayHash(hash), { date: "2026-07-11", key });
});

test("parseDayHash returns null for non-day hashes", () => {
  assert.equal(parseDayHash("#lastminute"), null);
  assert.equal(parseDayHash(""), null);
  assert.equal(parseDayHash(undefined), null);
});
```

- [ ] **Step 2: Run, verify FAIL.** `node --test app/test/deeplink.test.js` → missing export.

- [ ] **Step 3: Implement.** Create `app/js/deeplink.js`:

```javascript
// Parse a notification cold-open hash "#day/<date>/<url-encoded key>" into a route
// target, or null. Used by app.js on boot to jump to a freed slot's Day view.
export function parseDayHash(hash) {
  const m = /^#day\/([^/]+)\/(.+)$/.exec(hash || "");
  return m ? { date: m[1], key: decodeURIComponent(m[2]) } : null;
}
```

- [ ] **Step 4: Run, verify PASS.** `node --test app/test/deeplink.test.js` → 2 passed.

- [ ] **Step 5: Commit.**
```bash
cd /Users/davidsmith/Development/lagoon && git add app/js/deeplink.js app/test/deeplink.test.js && git commit -m "feat(push): parseDayHash for notification cold-open deep-link"
```

---

## Task 3: Service worker — route the tap to the Day view

**Files:** Modify `app/sw.js`.

- [ ] **Step 1: Store date/key on the notification.** In `app/sw.js`, in the `push` handler, change the `data:` line so it reads:

```javascript
    data: { url: d.url || "./", date: d.date, key: d.key },
```

- [ ] **Step 2: Route on click.** Replace the whole `notificationclick` listener with:

```javascript
// Tap → jump to the freed slot's Day view. Focus an open tab (postMessage the route)
// or open a new one at a #day/<date>/<key> hash for the app to pick up on boot.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  const { date, key } = data;
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
    for (const w of wins) {
      if ("focus" in w) {
        if (date && key) w.postMessage({ type: "open-day", date, key });
        return w.focus();
      }
    }
    const url = (date && key) ? `./#day/${date}/${encodeURIComponent(key)}` : (data.url || "./");
    return clients.openWindow(url);
  }));
});
```

- [ ] **Step 3: Verify syntax.** `node --check app/sw.js` → exit 0. (`self`/`clients` are SW globals; `--check` only parses.)

- [ ] **Step 4: Commit.**
```bash
cd /Users/davidsmith/Development/lagoon && git add app/sw.js && git commit -m "feat(push): SW routes notification tap to the freed slot's Day view"
```

---

## Task 4: App — consume the deep-link (message + boot hash)

**Files:** Modify `app/js/app.js`.

`go("day", {date, key})` already exists and requires `state`. Add a stash for when the app is still loading, a service-worker message listener, and boot-time hash handling.

- [ ] **Step 1: Import the parser.** At the top of `app/js/app.js`, add to the imports:

```javascript
import { parseDayHash } from "./deeplink.js";
```

- [ ] **Step 2: Add a pending-target stash + opener.** Near the other module-level `let` declarations (e.g. after `let pendingBookingReturn = false;`), add:

```javascript
let pendingDay = null; // deep-link target from a notification, applied once state loads

function openDay(target) {
  if (!target) return;
  if (state) go("day", target); else pendingDay = target;
}
```

- [ ] **Step 3: Service-worker message listener.** After the existing `document.addEventListener("visibilitychange", ...)` block, add:

```javascript
// A notification tap in an already-open app arrives as a SW message → jump to the day.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (e) => {
    const d = e.data;
    if (d && d.type === "open-day" && d.date && d.key) openDay({ date: d.date, key: d.key });
  });
}
```

- [ ] **Step 4: Apply the pending target after load.** In `loadAndRender`, change:

```javascript
async function loadAndRender() {
  await reload(null, true); // null -> getDefaultLanding (Availability unless the user chose otherwise)
  if (state) maybeShowIntro();
}
```
to:
```javascript
async function loadAndRender() {
  await reload(null, true); // null -> getDefaultLanding (Availability unless the user chose otherwise)
  if (state && pendingDay) { go("day", pendingDay); pendingDay = null; return; } // deep-link wins over intro
  if (state) maybeShowIntro();
}
```

- [ ] **Step 5: Parse the boot hash.** In the `// boot` block at the bottom, BEFORE the `if (getToken()) loadAndRender(); else go("login");` line, add:

```javascript
const bootDay = parseDayHash(location.hash);
if (bootDay) { pendingDay = bootDay; history.replaceState(null, "", location.pathname + location.search); }
```

- [ ] **Step 6: Verify syntax.** `node --check app/js/app.js` → exit 0.

- [ ] **Step 7: Commit.**
```bash
cd /Users/davidsmith/Development/lagoon && git add app/js/app.js && git commit -m "feat(push): app consumes notification deep-link (message + boot hash)"
```

---

## Task 5: iOS add-to-home-screen inline guidance

**Files:** Modify `app/js/views/settings.js`.

When push is unsupported on iOS-not-installed, show install steps instead of the toggle.

- [ ] **Step 1: Add detection + body helpers.** Near `notifPrefsHtml` (module scope) in `app/js/views/settings.js`, add:

```javascript
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () => navigator.standalone === true
  || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window;

// The Notifications section body: install guidance on iOS-not-installed, else the toggle (+prefs).
function notifBodyHtml() {
  if (!pushSupported() && isIOS() && !isStandalone()) {
    return `<div class="set-cap ios-install">To get spot alerts, add this app to your Home Screen:
      <span class="ios-step">1. Tap the Share button <b>⬆︎</b></span>
      <span class="ios-step">2. Tap <b>Add to Home Screen</b></span>
      <span class="ios-step">Then open it from the Home Screen and turn alerts on here.</span></div>`;
  }
  return `<div class="set-row"><span>Spot-opened alerts</span>${switchHtml("notif-toggle", notifOn)}</div>
    <div class="set-cap">Get a push when a spot opens. You'll be asked for permission.</div>
    ${notifOn ? notifPrefsHtml() : ""}`;
}
```

- [ ] **Step 2: Use it in the section.** Replace the existing Notifications block in `settingsTab` (the `${isOn("notifications") ? \`...toggle...prefs...\` : ""}` block) with:

```javascript
    ${isOn("notifications") ? `<div class="t" style="margin-top:18px">Notifications</div>
    ${notifBodyHtml()}` : ""}
```

(The `#notif-toggle` wiring already guards with `if (nt)`, so when guidance is shown — no toggle — it safely no-ops.)

- [ ] **Step 3: Add CSS.** In `injectSettingsStyles`, append before the closing backtick:

```javascript
    .ios-install{line-height:1.6}
    .ios-step{display:block;margin-top:4px;color:var(--text)}
```

- [ ] **Step 4: Verify syntax.** `node --check app/js/views/settings.js` → exit 0.

- [ ] **Step 5: Commit.**
```bash
cd /Users/davidsmith/Development/lagoon && git add app/js/views/settings.js && git commit -m "feat(push): iOS add-to-home-screen guidance in Settings"
```

---

## Task 6: Gated intro slide

**Files:** Modify `app/js/intro.js`.

- [ ] **Step 1: Import `isOn`.** At the top of `app/js/intro.js`, add:

```javascript
import { isOn } from "./features.js";
```

- [ ] **Step 2: Add the gated slide.** In the `SLIDES` array, after the "Grab a last-minute spot" slide object (emoji `🔥`), insert:

```javascript
  { emoji: "🔔", title: "Get a nudge when a spot opens",
    body: "Turn on <b>spot-opened alerts</b> in Settings and the app will notify you when a session frees up on the days you ride and can reach — even when the app is closed. Choose your days, session types and travel time.",
    gate: () => isOn("notifications") },
```

- [ ] **Step 3: Filter by gate in `showIntro`.** In `showIntro`, immediately after `let i = 0;`, add:

```javascript
  const slides = SLIDES.filter((s) => !s.gate || s.gate());
```
Then replace the four `SLIDES` references inside `showIntro` with `slides`:
- `dots.innerHTML = SLIDES.map(...)` → `slides.map`
- `const s = SLIDES[i];` → `const s = slides[i];`
- `next.textContent = i === SLIDES.length - 1 ...` → `slides.length - 1`
- `function nextStep() { if (i < SLIDES.length - 1) ... }` → `slides.length - 1`

(Leave `maybeShowIntro` and the module-level `SLIDES`/`VERSION` as-is. `VERSION` is **not** bumped — the slide is preview-only via Replay intro until the beta promotion.)

- [ ] **Step 4: Verify syntax.** `node --check app/js/intro.js` → exit 0.

- [ ] **Step 5: Commit.**
```bash
cd /Users/davidsmith/Development/lagoon && git add app/js/intro.js && git commit -m "feat(push): gated notifications intro slide (no VERSION bump)"
```

---

## Task 7: Version bump + precache deeplink.js

**Files:** Modify `app/sw.js`, `app/js/config.js`.

- [ ] **Step 1: Bump + precache.** In `app/sw.js`: change `const CACHE = "lagoon-v55";` → `"lagoon-v56";`, and add `"./js/deeplink.js"` to the `ASSETS` array (append to the line listing the other `./js/*.js` modules).

- [ ] **Step 2: Bump APP_RELEASE.** In `app/js/config.js`: `APP_RELEASE = "v55"` → `"v56"`.

- [ ] **Step 3: Verify.** `node --check app/sw.js` → 0; `cd app && node -e "import('./js/config.js').then(m=>console.log(m.APP_RELEASE))"` → `v56`.

- [ ] **Step 4: Commit.**
```bash
cd /Users/davidsmith/Development/lagoon && git add app/sw.js app/js/config.js && git commit -m "chore(push): precache deeplink.js; bump v56"
```

---

## Task 8: Full suite + build + deploy/device (ops)

**Files:** none (verification).

- [ ] **Step 1: All suites.**
```bash
cd /Users/davidsmith/Development/lagoon
node --test app/test/*.test.js
PYTHONPATH="$PWD" /opt/homebrew/bin/python3 -m pytest aws/lambda/test_push.py aws/lambda/test_notify_filter.py -q
/opt/homebrew/bin/python3 -m pytest aws/lambda-register/test_register.py -q
/opt/homebrew/bin/python3 -m unittest discover -s tests -p "test_*.py"
```
Expected: all green (JS gains deeplink tests; watcher gains build_payload target tests).

- [ ] **Step 2: PR + merge** (branch → PR → CI → squash-merge), per the PR-only workflow.

- [ ] **Step 3: Deploy the Lambda** (USER runs; `cdk deploy` classifier-blocked): `cd aws/cdk && npm run deploy` (rebuilds the watcher asset with the new `build_payload`). No IAM change, so no approval prompt.

- [ ] **Step 4: Deploy the client:** `gh workflow run "Deploy Hugo Site (AWS)" -R davidfsmith/daves-adventures`; verify `curl …/sw.js | grep CACHE` → `lagoon-v56`.

- [ ] **Step 5: Device test.** Force a send (see [[lagoon-push-infra]]); on the phone:
  - **App open:** tap the notification → jumps to the freed slot's **Day view**, scrolled to + highlighting it.
  - **App closed:** tap → cold-opens, loads, lands on the same Day view.
  - **iOS guidance:** (best-effort) in a non-installed Safari context, the Settings Notifications section shows the add-to-home-screen steps instead of the toggle.
  - **Intro slide:** Settings → Replay intro → the 🔔 Notifications slide appears (internal user).

---

## Self-Review notes (author)

- **Spec coverage:** deep-link payload target (T1) · cold-open parse (T2) · SW routing (T3) · app message+boot (T4) · iOS guidance (T5) · gated slide, no VERSION bump (T6) · v56 + precache (T7). day.js untouched (reused). Flag stays `internal` (no FEATURES change anywhere).
- **Type consistency:** payload keys `date`/`key` (T1) are read by sw.js `push`/`notificationclick` (T3), forwarded as `{type:"open-day", date, key}` to app.js (T4) and as `#day/<date>/<key>` parsed by `parseDayHash` (T2) → both call `go("day", {date, key})`, matching `renderDay`'s existing `{date, key}` arg. `_rec` now provides `key`+`start` used by `build_payload` and consistent with `release_record`'s real output (`key`, `start`, `startLondon`).
- **Regression guard:** existing `build_payload` body tests don't assert on the new `date`/`key` keys, so they stay green; older payloads without date/key fall back to focus/open-root in the SW.
- **Non-testable-by-unit** (browser APIs): SW handlers, app message/boot wiring, iOS detection, intro gating → covered by `node --check` + on-device (Step 5).
