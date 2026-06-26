# Last-Minute Availability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a beta-gated `🔥 Last-minute` tab (Today/Weekend/48h window, "just opened ↑" badges) plus a configurable Default-page setting, surfacing short-notice / just-freed wakeboarding sessions — all client-side.

**Architecture:** Two new pure helpers in `model.js` (`justOpenedKeys`, `sessionsInWindow`) do the diffing/windowing and are unit-tested offline. A new view `views/lastminute.js` renders them, reusing the shared `filters.js` chips and the day-view row styling. `store.js` gains landing + window persistence (unit-tested with a `localStorage` stub). `app.js` wires the route, reveals the gated nav button, sets its 🔥/🌊 icon, computes the just-opened diff from the previous cache snapshot, and resolves the configurable default landing. Everything keys off the existing `isOn("lastMinute", state)` flag, so non-gated users see no change.

**Tech Stack:** Vanilla JS ES modules, no build, no deps. Tests via `node --test` (fully mocked/offline). PWA service worker with a precache list + version stamp.

**Spec:** `docs/superpowers/specs/2026-06-26-last-minute-availability-design.md`

**Branch:** `feat/last-minute-availability` (already checked out).

**Conventions to follow (from `app/CLAUDE.md`):**
- Vanilla JS, ES modules, no deps. Match surrounding style; terse "why" comments.
- **Times: only ever convert via `tz.js` `londonParts`** — the API serialises BST as `+00:00`; reading raw hours lands sessions an hour early.
- The version bump (`APP_RELEASE` + `sw.js` `CACHE` + new asset in `ASSETS`) is done **once at the end** (Task 7), kept in lock-step.

---

## File Structure

| File | Responsibility | New? |
|---|---|---|
| `app/js/model.js` | + `justOpenedKeys`, `sessionsInWindow` (pure diff/window logic) | modify |
| `app/test/model.test.js` | + tests for the two new helpers | modify |
| `app/js/store.js` | + `LANDING_OPTIONS`/`getDefaultLanding`/`setDefaultLanding`, `getLastMinuteWindow`/`setLastMinuteWindow` | modify |
| `app/test/store.test.js` | unit tests for the new store helpers (localStorage stub) | **create** |
| `app/js/config.js` | + `FEATURES.lastMinute`; bump `APP_RELEASE` (Task 7) | modify |
| `app/js/views/lastminute.js` | the Last-minute screen | **create** |
| `app/js/app.js` | route + gated nav reveal + 🔥/🌊 icon + just-opened diff + default landing | modify |
| `app/index.html` | hidden Last-minute nav button with `.nav-emoji` span | modify |
| `app/js/views/settings.js` | "Default page" dropdown | modify |
| `app/sw.js` | add new view to `ASSETS`; bump `CACHE` (Task 7) | modify |

---

## Task 1: `justOpenedKeys` (model helper)

**Files:**
- Modify: `app/js/model.js` (add export at end)
- Test: `app/test/model.test.js` (add cases)

- [ ] **Step 1: Write the failing tests**

Add to `app/test/model.test.js`. First extend the import on line 3 to include `justOpenedKeys` (and `sessionsInWindow`, used in Task 2):

```js
import { runsToSlots, slotKey, bookingKeys, activeParticipants, bookingIsHeld, countsTowardLimit, markBooked, membershipFreeCourseIds, applyMembershipFree, groupByDay, justOpenedKeys, sessionsInWindow } from "../js/model.js";
```

Then append:

```js
test("justOpenedKeys flags newly-present and free-risen slots, ignores unchanged/dropped", () => {
  const prev = [{ slots: [
    { key: "a", free: 1 }, // unchanged
    { key: "b", free: 2 }, // will drop
    { key: "c", free: 1 }, // will rise
  ] }];
  const cur = [{ slots: [
    { key: "a", free: 1 }, // unchanged -> not flagged
    { key: "b", free: 1 }, // dropped   -> not flagged
    { key: "c", free: 2 }, // rose      -> flagged
    { key: "d", free: 1 }, // new        -> flagged (was full/absent)
  ] }];
  assert.deepEqual([...justOpenedKeys(prev, cur)].sort(), ["c", "d"]);
});

test("justOpenedKeys returns empty when there is no previous snapshot", () => {
  const cur = [{ slots: [{ key: "a", free: 1 }] }];
  assert.equal(justOpenedKeys(null, cur).size, 0);
});

test("justOpenedKeys returns empty for identical agendas", () => {
  const a = [{ slots: [{ key: "a", free: 1 }, { key: "b", free: 3 }] }];
  assert.equal(justOpenedKeys(a, a).size, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test app/test/model.test.js`
