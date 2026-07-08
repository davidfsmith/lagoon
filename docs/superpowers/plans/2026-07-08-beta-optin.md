# Beta opt-in (two-level) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hard-coded beta allowlist with two client-side opt-in levels (hidden `internal` + public `beta`) and build the Settings UI, badges, and gesture that drive them.

**Architecture:** Two `localStorage` flags (`lagoon.internalOptIn`, `lagoon.betaOptIn`) owned by `store.js`. `features.js` reads them to decide feature tiers (`internal` ⊇ `beta` ⊇ `on`), with no `state`/allowlist. `settings.js` renders a public Beta toggle, a hidden Developer section (revealed by a 7-tap gesture on the version row), and a `DEV`/`BETA` badge.

**Tech Stack:** Vanilla ES modules, no build, no deps. Tests via Node's built-in runner (`node --test`), fully mocked. Spec: `docs/superpowers/specs/2026-07-08-beta-optin-design.md`.

---

## File structure

- `app/js/store.js` — **modify**: add `get/setBetaOptIn`, `get/setInternalOptIn`.
- `app/js/config.js` — **modify**: remove `BETA_TESTERS`, update `FEATURES` comment, bump `APP_RELEASE`.
- `app/js/features.js` — **modify (rewrite)**: two-level gating, drop allowlist + `state`, add `accessTier`.
- `app/js/views/settings.js` — **modify**: Beta toggle, Developer section, version-tap gesture, badge, switch CSS.
- `app/sw.js` — **modify**: bump `CACHE`.
- `app/test/store.test.js` — **modify**: flag round-trip tests.
- `app/test/features.test.js` — **modify (rewrite)**: two-flag gating tests.

Run the whole suite with: `node --test app/test/*.test.js` (from repo root).

---

## Task 1: `store.js` — beta + internal flags

**Files:**
- Modify: `app/js/store.js` (append at end)
- Test: `app/test/store.test.js`

- [ ] **Step 1: Add the failing tests**

In `app/test/store.test.js`, extend the destructured dynamic import (currently lines 13-19) to also pull in the new functions:

```js
const {
  getToken, setToken, clearToken,
  saveCache, loadCache,
  getDefaultLanding, setDefaultLanding,
  getLastMinuteWindow, setLastMinuteWindow,
  LANDING_OPTIONS,
  getBetaOptIn, setBetaOptIn,
  getInternalOptIn, setInternalOptIn,
} = await import("../js/store.js");
```

Then append these tests to the end of the file:

```js
// --- beta / internal opt-in flags ---

test("beta opt-in round-trips (default off)", () => {
  mem.clear();
  assert.equal(getBetaOptIn(), false);
  setBetaOptIn(true);
  assert.equal(getBetaOptIn(), true);
  setBetaOptIn(false);
  assert.equal(getBetaOptIn(), false);
});

test("internal opt-in round-trips (default off)", () => {
  mem.clear();
  assert.equal(getInternalOptIn(), false);
  setInternalOptIn(true);
  assert.equal(getInternalOptIn(), true);
  setInternalOptIn(false);
  assert.equal(getInternalOptIn(), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test app/test/store.test.js`
Expected: FAIL — `setBetaOptIn is not a function` (functions not exported yet).

- [ ] **Step 3: Implement the flags**

Append to the end of `app/js/store.js`:

```js
// Beta opt-in: the public "try in-progress features" toggle (Settings). Soft,
// client-side — see features.js. Stored "1"/"0"; any non-"1" reads as off.
const BETA_OPTIN_KEY = "lagoon.betaOptIn";
export function getBetaOptIn() {
  try { return localStorage.getItem(BETA_OPTIN_KEY) === "1"; } catch { return false; }
}
export function setBetaOptIn(on) {
  try { localStorage.setItem(BETA_OPTIN_KEY, on ? "1" : "0"); } catch {}
}

// Internal opt-in: the hidden developer level (revealed by the version-tap gesture),
// for features that are still being built. Superset of beta — see features.js.
const INTERNAL_OPTIN_KEY = "lagoon.internalOptIn";
export function getInternalOptIn() {
  try { return localStorage.getItem(INTERNAL_OPTIN_KEY) === "1"; } catch { return false; }
}
export function setInternalOptIn(on) {
  try { localStorage.setItem(INTERNAL_OPTIN_KEY, on ? "1" : "0"); } catch {}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test app/test/store.test.js`
Expected: PASS (all store tests).

- [ ] **Step 5: Commit**

