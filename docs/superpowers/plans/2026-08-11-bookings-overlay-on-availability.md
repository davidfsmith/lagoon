# Bookings Overlay on Availability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show every session the whole roster is booked on — including full sessions that today vanish from the free-slot feed — on Availability, Last-minute and Day, with rows that name who's booked.

**Architecture:** Merge held bookings into the agenda once, at build time, via a new pure `mergeBookings` function in `model.js`. It annotates existing free-slot rows the roster is booked on and synthesizes `free: 0` rows for booked sessions that aren't in the feed (full, or a course type we don't fetch). All three views inherit the result from `state.agenda`. Discipline filter, label resolver and the current user's id are **injected** so `mergeBookings` stays pure and unit-testable.

**Tech Stack:** Vanilla JS ES modules, no build, no dependencies. Node's built-in test runner (`node --test`), fully mocked.

## Global Constraints

- **No dependencies, no build, no framework.** Plain `.js` the browser runs as-is.
- **Times only via `tz.js` `londonParts`.** Never read hours off the raw ISO string. (Date-window maths here uses epoch-ms comparisons, which are tz-agnostic and safe.)
- **Version bump:** this change edits cached code but adds **no new files**, so bump `sw.js` `const CACHE = "lagoon-v96"` **and** `js/config.js` `APP_RELEASE = "v96"` together (from v95). `ASSETS` list unchanged.
- **No feature flag** — straight GA change.
- **Match surrounding style:** small focused edits, terse *why* comments.
- **Tests are fully mocked** — inject data / stub `localStorage` with a Map; never hit the network.
- Design reference: `docs/superpowers/specs/2026-08-11-bookings-overlay-on-availability-design.md`.

---

### Task 1: `mergeBookings` pure function in `model.js`

The core. Produces the merged slot list; injected dependencies keep it pure.

**Files:**
- Modify: `app/js/model.js` (add `mergeBookings`; reuses existing `slotKey`, `bookingIsHeld`, `countsTowardLimit`, `activeParticipants`)
- Test: `app/test/model.test.js`

**Interfaces:**
- Consumes: existing exports `slotKey`, `bookingIsHeld`, `countsTowardLimit`, `activeParticipants` (already in `model.js`).
- Produces: `mergeBookings(slots, meBookings, { inDiscipline, labelFor, meId, now, horizonDays }) -> slots`
  - `slots`: array from `runsToSlots` (mutated in place and returned).
  - `meBookings`: raw `/me/bookings` array (whole roster).
  - `inDiscipline`: `(courseId) => boolean` — is this course in the shown discipline.
  - `labelFor`: `(courseId, courseName) => string` — chip label (config label, else `prettyCourse`).
  - `meId`: logged-in contact id (rendered as `"You"`); may be null.
  - `now`: `Date`; `horizonDays`: number (default 21).
  - Each booked slot gains `booked: true` and `riders: string[]` (`"You"` first when present, then other first names, de-duped). Synthesized slots also carry `free: 0, capacity: null, weather: null, freeWithMembership: false`.

- [ ] **Step 1: Write the failing tests**

Add to `app/test/model.test.js` (note the existing file already imports from `../js/model.js` — extend that import line to include `mergeBookings`):