Expected: FAIL — `justOpenedKeys is not a function` (and `sessionsInWindow` import is `undefined`, which is fine for now).

- [ ] **Step 3: Implement `justOpenedKeys`**

Append to `app/js/model.js`:

```js
// Slots that newly freed up since the previous snapshot: present now AND either
// absent before (was full — i.e. a cancellation, since the agenda only ever holds
// free>0 slots) or with a higher free count than before (one of several spots
// freed). Pure diff of two agendas ([{ slots:[{ key, free }] }]); prevAgenda may be
// null on the first ever load -> empty result.
// NOTE: this only sees changes between the user's OWN loads/refreshes. Detecting
// opens while the app is closed is Phase 2 (AWS watcher + Web Push) — not a bug.
export function justOpenedKeys(prevAgenda, curAgenda) {
  const prev = new Map();
  for (const d of prevAgenda || []) for (const s of d.slots || []) prev.set(s.key, s.free);
  const out = new Set();
  for (const d of curAgenda || []) for (const s of d.slots || []) {
    if (!prev.has(s.key) || s.free > prev.get(s.key)) out.add(s.key);
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test app/test/model.test.js`
Expected: PASS for the three `justOpenedKeys` tests. (Tasks referencing `sessionsInWindow` come next.)

- [ ] **Step 5: Commit**

```bash
git add app/js/model.js app/test/model.test.js
git commit -m "feat: justOpenedKeys — diff agendas for newly-freed slots"
```

---

## Task 2: `sessionsInWindow` (model helper)

**Files:**
- Modify: `app/js/model.js` (add export + two small private helpers)
- Test: `app/test/model.test.js` (add cases)

- [ ] **Step 1: Write the failing tests**

Append to `app/test/model.test.js`:

```js
// Helper to build a one-slot day list keyed by start time.
const slot = (start, extra = {}) => ({ start, key: start, free: 1, label: "Air 30", ...extra });
const agendaOf = (...starts) => [{ slots: starts.map(s => slot(s)) }];

test("sessionsInWindow 'today' keeps same-London-date future slots only", () => {
  const now = new Date("2026-06-25T09:00:00+00:00"); // Thu 10:00 BST -> London 2026-06-25
  const agenda = agendaOf(
    "2026-06-25T08:00:00+00:00", // already started -> excluded
    "2026-06-25T16:00:00+00:00", // today, future   -> included
    "2026-06-25T23:30:00+00:00", // 00:30 BST next day -> London 2026-06-26 -> excluded
    "2026-06-26T16:00:00+00:00", // tomorrow         -> excluded
  );
  const out = sessionsInWindow(agenda, "today", now);
  assert.deepEqual(out.map(s => s.start), ["2026-06-25T16:00:00+00:00"]);
});

test("sessionsInWindow '48h' includes slots within 48h, excludes beyond", () => {
  const now = new Date("2026-06-25T09:00:00+00:00"); // +48h = 2026-06-27T09:00Z
  const agenda = agendaOf(
    "2026-06-26T16:00:00+00:00", // within 48h -> included
    "2026-06-27T08:59:00+00:00", // just within -> included
    "2026-06-27T11:00:00+00:00", // beyond 48h  -> excluded
  );
  const out = sessionsInWindow(agenda, "48h", now);
  assert.deepEqual(out.map(s => s.start),
    ["2026-06-26T16:00:00+00:00", "2026-06-27T08:59:00+00:00"]);
});

test("sessionsInWindow 'weekend' from a weekday = the coming Sat+Sun only", () => {
  const now = new Date("2026-06-25T09:00:00+00:00"); // Thursday
  const agenda = agendaOf(
    "2026-06-26T16:00:00+00:00", // Fri        -> excluded
    "2026-06-27T11:00:00+00:00", // Sat        -> included
    "2026-06-28T11:00:00+00:00", // Sun        -> included
    "2026-07-04T11:00:00+00:00", // next Sat   -> excluded
  );
  const out = sessionsInWindow(agenda, "weekend", now);
  assert.deepEqual(out.map(s => s.start),
    ["2026-06-27T11:00:00+00:00", "2026-06-28T11:00:00+00:00"]);
});

test("sessionsInWindow 'weekend' from a Saturday keeps the rest of this weekend", () => {
  const now = new Date("2026-06-27T08:00:00+00:00"); // Sat 09:00 BST
  const agenda = agendaOf(
    "2026-06-27T07:00:00+00:00", // earlier Sat -> already started -> excluded
    "2026-06-27T14:00:00+00:00", // Sat future  -> included
    "2026-06-28T11:00:00+00:00", // Sun         -> included
    "2026-07-04T11:00:00+00:00", // next Sat    -> excluded
  );
  const out = sessionsInWindow(agenda, "weekend", now);
  assert.deepEqual(out.map(s => s.start),
    ["2026-06-27T14:00:00+00:00", "2026-06-28T11:00:00+00:00"]);
});

test("sessionsInWindow sorts soonest-first and drops full slots", () => {
  const now = new Date("2026-06-25T09:00:00+00:00");
  const agenda = [{ slots: [
    slot("2026-06-25T18:00:00+00:00"),
    slot("2026-06-25T16:00:00+00:00"),
    slot("2026-06-25T17:00:00+00:00", { free: 0 }), // full -> excluded
  ] }];
  const out = sessionsInWindow(agenda, "today", now);
  assert.deepEqual(out.map(s => s.start),
    ["2026-06-25T16:00:00+00:00", "2026-06-25T18:00:00+00:00"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test app/test/model.test.js`