```bash
git add app/js/store.js app/test/store.test.js
git commit -m "feat(app): store beta + internal opt-in flags"
```

---

## Task 2: `features.js` + `config.js` — two-level gating, no allowlist

**Files:**
- Modify: `app/js/features.js` (full rewrite)
- Modify: `app/js/config.js:21-29` (remove `BETA_TESTERS`, update `FEATURES` comment)
- Test: `app/test/features.test.js` (full rewrite)

- [ ] **Step 1: Rewrite the tests (failing)**

Replace the entire contents of `app/test/features.test.js` with:

```js
import { test } from "node:test";
import assert from "node:assert/strict";

// node has no localStorage — back it with a Map (same pattern as store.test.js).
// features.js/store.js touch it only at call time, so the dynamic imports are safe.
const mem = new Map();
global.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { tierAllows, isOn, isBetaUser, accessTier } = await import("../js/features.js");
const { setBetaOptIn, setInternalOptIn } = await import("../js/store.js");

test("no opt-in: only 'on' is visible", () => {
  mem.clear();
  assert.equal(tierAllows("on"), true);
  assert.equal(tierAllows("beta"), false);
  assert.equal(tierAllows("internal"), false);
  assert.equal(tierAllows("off"), false);
  assert.equal(tierAllows(undefined), false); // unknown tier → off
  assert.equal(isBetaUser(), false);
  assert.equal(accessTier(), null);
});

test("beta opt-in unlocks beta but not internal", () => {
  mem.clear();
  setBetaOptIn(true);
  assert.equal(tierAllows("beta"), true);
  assert.equal(tierAllows("internal"), false);
  assert.equal(isBetaUser(), true);
  assert.equal(accessTier(), "beta");
});

test("internal opt-in unlocks internal and beta (superset)", () => {
  mem.clear();
  setInternalOptIn(true);
  assert.equal(tierAllows("internal"), true);
  assert.equal(tierAllows("beta"), true);
  assert.equal(isBetaUser(), true);
  assert.equal(accessTier(), "internal");
});

test("internal wins the badge even when both flags are set", () => {
  mem.clear();
  setBetaOptIn(true);
  setInternalOptIn(true);
  assert.equal(accessTier(), "internal");
});

test("isOn maps an undefined flag to off", () => {
  mem.clear();
  assert.equal(isOn("doesNotExist"), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test app/test/features.test.js`
Expected: FAIL — `accessTier` is not exported yet / `tierAllows` still expects the old allowlist behaviour.

- [ ] **Step 3: Update `config.js` (remove the allowlist)**

In `app/js/config.js`, replace lines 21-29:

```js
// Beta access: Lagoon user IDs that see in-flight (internal/beta) features.
export const BETA_TESTERS = [9720]; // Dave
// Feature flags → audience tier: "off" | "internal" | "beta" | "on".
//   internal = BETA_TESTERS only · beta = BETA_TESTERS or opted-in · on = everyone.
// Wrap a feature's UI in isOn("flagName", state); promote the tier, then delete the
// flag once it's stable. NOTE: client-side soft gate — code still ships to everyone.
export const FEATURES = {
  // example: newAvailabilityChart: "internal",
};
```

with:

```js
// Feature flags → audience tier: "off" | "internal" | "beta" | "on".
//   internal = developer opt-in (hidden) · beta = internal or beta opt-in · on = everyone.
// Wrap a feature's UI in isOn("flagName"); promote the tier, then delete the flag once
// it's stable. NOTE: client-side soft gate — code still ships to everyone.
export const FEATURES = {
  // example: newAvailabilityChart: "internal",
};
```

- [ ] **Step 4: Rewrite `features.js`**

Replace the entire contents of `app/js/features.js` with:

```js
// Feature gating for in-flight work. Soft, client-side: this controls what's shown by
// default, not security — the code still ships to everyone. Gate a feature with
// isOn("flagName"); flags live in config.js. Two opt-in levels (both localStorage):
//   internal = developer opt-in (hidden, version-tap) — features mid-build
//   beta     = public opt-in (Settings toggle) — features that work but aren't GA
// internal sees everything beta does.
import { FEATURES } from "./config.js";
import { getBetaOptIn, getInternalOptIn } from "./store.js";

// Whether an audience tier is allowed for this user. Exported for testing.
export function tierAllows(tier) {
  switch (tier) {
    case "on": return true;
    case "beta": return getBetaOptIn() || getInternalOptIn();
    case "internal": return getInternalOptIn();
    default: return false; // "off", undefined, or unknown → safe default
  }
}

// Is a given feature flag enabled for this user?
export function isOn(flag) {
  return tierAllows(FEATURES[flag]);
}

// Does this user have any beta access at all?
export function isBetaUser() {
  return getBetaOptIn() || getInternalOptIn();
}

// Highest active level, for the badge: "internal" | "beta" | null.
export function accessTier() {
  if (getInternalOptIn()) return "internal";
  if (getBetaOptIn()) return "beta";
  return null;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test app/test/features.test.js`