```js
// ---- mergeBookings ----
const mb = (slots, bookings, opts = {}) => mergeBookings(slots, bookings, {
  inDiscipline: () => true,                                  // wake-everything by default
  labelFor: (id, name) => ({ 50: "Tech 30", 51: "Air 30" }[id] || `pretty:${name}`),
  meId: 100, now: new Date("2026-06-14T12:00:00+00:00"), horizonDays: 21, ...opts,
});
const bk = (courseId, startDate, participants, extra = {}) => ({
  status: "confirmed", participants,
  courseRun: { id: 900 + courseId, startDate, endDate: startDate, course: { id: courseId, name: `Course ${courseId}` }, ...extra },
});
const rider = (id, firstName) => ({ id, status: "confirmed", contact: { id, firstName } });

test("mergeBookings annotates an existing free slot the roster is booked on", () => {
  const slots = [{ courseId: 50, label: "Tech 30", key: slotKey(50, "2026-06-20T13:00:00+00:00"), free: 2, booked: false }];
  const out = mb(slots, [bk(50, "2026-06-20T13:00:00+00:00", [rider(100, "Dave")])]);
  assert.equal(out.length, 1);
  assert.equal(out[0].booked, true);
  assert.deepEqual(out[0].riders, ["You"]);
});

test("mergeBookings synthesizes a free:0 row for a full/absent booked session", () => {
  const out = mb([], [bk(66, "2026-06-18T17:00:00+00:00", [rider(100, "Dave")])], { labelFor: () => "Clinic" });
  assert.equal(out.length, 1);
  assert.equal(out[0].free, 0);
  assert.equal(out[0].booked, true);
  assert.equal(out[0].label, "Clinic");
  assert.equal(out[0].key, slotKey(66, "2026-06-18T17:00:00+00:00"));
});

test("mergeBookings labels an untracked course via labelFor fallback", () => {
  const out = mb([], [bk(415, "2026-06-19T10:00:00+00:00", [rider(100, "Dave")])]);
  assert.equal(out[0].label, "pretty:Course 415");
});

test("mergeBookings excludes the wrong discipline", () => {
  const out = mb([], [bk(66, "2026-06-18T17:00:00+00:00", [rider(100, "Dave")])], { inDiscipline: (id) => id === 999 });
  assert.equal(out.length, 0);
});

test("mergeBookings excludes past and beyond-horizon bookings", () => {
  const past = bk(66, "2026-06-10T17:00:00+00:00", [rider(100, "Dave")]);
  const far = bk(66, "2026-09-01T17:00:00+00:00", [rider(100, "Dave")]);
  assert.equal(mb([], [past, far]).length, 0);
});

test("mergeBookings excludes non-held and board-store add-ons", () => {
  const cancelled = { status: "cancelled", courseRun: { course: { id: 66 }, startDate: "2026-06-18T17:00:00+00:00" } };
  const emptied = bk(66, "2026-06-18T17:00:00+00:00", []); // held check: participants present but empty -> not held
  const store = bk(50, "2026-06-18T17:00:00+00:00", [rider(100, "Dave")], { course: { id: 50, name: "Wakeboard Board Store" } });
  assert.equal(mb([], [cancelled, emptied, store]).length, 0);
});

test("mergeBookings merges riders across bookings, You first, de-duped", () => {
  const b1 = bk(66, "2026-06-18T17:00:00+00:00", [rider(200, "Hamish")]);
  const b2 = bk(66, "2026-06-18T17:00:00+00:00", [rider(100, "Dave"), rider(200, "Hamish")]);
  const out = mb([], [b1, b2]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].riders, ["You", "Hamish"]);
});

test("mergeBookings names other riders when You are not on the session", () => {
  const out = mb([], [bk(66, "2026-06-18T17:00:00+00:00", [rider(200, "Hamish"), rider(300, "Immy")])]);
  assert.deepEqual(out[0].riders, ["Hamish", "Immy"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test app/test/model.test.js`
Expected: FAIL — `mergeBookings is not defined` (import + function missing).

- [ ] **Step 3: Implement `mergeBookings`**