Expected: FAIL — `sessionsInWindow is not a function`.

- [ ] **Step 3: Implement `sessionsInWindow` (+ two private helpers)**

Append to `app/js/model.js`. `londonParts` is already imported at the top of the file.

```js
// London day-of-week (0=Sun..6=Sat) for a UTC ISO timestamp. Noon-local avoids any
// tz date-shift when reading the day back (same trick as groupByDay).
function londonDow(iso) {
  return new Date(londonParts(iso).date + "T12:00:00").getDay();
}

// The two calendar dates ("YYYY-MM-DD") of the coming weekend, in Europe/London.
// From a weekday: the upcoming Sat+Sun. From Sat/Sun: that same weekend (Sat+Sun).
function comingWeekendDates(now) {
  const base = new Date(londonParts(now).date + "T12:00:00"); // local noon, dow-safe
  const dow = base.getDay();                  // 0 Sun .. 6 Sat
  const toSat = dow === 0 ? -1 : 6 - dow;      // Sunday: Saturday was yesterday
  const sat = new Date(base.getTime() + toSat * 86400000);
  const sun = new Date(sat.getTime() + 86400000);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return new Set([fmt(sat), fmt(sun)]);
}

// Free, not-yet-started sessions within a short-notice window, soonest first.
// window: "today" | "weekend" | "48h". All dates compared in Europe/London (never
// raw UTC hours). `now` is a Date.
export function sessionsInWindow(agenda, window, now) {
  const nowMs = now.getTime();
  const soon = (agenda || []).flatMap(d => d.slots || [])
    .filter(s => s.free > 0 && new Date(s.start).getTime() > nowMs);
  let inWindow;
  if (window === "weekend") {
    const wknd = comingWeekendDates(now);
    inWindow = (s) => (londonDow(s.start) === 0 || londonDow(s.start) === 6) && wknd.has(londonParts(s.start).date);
  } else if (window === "48h") {
    const limit = nowMs + 48 * 3600000;
    inWindow = (s) => new Date(s.start).getTime() <= limit;
  } else { // "today"
    const today = londonParts(now).date;
    inWindow = (s) => londonParts(s.start).date === today;
  }
  return soon.filter(inWindow).sort((a, b) => (a.start < b.start ? -1 : 1));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test app/test/model.test.js`
Expected: PASS — all model tests (existing + the new `justOpenedKeys` and `sessionsInWindow` cases).

- [ ] **Step 5: Commit**

```bash
git add app/js/model.js app/test/model.test.js
git commit -m "feat: sessionsInWindow — Today/Weekend/48h slot windowing"
```

---

## Task 3: feature flag + store helpers (landing + window)

**Files:**
- Modify: `app/js/config.js:27-29` (add the flag)
- Modify: `app/js/store.js` (add helpers + import)
- Test: `app/test/store.test.js` (create)