Expected: PASS.

- [ ] **Step 6: Run the full suite (nothing else broke)**

Run: `node --test app/test/*.test.js`
Expected: PASS. (Confirms no other module imported `BETA_TESTERS`.)

- [ ] **Step 7: Commit**

```bash
git add app/js/features.js app/js/config.js app/test/features.test.js
git commit -m "feat(app): two-level feature gating (internal + beta), drop allowlist"
```

---

## Task 3: `settings.js` — Beta toggle, Developer section, gesture, badge

**Files:**
- Modify: `app/js/views/settings.js`

This view is not unit-tested (like the other views); verify by running the suite (imports resolve) and serving the app locally.

- [ ] **Step 1: Update imports**

In `app/js/views/settings.js`, replace these two import lines:

```js
import { getReminderMinutes, setReminderMinutes, REMINDER_OPTIONS, getDefaultLanding, setDefaultLanding, LANDING_OPTIONS } from "../store.js";
import { isBetaUser } from "../features.js";
```

with:

```js
import { getReminderMinutes, setReminderMinutes, REMINDER_OPTIONS, getDefaultLanding, setDefaultLanding, LANDING_OPTIONS, getBetaOptIn, setBetaOptIn, getInternalOptIn, setInternalOptIn } from "../store.js";
import { accessTier } from "../features.js";
```

- [ ] **Step 2: Add the tap counter + helpers**

Replace this line:

```js
let activeTab = "settings";
```

with:

```js
let activeTab = "settings";
let devTaps = 0; // version-row taps this session; 7 reveals the Developer section

// Badge for the current access level (DEV outranks BETA).
function badgeHtml() {
  const t = accessTier();
  if (t === "internal") return ' <span class="dev-badge">DEV</span>';
  if (t === "beta") return ' <span class="beta-badge">BETA</span>';
  return "";
}
// A themed on/off toggle switch (checkbox styled via .switch CSS).
function switchHtml(id, on) {
  return `<label class="switch"><input type="checkbox" id="${id}"${on ? " checked" : ""}><span class="slider"></span></label>`;
}
```

- [ ] **Step 3: Add the Beta + Developer sections to the Settings tab**

In `settingsTab`, find the Calendar block:

```js
    <div class="t" style="margin-top:18px">Calendar</div>
    <div class="set-row"><span>Default reminder time</span>
      <select id="reminder" class="set-select">
        ${REMINDER_OPTIONS.map(m => `<option value="${m}"${m === getReminderMinutes() ? " selected" : ""}>${m} min</option>`).join("")}
      </select></div>
```

Immediately after it (before the `${state ? ...Data...` block), insert:

```js
    <div class="t" style="margin-top:18px">Beta</div>
    <div class="set-row"><span>Beta features</span>${switchHtml("beta-toggle", getBetaOptIn())}</div>
    <div class="set-cap">Try in-progress features early. They may be rough or change.</div>

    ${getInternalOptIn() ? `<div class="t" style="margin-top:18px">Developer</div>
    <div class="set-row"><span>Internal features</span>${switchHtml("internal-toggle", true)}</div>
    <div class="set-cap">Unreleased, in-progress features. Expect breakage. Includes beta features.</div>` : ""}
```

- [ ] **Step 4: Update the About version row (badge + gesture target)**

In `aboutTab`, replace:

```js
    <div class="set-row"><span>Hove Lagoon${isBetaUser(state) ? ' <span class="beta-badge">BETA</span>' : ""}</span><span class="about-ver">
```

with:

```js
    <div class="set-row" id="ver-row"><span>Hove Lagoon${badgeHtml()}</span><span class="about-ver">
```

- [ ] **Step 5: Wire the toggles + gesture**

In `renderSettings`, find this line:

```js
  injectTabStyles();
```

Immediately before it, insert:

```js
  const bt = view.querySelector("#beta-toggle");
  if (bt) bt.addEventListener("change", () => { setBetaOptIn(bt.checked); renderSettings(view, state, go); });
  const it = view.querySelector("#internal-toggle");
  if (it) it.addEventListener("change", () => { setInternalOptIn(it.checked); renderSettings(view, state, go); });
  const ver = view.querySelector("#ver-row");
  if (ver) ver.addEventListener("click", () => {
    if (getInternalOptIn()) return;            // already unlocked
    if (++devTaps >= 7) { devTaps = 0; setInternalOptIn(true); renderSettings(view, state, go); }
  });
```

- [ ] **Step 6: Add the switch + badge CSS**

In `injectSettingsStyles`, find the end of the `.beta-badge{...}` rule (the last rule before the closing `` ` ``):

```js
    .beta-badge{background:var(--accent);color:var(--accent-ink);font-size:9px;font-weight:700;
      letter-spacing:.05em;padding:2px 6px;border-radius:5px;vertical-align:middle;margin-left:6px}`;
```

Replace it with (same `.beta-badge` rule, then the new rules appended before the closing `` ` ``):

```js
    .beta-badge{background:var(--accent);color:var(--accent-ink);font-size:9px;font-weight:700;
      letter-spacing:.05em;padding:2px 6px;border-radius:5px;vertical-align:middle;margin-left:6px}
    .dev-badge{background:#b7791f;color:#fff;font-size:9px;font-weight:700;
      letter-spacing:.05em;padding:2px 6px;border-radius:5px;vertical-align:middle;margin-left:6px}
    .set-cap{font-size:12px;color:var(--muted);margin:6px 2px 0;line-height:1.4}
    .switch{position:relative;display:inline-block;width:42px;height:24px;flex:none}
    .switch input{opacity:0;width:0;height:0}
    .slider{position:absolute;inset:0;background:var(--border);border-radius:24px;cursor:pointer;transition:background .15s}
    .slider::before{content:"";position:absolute;height:18px;width:18px;left:3px;top:3px;background:#fff;border-radius:50%;transition:transform .15s}
    .switch input:checked+.slider{background:var(--accent)}
    .switch input:checked+.slider::before{transform:translateX(18px)}`;
```

- [ ] **Step 7: Verify the suite still passes (imports resolve)**

Run: `node --test app/test/*.test.js`
Expected: PASS.

- [ ] **Step 8: Manual check in the browser**

Run: `cd app && python3 -m http.server 8000` then open `http://localhost:8000`.
Verify:
- Settings tab shows a **Beta features** toggle. Flip it on → About tab version row shows a **BETA** badge; flip off → badge gone.
- About tab: tap the version row 7 times → a **Developer** section appears in the Settings tab with an **Internal features** toggle (on), and the version badge becomes **DEV** (amber).
- Turn the Internal toggle off → Developer section disappears; badge falls back to BETA if beta is still on, else none.
- Toggle switches theme correctly in light and dark mode.

- [ ] **Step 9: Commit**

```bash
git add app/js/views/settings.js
git commit -m "feat(app): Beta opt-in toggle, hidden Developer section + DEV/BETA badge"
```

---

## Task 4: Version bump (cached-code rule)

**Files:**
- Modify: `app/js/config.js:33`
- Modify: `app/sw.js:1`

- [ ] **Step 1: Bump `APP_RELEASE`**

In `app/js/config.js`, change:

```js
export const APP_RELEASE = "v47"; // release/version — bump together with sw.js CACHE
```

to:

```js
export const APP_RELEASE = "v48"; // release/version — bump together with sw.js CACHE
```

- [ ] **Step 2: Bump the service-worker CACHE**

In `app/sw.js`, change:

```js
const CACHE = "lagoon-v47";
```

to:

```js
const CACHE = "lagoon-v48";
```

(No new files were added, so the `ASSETS` list is unchanged.)

- [ ] **Step 3: Verify the versions match**

Run: `grep -n "v48\|lagoon-v48" app/js/config.js app/sw.js`
Expected: one match in each file (`APP_RELEASE = "v48"` and `const CACHE = "lagoon-v48"`).

- [ ] **Step 4: Commit**

```bash
git add app/js/config.js app/sw.js
git commit -m "chore(app): bump to v48 for the beta opt-in change"
```

---

## Final verification

- [ ] Run the full suite once more: `node --test app/test/*.test.js` → all PASS.
- [ ] `git log --oneline -4` shows the four task commits.
- [ ] Open a PR against `main` (protected branch; direct pushes are blocked). CI runs the offline tests.