Add to `app/js/model.js` (after `markBooked`, keeping `markBooked` exported — it's still used by tests and remains a valid helper):

```js
// Overlay the roster's held bookings onto the availability slots so a session anyone on
// the account is booked on always shows — even when it's full and thus absent from the
// free-slot feed. Pure: the discipline filter, label resolver and current-user id are
// injected, so this needs no store/view imports.
//   slots        - free slots from runsToSlots (active discipline); mutated in place
//   meBookings   - raw /me/bookings (whole roster)
//   inDiscipline - (courseId) => bool: is this course in the shown discipline?
//   labelFor     - (courseId, courseName) => string: chip label (config label or prettyCourse)
//   meId         - logged-in contact id, rendered as "You"
// Existing slots the roster is booked on gain booked + riders; booked sessions with no
// availability row are synthesized as free:0 rows. Returns the combined list.
export function mergeBookings(slots, meBookings, { inDiscipline, labelFor, meId, now, horizonDays = 21 } = {}) {
  const start = now instanceof Date ? now : new Date(now);
  const horizon = new Date(start.getTime() + horizonDays * 86400000);
  const byKey = new Map(); // slotKey -> { courseId, runId, start, end, label, riders[], _ids:Set }
  for (const b of meBookings || []) {
    if (!bookingIsHeld(b)) continue;
    if (!countsTowardLimit(b)) continue;          // skip board-store / hire add-ons
    const cr = b.courseRun || {};
    const courseId = cr.course && cr.course.id;
    if (courseId == null || !cr.startDate) continue;
    if (!inDiscipline(courseId)) continue;        // wake vs SUP
    const s = new Date(cr.startDate);
    if (s < start || s > horizon) continue;       // upcoming, within horizon
    const key = slotKey(courseId, cr.startDate);
    let e = byKey.get(key);
    if (!e) {
      e = { courseId, runId: cr.id, start: cr.startDate, end: cr.endDate,
            label: labelFor(courseId, (cr.course || {}).name), riders: [], _ids: new Set() };
      byKey.set(key, e);
    }
    for (const p of activeParticipants(b)) {
      const cid = (p.contact || {}).id;
      if (cid != null && e._ids.has(cid)) continue;
      if (cid != null) e._ids.add(cid);
      const you = cid != null && cid === meId;
      e.riders.push({ name: you ? "You" : ((p.contact || {}).firstName || "Rider"), you });
    }
  }
  const ridersOf = (e) => [
    ...e.riders.filter(r => r.you).map(r => r.name),   // "You" first
    ...e.riders.filter(r => !r.you).map(r => r.name),  // then others, in encounter order
  ];
  const present = new Set();
  for (const slot of slots) {
    const e = byKey.get(slot.key);
    if (e) { slot.booked = true; slot.riders = ridersOf(e); present.add(slot.key); }
  }
  for (const [key, e] of byKey) {
    if (present.has(key)) continue;
    slots.push({ courseId: e.courseId, label: e.label, runId: e.runId,
      start: e.start, end: e.end, free: 0, capacity: null, key,
      booked: true, riders: ridersOf(e), freeWithMembership: false, weather: null });
  }
  return slots;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test app/test/model.test.js`
Expected: PASS (all `mergeBookings` cases + the existing suite).

- [ ] **Step 5: Commit**

```bash
git add app/js/model.js app/test/model.test.js
git commit -m "feat: mergeBookings — overlay roster bookings onto availability slots"
```

---

### Task 2: Window + just-opened guards, and defunct-slot prune in `model.js`

Three small pure changes so the new `free: 0` booked rows behave correctly downstream.

**Files:**
- Modify: `app/js/model.js` (`sessionsInWindow`, `justOpenedKeys`; add `pruneDefunctBookedSlots`)
- Test: `app/test/model.test.js`

**Interfaces:**
- Produces: `pruneDefunctBookedSlots(agenda) -> agenda` — drops rows where `free === 0 && !booked` from each day (a real availability row always has `free > 0`, so this uniquely targets a synthesized booked row that is no longer booked).
- Changes behaviour of existing `sessionsInWindow` (now includes booked-full rows) and `justOpenedKeys` (ignores `free <= 0` rows).

- [ ] **Step 1: Write the failing tests**

Add to `app/test/model.test.js` (extend the import line to include `pruneDefunctBookedSlots`):

```js
test("sessionsInWindow includes booked-full rows in the window, still excludes past", () => {
  const t = (h) => `2026-06-14T${h}:00:00+00:00`;
  const agenda = [{ date: "2026-06-14", slots: [
    { key: "a", start: t("18"), free: 0, booked: true, label: "Clinic" }, // full, booked, future
    { key: "b", start: t("07"), free: 0, booked: true, label: "Jam" },    // booked but already passed
    { key: "c", start: t("19"), free: 2, booked: false, label: "Air 30" },
  ] }];
  const out = sessionsInWindow(agenda, "today", new Date("2026-06-14T12:00:00+00:00"));
  assert.deepEqual(out.map(s => s.key), ["a", "c"]);
});

test("justOpenedKeys ignores newly-present free:0 booked rows", () => {
  const prev = [{ slots: [{ key: "x", free: 1 }] }];
  const cur = [{ slots: [{ key: "x", free: 1 }, { key: "booked", free: 0 }] }];
  const out = justOpenedKeys(prev, cur);
  assert.equal(out.has("booked"), false);
});

test("pruneDefunctBookedSlots drops free:0 unbooked rows, keeps the rest", () => {
  const agenda = [{ date: "d", slots: [
    { key: "ghost", free: 0, booked: false },  // cancelled-to-empty synthetic row
    { key: "still", free: 0, booked: true },   // still booked
    { key: "free", free: 2, booked: false },   // real availability
  ] }];
  pruneDefunctBookedSlots(agenda);
  assert.deepEqual(agenda[0].slots.map(s => s.key), ["still", "free"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test app/test/model.test.js`
Expected: FAIL — `sessionsInWindow` excludes the booked-full row (`["c"]` only), and `pruneDefunctBookedSlots is not defined`.

- [ ] **Step 3: Make the changes**

In `app/js/model.js`, `sessionsInWindow` — change the base filter to include booked rows:

```js
  const soon = (agenda || []).flatMap(d => d.slots || [])
    .filter(s => (s.free > 0 || s.booked) && new Date(s.start).getTime() > nowMs);
```

In `justOpenedKeys`, guard the current-agenda loop so only genuine free spots count:

```js
  for (const d of curAgenda || []) for (const s of d.slots || []) {
    if (s.free > 0 && (!prev.has(s.key) || s.free > prev.get(s.key))) out.add(s.key);
  }
```

Add `pruneDefunctBookedSlots` (near `groupByDay`):

```js
// After a cancellation, drop synthesized booked rows (free:0) that are no longer booked,
// so a cancelled-to-empty full session doesn't linger on Availability until the next
// reload. A real availability row always has free>0, so free===0 && !booked is uniquely
// a defunct booked row.
export function pruneDefunctBookedSlots(agenda) {
  for (const d of agenda || []) d.slots = (d.slots || []).filter(s => !(s.free === 0 && !s.booked));
  return agenda;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test app/test/model.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/js/model.js app/test/model.test.js
git commit -m "feat: window/just-opened guards + defunct-booked-slot prune for the overlay"
```

---

### Task 3: `bookedLabel` row-tag helper in `format.js`

The right-hand tag naming who's booked.

**Files:**
- Modify: `app/js/views/format.js` (add `bookedLabel`)
- Test: `app/test/format.test.js`

**Interfaces:**
- Produces: `bookedLabel(riders) -> string` where `riders` is a `string[]` (display names). `["You"] -> "✓ You're booked"`; `[] -> "✓ Booked"`; otherwise `"✓ " + riders.join(", ")`.

- [ ] **Step 1: Write the failing test**

Add to `app/test/format.test.js` (extend its import from `../js/views/format.js` to include `bookedLabel`):

```js
test("bookedLabel names who's booked, You first, sensible fallbacks", () => {
  assert.equal(bookedLabel(["You"]), "✓ You're booked");
  assert.equal(bookedLabel(["You", "Hamish"]), "✓ You, Hamish");
  assert.equal(bookedLabel(["Hamish"]), "✓ Hamish");
  assert.equal(bookedLabel(["Hamish", "Immy"]), "✓ Hamish, Immy");
  assert.equal(bookedLabel([]), "✓ Booked");
  assert.equal(bookedLabel(undefined), "✓ Booked");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test app/test/format.test.js`
Expected: FAIL — `bookedLabel is not defined`.

- [ ] **Step 3: Implement `bookedLabel`**

Add to `app/js/views/format.js`:

```js
// Right-hand tag for a booked session row. Names who's on it (roster-wide): "You" when
// you're on it, otherwise just the other riders. `riders` is an array of display names.
export function bookedLabel(riders) {
  const r = riders || [];
  if (r.length === 0) return "✓ Booked";
  if (r.length === 1 && r[0] === "You") return "✓ You're booked";
  return "✓ " + r.join(", ");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test app/test/format.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/js/views/format.js app/test/format.test.js
git commit -m "feat: bookedLabel — name who's booked on a session row"
```

---

### Task 4: Wire `mergeBookings` into `buildAgenda` + thread `meId`

Replace `markBooked` in the agenda assembly and pass the logged-in id through.

**Files:**
- Modify: `app/js/agendaModel.js`
- Modify: `app/js/data.js:27` (pass `meId`)
- Test: `app/test/agendaModel.test.js`

**Interfaces:**
- Consumes: `mergeBookings` (Task 1); `inActiveDiscipline` from `features.js`; `prettyCourse` from `./views/format.js`.
- Produces: `buildAgenda({ ..., meId })` — now overlays roster bookings; synthesized full-booked days appear in the returned day list.

- [ ] **Step 1: Write the failing test**

Add to `app/test/agendaModel.test.js`:

```js
test("buildAgenda overlays a full/absent booked session as a synthesized row", () => {
  const now2 = new Date("2026-06-14T08:00:00+00:00");
  // No runs for course 66 (Clinic) -> not in the free feed; but the roster is booked on it.
  const bookings = [{ status: "confirmed",
    participants: [{ id: 1, status: "confirmed", contact: { id: 7, firstName: "Dave" } }],
    courseRun: { id: 555, startDate: "2026-06-21T17:00:00+00:00", endDate: "2026-06-21T17:30:00+00:00",
      course: { id: 66, name: "2026 Wakeboard - Skills Clinic" } } }];
  const days = buildAgenda({ runsByCourse: {}, courses: [{ id: 66, label: "Clinic" }],
    meBookings: bookings, meMemberships: [], weather: null, now: now2, horizonDays: 21, meId: 7 });
  assert.equal(days.length, 1);
  const s = days[0].slots[0];
  assert.equal(s.booked, true);
  assert.equal(s.free, 0);
  assert.equal(s.label, "Clinic");
  assert.deepEqual(s.riders, ["You"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test app/test/agendaModel.test.js`
Expected: FAIL — no synthesized row (current `buildAgenda` only marks existing slots), `days.length === 0`.

- [ ] **Step 3: Update `buildAgenda` and `data.js`**

Replace the contents of `app/js/agendaModel.js` with:

```js
import { runsToSlots, mergeBookings, membershipFreeCourseIds, applyMembershipFree, groupByDay } from "./model.js";
import { inActiveDiscipline } from "./features.js";
import { prettyCourse } from "./views/format.js";
import { attachWeather } from "./weather.js";

export function buildAgenda({ runsByCourse, courses, meBookings, meMemberships, weather, now, horizonDays = 21, meId = null }) {
  let slots = [];
  for (const c of courses) {
    const runs = runsByCourse[c.id] || [];
    slots = slots.concat(runsToSlots(runs, c.id, c.label, now, horizonDays));
  }
  const courseLabels = new Map(courses.map(c => [c.id, c.label]));
  const labelFor = (id, name) => courseLabels.get(id) || prettyCourse(name);
  slots = mergeBookings(slots, meBookings, { inDiscipline: inActiveDiscipline, labelFor, meId, now, horizonDays });
  applyMembershipFree(slots, membershipFreeCourseIds(meMemberships));
  if (weather && weather.hourly) attachWeather(slots, weather.hourly);
  return groupByDay(slots, (weather && weather.daily) || {});
}
```

In `app/js/data.js`, pass `meId` (the call is around line 27):

```js
  const agenda = buildAgenda({ runsByCourse, courses, meBookings, meMemberships: memberships, weather, now, horizonDays: HORIZON_DAYS, meId: me && me.id });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test app/test/agendaModel.test.js app/test/model.test.js`
Expected: PASS — including the pre-existing `buildAgenda` test (course 50 booking still annotated; `inActiveDiscipline` defaults to wake under Node, so wake courses pass).

- [ ] **Step 5: Commit**

```bash
git add app/js/agendaModel.js app/js/data.js app/test/agendaModel.test.js
git commit -m "feat: overlay roster bookings in buildAgenda; thread meId through data.js"
```

---

### Task 5: Views — always show booked rows, label who

Make Availability, Day and Last-minute show booked rows regardless of the type filter, and render the rider-aware tag.

**Files:**
- Modify: `app/js/views/agenda.js:17` (shownDays slot filter)
- Modify: `app/js/views/day.js:21` (slot filter) and `:26` (booked tag)
- Modify: `app/js/views/lastminute.js:30` (post-window filter) and `:41` (booked tag)

**Interfaces:**
- Consumes: `state.agenda` now carrying booked rows with `riders` (Task 4); `bookedLabel` (Task 3).

- [ ] **Step 1: Availability — never hide a booked row**

In `app/js/views/agenda.js`, the `shownDays` map (currently `d.slots.filter(s => active.has(s.label))`):

```js
  const shownDays = days
    .map(d => ({ ...d, slots: d.slots.filter(s => s.booked || active.has(s.label)) }))
    .filter(d => d.slots.length);
```

(The `bookable = d.slots.filter(s => !s.booked)` line and the chip markup are unchanged — the chip already shows `✓` and greys via `.chip.booked`.)

- [ ] **Step 2: Day — filter + labelled tag**

In `app/js/views/day.js`: add `bookedLabel` to the import from `./format.js`. Change the slot filter:

```js
  const slots = day.slots.filter(s => s.booked || active.has(s.label));
```

Change the booked branch of `right`:

```js
    const right = s.booked
      ? `<span class="tag">${bookedLabel(s.riders)}</span>`
      : `<span class="free">${s.free} free</span>${s.freeWithMembership ? '<span class="mem">free w/ membership</span>' : ''}<a class="bk" target="_blank" rel="noopener" href="${s.runId ? `${BOOKING_SITE}/book?courseRunId=${s.runId}` : BOOKING_SITE}">Book ↗</a>`;
```

- [ ] **Step 3: Last-minute — filter + labelled tag**

In `app/js/views/lastminute.js`: add `bookedLabel` to the import from `./format.js`. Change the window filter:

```js
  const slots = sessionsInWindow(state.agenda, win, new Date()).filter(s => s.booked || active.has(s.label));
```

Change the booked branch of `right`:

```js
    const right = s.booked
      ? `<span class="tag">${bookedLabel(s.riders)}</span>`
      : `<span class="free">${s.free} free</span><a class="bk" target="_blank" rel="noopener" href="${s.runId ? `${BOOKING_SITE}/book?courseRunId=${s.runId}` : BOOKING_SITE}">Book ↗</a>`;
```

- [ ] **Step 4: Verify the suite still passes and lint the views**

Run: `node --test app/test/*.test.js`
Expected: PASS (no view unit tests exist; this confirms nothing else broke).

Then a manual smoke check (the app is browser-only; there is no view unit test):

```sh
cd app && python3 -m http.server 8000
# open http://localhost:8000, log in against the real API, and confirm:
#  - a full session you're booked on now appears on Availability (greyed chip, ✓) and Day ("✓ You're booked" / "✓ You, <name>")
#  - toggling that type's filter chip OFF does NOT hide your booked row
#  - Last-minute shows a booked session inside today/tomorrow/weekend
```

- [ ] **Step 5: Commit**

```bash
git add app/js/views/agenda.js app/js/views/day.js app/js/views/lastminute.js
git commit -m "feat: show booked rows on Availability/Day/Last-minute regardless of filter, labelled by rider"
```

---

### Task 6: Cancel-path cleanup in `account.js`

Drop a synthesized booked row when its booking is cancelled, so it doesn't linger.

**Files:**
- Modify: `app/js/views/account.js` (import + `onCancel`, around lines 6 and 171-172)

**Interfaces:**
- Consumes: `pruneDefunctBookedSlots` (Task 2).

- [ ] **Step 1: Import the helper**

In `app/js/views/account.js`, add `pruneDefunctBookedSlots` to the existing import from `../model.js`:

```js
import { bookingKeys, activeParticipants, countsTowardLimit, slotKey, pruneDefunctBookedSlots } from "../model.js";
```

- [ ] **Step 2: Prune after the booked-flag recompute**

In `onCancel`, right after the loop that recomputes `s.booked` from `bookingKeys` (currently the two lines beginning `const keys = bookingKeys(...)`), add the prune:

```js
    // keep the agenda's "booked" flags consistent without a full reload
    const keys = bookingKeys(state.meBookings || []);
    for (const d of state.agenda || []) for (const s of d.slots) s.booked = keys.has(s.key);
    pruneDefunctBookedSlots(state.agenda); // remove a now-cancelled synthesized (free:0) row
```

- [ ] **Step 3: Verify the suite still passes**

Run: `node --test app/test/*.test.js`
Expected: PASS.

- [ ] **Step 4: Manual check (optional but recommended)**

With the app served locally and logged in: cancel your place on a **full** session that only shows via the overlay, and confirm its row disappears from Availability immediately (not just after a refresh).

- [ ] **Step 5: Commit**

```bash
git add app/js/views/account.js
git commit -m "fix: drop a cancelled synthesized booked row from the agenda on cancel"
```

---

### Task 7: Version bump v95 → v96

**Files:**
- Modify: `app/sw.js:1`
- Modify: `app/js/config.js:63`

- [ ] **Step 1: Bump the cache name**

In `app/sw.js`, line 1:

```js
const CACHE = "lagoon-v96";
```

- [ ] **Step 2: Bump the app release**

In `app/js/config.js`:

```js
export const APP_RELEASE = "v96"; // release/version — bump together with sw.js CACHE
```

- [ ] **Step 3: Confirm they match and the full suite is green**

Run: `grep -n "lagoon-v96" app/sw.js && grep -n 'APP_RELEASE = "v96"' app/js/config.js && node --test app/test/*.test.js`
Expected: both greps match; all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add app/sw.js app/js/config.js
git commit -m "chore: bump app to v96 (bookings overlay on availability)"
```

---

## Self-Review

**Spec coverage:**
- Whole-roster overlay, full + still-free cases → Task 1 (`mergeBookings`, annotate + synthesize), Task 4 (wired into `buildAgenda`). ✓
- Discipline scope, horizon, held-only, add-on exclusion → Task 1 filters + tests. ✓
- Always-show regardless of type filter → Task 5 (three view filters) + `sessionsInWindow` change in Task 2. ✓
- Rider-named label incl. "no You" and fallback → Task 3 (`bookedLabel`) + Task 1 rider ordering. ✓
- Guards (`justOpenedKeys`, cancel prune) → Task 2 + Task 6. ✓
- Version bump v95→v96, no new files → Task 7 + Global Constraints. ✓
- No flag, no API/AWS change → not implemented (correct — out of scope). ✓

**Placeholder scan:** none — every code and test step carries real content.

**Type consistency:** `mergeBookings` produces `riders: string[]`; `bookedLabel` consumes `string[]`; `buildAgenda` passes `inDiscipline: inActiveDiscipline`, `labelFor: (id,name)=>courseLabels.get(id)||prettyCourse(name)`, `meId`. `pruneDefunctBookedSlots(agenda)` used identically in Task 2 test and Task 6 wiring. Slot shape (`courseId,label,runId,start,end,free,capacity,key,booked,riders,freeWithMembership,weather`) matches `runsToSlots`' shape plus `riders`. Consistent.