- [ ] **Step 1: Add the feature flag**

In `app/js/config.js`, replace the empty `FEATURES` object (lines 27-29):

```js
export const FEATURES = {
  lastMinute: "internal", // 🔥 Last-minute tab + just-opened + default-page choice (Dave only for now)
};
```

- [ ] **Step 2: Write the failing tests**

Create `app/test/store.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";

// node has no localStorage — back it with a Map. store.js/features.js touch it only
// at call time (not module-eval), so a static import below is safe.
const mem = new Map();
global.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { getDefaultLanding, setDefaultLanding, getLastMinuteWindow, setLastMinuteWindow, LANDING_OPTIONS } =
  await import("../js/store.js");

const gated = { me: { id: 9720 } }; // on BETA_TESTERS
const other = { me: { id: 111 } };  // not

test("LANDING_OPTIONS lists the three pages", () => {
  assert.deepEqual(LANDING_OPTIONS.map(o => o.id), ["lastminute", "agenda", "account"]);
});

test("getDefaultLanding default: lastminute for gated, agenda for others", () => {
  mem.clear();
  assert.equal(getDefaultLanding(gated), "lastminute");
  assert.equal(getDefaultLanding(other), "agenda");
});

test("getDefaultLanding returns a valid stored choice for anyone", () => {
  mem.clear();
  setDefaultLanding("account");
  assert.equal(getDefaultLanding(gated), "account");
  assert.equal(getDefaultLanding(other), "account");
});

test("a stored 'lastminute' degrades to agenda for a non-gated user", () => {
  mem.clear();
  setDefaultLanding("lastminute");
  assert.equal(getDefaultLanding(gated), "lastminute");
  assert.equal(getDefaultLanding(other), "agenda");
});

test("an invalid stored landing falls back per gating", () => {
  mem.clear();
  setDefaultLanding("bogus");
  assert.equal(getDefaultLanding(gated), "lastminute");
  assert.equal(getDefaultLanding(other), "agenda");
});

test("getLastMinuteWindow defaults to today and persists valid values only", () => {
  mem.clear();
  assert.equal(getLastMinuteWindow(), "today");
  setLastMinuteWindow("weekend");
  assert.equal(getLastMinuteWindow(), "weekend");
  setLastMinuteWindow("bogus");
  assert.equal(getLastMinuteWindow(), "today");
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test app/test/store.test.js`
Expected: FAIL — `getDefaultLanding`/`getLastMinuteWindow` are `undefined` (not yet exported).

- [ ] **Step 4: Implement the store helpers**

In `app/js/store.js`, add the import at the top (after line 2):

```js
import { isOn } from "./features.js";
```

Append at the end of `app/js/store.js`:

```js
// Which screen the app opens on. "lastminute" is offered only to gated users; for
// everyone else (and for a stale "lastminute" read after the flag is turned off) it
// falls back to Availability.
const LANDING_KEY = "lagoon.defaultLanding";
export const LANDING_OPTIONS = [
  { id: "lastminute", label: "Last minute" },
  { id: "agenda", label: "Availability" },
  { id: "account", label: "Bookings" },
];
export function setDefaultLanding(id) { localStorage.setItem(LANDING_KEY, id); }
export function getDefaultLanding(state) {
  const raw = localStorage.getItem(LANDING_KEY);
  const valid = LANDING_OPTIONS.some(o => o.id === raw) && (raw !== "lastminute" || isOn("lastMinute", state));
  if (valid) return raw;
  return isOn("lastMinute", state) ? "lastminute" : "agenda";
}

// Last-minute view's window selector: "today" | "weekend" | "48h" (default today).
const LM_WINDOW_KEY = "lagoon.lastMinuteWindow";
const LM_WINDOWS = ["today", "weekend", "48h"];
export function getLastMinuteWindow() {
  const v = localStorage.getItem(LM_WINDOW_KEY);
  return LM_WINDOWS.includes(v) ? v : "today";
}
export function setLastMinuteWindow(w) { localStorage.setItem(LM_WINDOW_KEY, w); }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test app/test/store.test.js`
Expected: PASS — all six store tests.

- [ ] **Step 6: Run the whole suite (no regressions)**

Run: `node --test app/test/*.test.js`
Expected: PASS — every test file green.

- [ ] **Step 7: Commit**

```bash
git add app/js/config.js app/js/store.js app/test/store.test.js
git commit -m "feat: lastMinute flag + default-landing/window store helpers"
```

---

## Task 4: the Last-minute view

**Files:**
- Create: `app/js/views/lastminute.js`

This view has no DOM unit test (consistent with the codebase — views aren't unit-tested; the logic they rely on is tested in Tasks 1-2). Verify by syntax-check now; full visual verification happens in Task 5 once the route exists.

- [ ] **Step 1: Create the view**

Create `app/js/views/lastminute.js`:

```js
import { wcEmoji, fmtWhen, fmtDate } from "./format.js";
import { londonParts } from "../tz.js";
import { BOOKING_SITE } from "../config.js";
import { presentTypes, getActiveTypes, filterBarHtml, wireFilterChips, injectFilterStyles } from "../filters.js";
import { getLastMinuteWindow, setLastMinuteWindow } from "../store.js";
import { sessionsInWindow } from "../model.js";

const WINDOWS = [
  { id: "today", label: "Today", prose: "today" },
  { id: "weekend", label: "Weekend", prose: "this weekend" },
  { id: "48h", label: "48h", prose: "in the next 48h" },
];

export function renderLastMinute(view, state, go) {
  const win = getLastMinuteWindow();
  const winDef = WINDOWS.find(w => w.id === win) || WINDOWS[0];

  const stale = state.stale
    ? `<div class="stale">Showing saved data from ${fmtWhen(state.refreshedAt)} — couldn't refresh.</div>`
    : "";

  // Same per-type filter as Availability, so the selection is consistent everywhere.
  const present = presentTypes((state.agenda || []).flatMap(d => d.slots));
  const active = getActiveTypes(present);
  const filterBar = filterBarHtml(present, active);

  const justOpened = state.justOpened || new Set();
  const slots = sessionsInWindow(state.agenda, win, new Date()).filter(s => active.has(s.label));

  const seg = WINDOWS.map(w =>
    `<button class="lmseg${w.id === win ? " active" : ""}" data-win="${w.id}">${w.label}</button>`
  ).join("");

  const rows = slots.length ? slots.map(s => {
    const lp = londonParts(s.start);
    const wx = s.weather
      ? `${wcEmoji(s.weather.code)} ${Math.round(s.weather.temp)}° · wind ${Math.round(s.weather.windSpeed)} · rain ${s.weather.precipProb}%`
      : "";
    const opened = justOpened.has(s.key) ? `<span class="lmnew">just opened ↑</span>` : "";
    const right = s.booked
      ? `<span class="tag">✓ You're booked</span>`
      : `<span class="free">${s.free} free</span><a class="bk" target="_blank" rel="noopener" href="${s.runId ? `${BOOKING_SITE}/book?courseRunId=${s.runId}` : BOOKING_SITE}">Book ↗</a>`;
    return `<div class="srow${s.booked ? " booked" : ""}">
      <div><div class="tm">${fmtDate(lp.date)} ${lp.time} <b>${s.label}</b> ${opened}</div>
        <div class="muted small">${wx}</div></div>
      <div class="r">${right}</div></div>`;
  }).join("")
    : `<p class="muted">Nothing free ${winDef.prose} right now — pull to refresh, or browse everything in <button class="linkish" id="lm-toagenda">Availability</button>.</p>`;

  view.innerHTML = `${stale}<h2>🔥 Last-minute</h2>
    <p class="refreshed">Last refreshed ${fmtWhen(state.refreshedAt)}${state.stale ? " (saved)" : ""}</p>
    <div class="lmsegbar">${seg}</div>
    ${filterBar}
    ${rows}`;

  for (const b of view.querySelectorAll(".lmseg")) {
    b.addEventListener("click", () => { setLastMinuteWindow(b.dataset.win); renderLastMinute(view, state, go); });
  }
  const toAgenda = view.querySelector("#lm-toagenda");
  if (toAgenda) toAgenda.addEventListener("click", () => go("agenda"));
  wireFilterChips(view, active, () => renderLastMinute(view, state, go));
  injectFilterStyles();
  injectLastMinuteStyles();
}

function injectLastMinuteStyles() {
  if (document.getElementById("lm-css")) return;
  const s = document.createElement("style"); s.id = "lm-css";
  s.textContent = `
    .refreshed{font-size:12px;color:var(--muted);margin:-6px 0 12px}
    .lmsegbar{display:flex;gap:8px;margin-bottom:12px}
    .lmseg{flex:1;background:var(--surface);border:1px solid var(--border);color:var(--muted);border-radius:10px;padding:9px;font-size:13px;cursor:pointer}
    .lmseg.active{background:var(--accent);color:var(--accent-ink);border-color:var(--accent);font-weight:600}
    .srow{display:flex;justify-content:space-between;align-items:center;background:var(--surface);border-radius:12px;padding:11px 12px;margin-bottom:8px}
    .srow.booked{opacity:.7}
    .tm{font-weight:600}.tm b{color:var(--accent)}
    .r{text-align:right;display:flex;flex-direction:column;gap:4px;align-items:flex-end}
    .free{color:var(--good);font-size:12px}.tag{color:var(--warn);font-size:12px}
    .bk{background:var(--accent);color:var(--accent-ink);border-radius:7px;padding:4px 12px;font-size:12px;font-weight:600;text-decoration:none}
    .small{font-size:11px}
    .lmnew{background:var(--good);color:var(--accent-ink);font-size:10px;font-weight:700;letter-spacing:.03em;padding:2px 7px;border-radius:6px;margin-left:4px;white-space:nowrap}
    .linkish{background:none;border:none;color:var(--accent);font:inherit;cursor:pointer;padding:0;text-decoration:underline}`;
  document.head.appendChild(s);
}
```

- [ ] **Step 2: Syntax-check the new file**

Run: `node --check app/js/views/lastminute.js`
Expected: no output (exit 0).

- [ ] **Step 3: Confirm no test regressions**

Run: `node --test app/test/*.test.js`
Expected: PASS — unchanged green (the view isn't imported by tests yet).

- [ ] **Step 4: Commit**

```bash
git add app/js/views/lastminute.js
git commit -m "feat: Last-minute view (window selector, just-opened badges)"
```

---

## Task 5: routing, gated nav button, 🔥/🌊 icon, just-opened diff, default landing

**Files:**
- Modify: `app/index.html:88-91` (nav)
- Modify: `app/js/app.js`

- [ ] **Step 1: Add the nav button**

In `app/index.html`, replace the `<nav>` block (lines 88-91):

```html
  <nav id="nav" hidden>
    <button data-route="lastminute" hidden><span class="nav-emoji">🔥</span> Last-minute</button>
    <button data-route="agenda" class="active">Availability</button>
    <button data-route="account">Bookings</button>
  </nav>
```

- [ ] **Step 2: Update imports in `app.js`**

In `app/js/app.js`, replace the import block (lines 1-10) so it adds the new imports:

```js
import { getToken, clearToken, saveCache, loadCache, getDefaultLanding } from "./store.js";
import { loadEverything } from "./data.js";
import { renderLogin } from "./views/login.js";
import { renderAgenda } from "./views/agenda.js";
import { renderDay } from "./views/day.js";
import { renderAccount } from "./views/account.js";
import { renderSettings } from "./views/settings.js";
import { renderLastMinute } from "./views/lastminute.js";
import { isOn } from "./features.js";
import { justOpenedKeys, sessionsInWindow } from "./model.js";
import { apply as applyTheme } from "./theme.js";
import { initPullToRefresh } from "./pullToRefresh.js";
import { maybeShowIntro } from "./intro.js";
```

- [ ] **Step 3: Add the `lastminute` route to `go()`**

In `app/js/app.js`, in `go()`, add the `lastminute` branch after the `if (!state) return;` line and before the `agenda` branch (currently line 27):

```js
  if (!state) return;
  if (route === "lastminute") {
    if (!isOn("lastMinute", state)) { go("agenda"); return; } // safe degrade for non-gated
    setActiveNav("lastminute"); renderLastMinute(view, state, go);
  }
  else if (route === "agenda") { setActiveNav("agenda"); renderAgenda(view, state, go); }
```

(Keep the existing `day`/`account` branches as the trailing `else if`s.)

- [ ] **Step 4: Fix the nav click handler for the nested emoji span**

The Last-minute button contains a `<span>`, so `e.target` can be the span (no `data-route`). In `app/js/app.js` replace the nav click listener (currently line 32):

```js
nav.addEventListener("click", (e) => { const b = e.target.closest("button"); const r = b && b.dataset.route; if (r) go(r); });
```

- [ ] **Step 5: Add the post-load helpers (nav reveal + tab icon)**

In `app/js/app.js`, add these two functions just below `setActiveNav` (after line 20):

```js
// After each load, reveal the Last-minute tab only for gated users and set its
// 🔥/🌊 icon. 🔥 = at least one free, not-yet-started session in the next 48h
// (a stable ambient signal, independent of the in-view window selector + filter);
// 🌊 = nothing soon.
function afterLoad() {
  const btn = nav.querySelector('button[data-route="lastminute"]');
  if (!btn) return;
  const gated = isOn("lastMinute", state);
  btn.hidden = !gated;
  if (!gated) return;
  const em = btn.querySelector(".nav-emoji");
  if (em) em.textContent = sessionsInWindow(state.agenda, "48h", new Date()).length > 0 ? "🔥" : "🌊";
}
```

- [ ] **Step 6: Wire the just-opened diff + default landing into `reload()`**

In `app/js/app.js`, replace the whole `reload` function (currently lines 41-56) with:

```js
async function reload(target, showLoading) {
  if (showLoading) view.innerHTML = `<p class="muted">Loading sessions…</p>`;
  const token = getToken();
  try {
    const prev = loadCache();                       // previous snapshot, BEFORE we overwrite it
    const data = await loadEverything(token);
    // Slots that newly freed since our last successful load — drives "just opened ↑".
    // Derived, ephemeral: not persisted to the cache.
    const justOpened = justOpenedKeys(prev && prev.data && prev.data.agenda, data.agenda);
    state = { ...data, stale: false, refreshedAt: Date.now(), justOpened };
    saveCache(data);
    afterLoad();
    go(target ?? getDefaultLanding(state));         // null target -> configurable default page
  } catch (e) {
    if (e.code === 401) { logout(); return; }
    const cached = loadCache();
    if (cached) {
      state = { ...cached.data, stale: true, refreshedAt: cached.at, justOpened: new Set() };
      afterLoad();
      go(target ?? getDefaultLanding(state));
    }
    else if (showLoading) view.innerHTML = `<p class="err">Couldn't load: ${e.message}</p>`;
    // on a pull-to-refresh failure with existing state, keep what's on screen
  }
}
```

- [ ] **Step 7: Land on the configurable default page; keep refresh on the Last-minute tab**

In `app/js/app.js`, change `loadAndRender` (currently line 59) to pass `null` so the landing resolves to the user's choice:

```js
async function loadAndRender() {
  await reload(null, true); // null -> getDefaultLanding (Last-minute for gated, else Availability)
  if (state) maybeShowIntro();
}
```

And in `refresh` (currently line 65) add `lastminute` to the in-place set:

```js
  const target = ["agenda", "account", "lastminute"].includes(currentRoute) ? currentRoute : "agenda";
```

- [ ] **Step 8: Verify no test regressions**

Run: `node --test app/test/*.test.js`
Expected: PASS — all green.

- [ ] **Step 9: Manual smoke test (real Lagoon API)**

```sh
cd app && python3 -m http.server 8000
```
Open `http://localhost:8000`, sign in (id 9720), and confirm:
1. App **lands on `🔥 Last-minute`** (gated default), tab visible first in the nav.
2. Tab emoji is **🔥** if anything's free in the next 48h, **🌊** if not.
3. Window selector **Today / Weekend / 48h** switches the list; **Today** selected by default; choice survives a reload.
4. Filter chips show; toggling a type (e.g. add Air 15) updates the list and stays in sync with Availability.
5. Each row: date+time, type, free count, weather, **Book ↗** opens `booking.lagoon.co.uk/book?courseRunId=…`; booked slots show "✓ You're booked" with no Book link.
6. Empty state copy matches the window word; its "Availability" button navigates to the agenda.
7. **Pull-to-refresh** on Last-minute re-fetches and **stays** on the tab.
8. Availability and Bookings tabs still work unchanged.

Stop the server (Ctrl-C) when done.

- [ ] **Step 10: Commit**

```bash
git add app/index.html app/js/app.js
git commit -m "feat: wire Last-minute route, gated nav 🔥/🌊 icon, just-opened diff, default landing"
```

---

## Task 6: "Default page" setting

**Files:**
- Modify: `app/js/views/settings.js`

- [ ] **Step 1: Add imports**

In `app/js/views/settings.js`, extend the store import (currently line 6) and the features import (currently line 7):

```js
import { getReminderMinutes, setReminderMinutes, REMINDER_OPTIONS, getDefaultLanding, setDefaultLanding, LANDING_OPTIONS } from "../store.js";
import { isBetaUser, isOn } from "../features.js";
```

- [ ] **Step 2: Build the dropdown and insert it under Appearance**

In `app/js/views/settings.js`, inside `renderSettings`, just before `const settingsTab = ...` (currently line 26) add:

```js
  const landing = getDefaultLanding(state);
  const landingOptions = LANDING_OPTIONS
    .filter(o => o.id !== "lastminute" || isOn("lastMinute", state)) // only offer Last minute to gated users
    .map(o => `<option value="${o.id}"${o.id === landing ? " selected" : ""}>${o.label}</option>`).join("");
```

Then in the `settingsTab` template, insert a new block immediately after the Appearance `.segbar` div (between the appearance line and the `Calendar` `<div class="t">`):

```js
    <div class="t" style="margin-top:18px">Default page</div>
    <div class="set-row"><span>Open the app on</span>
      <select id="landing" class="set-select">${landingOptions}</select></div>
```

- [ ] **Step 3: Wire the change handler**

In `app/js/views/settings.js`, after the reminder-select wiring (currently lines 78-79), add:

```js
  const ld = view.querySelector("#landing");
  if (ld) ld.addEventListener("change", () => setDefaultLanding(ld.value));
```

- [ ] **Step 4: Verify no test regressions**

Run: `node --test app/test/*.test.js`
Expected: PASS — all green.

- [ ] **Step 5: Manual check**

```sh
cd app && python3 -m http.server 8000
```
Open `http://localhost:8000`, sign in, open **Settings** (⚙):
1. Under Appearance, a **"Default page"** dropdown shows **Last minute / Availability / Bookings**, with the current default selected.
2. Change it to **Availability**, fully reload the page → the app now lands on Availability.
3. Change it back to **Last minute** → reload → lands on Last-minute.

Stop the server when done.

- [ ] **Step 6: Commit**

```bash
git add app/js/views/settings.js
git commit -m "feat: configurable Default page setting"
```

---

## Task 7: version bump + service-worker precache

**Files:**
- Modify: `app/js/config.js:33` (`APP_RELEASE`)
- Modify: `app/sw.js:1` (`CACHE`) and `app/sw.js:6` (`ASSETS`)

- [ ] **Step 1: Bump `APP_RELEASE`**

In `app/js/config.js`, change line 33:

```js
export const APP_RELEASE = "v40"; // release/version — bump together with sw.js CACHE
```

- [ ] **Step 2: Bump `CACHE` and add the new view to `ASSETS`**

In `app/sw.js`, change line 1:

```js
const CACHE = "lagoon-v40";
```

And add `"./js/views/lastminute.js"` to the `ASSETS` list (the views line, currently line 6):

```js
  "./js/views/login.js", "./js/views/agenda.js", "./js/views/day.js", "./js/views/account.js", "./js/views/format.js", "./js/views/settings.js", "./js/views/lastminute.js"];
```

- [ ] **Step 3: Run the full suite**

Run: `node --test app/test/*.test.js`
Expected: PASS — every test file green.

- [ ] **Step 4: Final smoke test**

```sh
cd app && python3 -m http.server 8000
```
Hard-reload `http://localhost:8000` (clear the old service worker: DevTools → Application → Service Workers → Update/skip waiting). Confirm the app still loads, lands per the Default-page setting, and the Last-minute tab + icon work. Stop the server when done.

- [ ] **Step 5: Commit**

```bash
git add app/js/config.js app/sw.js
git commit -m "chore: bump to v40, precache lastminute.js"
```

---

## Final review

After all tasks: dispatch a final code review over the whole branch diff (`git diff main...HEAD`), then use `superpowers:finishing-a-development-branch` to open the PR (project is PR-only; CI "Unit tests (offline)" must pass to merge).

**Manual deploy note (post-merge):** this repo is the single source; once merged to `main`, the `daves-adventures` "Deploy Hugo Site (AWS)" workflow ships it (stamps `APP_VERSION`). Nothing to do here beyond merging.
