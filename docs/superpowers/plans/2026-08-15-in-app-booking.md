# In-app Booking (membership-free sessions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Task 1 is a controller-led API capture (with the human partner), NOT a subagent task — do it first and record its output; Tasks 3–4 consume it.**

**Goal:** Let signed-in members book a **membership-free (£0)** session directly in the app — pick rider(s), agree terms once, confirm — with everything else (any cost / no coverage / terms declined / error) falling back to today's `Book ↗` web link. No payment is ever taken in the app.

**Architecture:** Pure eligibility logic (`model.js`) decides which riders a membership makes £0 for a session; a thin `api.js` client calls the Lagoon booking endpoints with the token the app already holds; a booking sheet (`views/book.js`) drives create → **assert £0** → complete, aborting to the web link on any cost or error. All behind `FEATURES.inAppBooking`.

**Tech Stack:** Vanilla JS ES modules, no build, no dependencies. Node's built-in test runner, fully mocked.

## Global Constraints

- **No dependencies, no build, no framework.** Plain `.js` the browser runs as-is.
- **NO PAYMENTS, EVER.** In-app booking fires only for £0 membership-covered bookings; after creating the pending booking the flow **asserts the pending-order total is £0 and aborts (→ web link) otherwise**. The app never invokes a card/Stripe checkout. (Matches `app/CLAUDE.md`.)
- **Golden rule — additive gating:** with `FEATURES.inAppBooking` off, every Book control is exactly today's `Book ↗` web link. Gate at the smallest seam.
- **Auth:** Lagoon API on `https://api.lagoon.co.uk` with the Bearer token from `getToken()` (same as `authedGet`). Cancel writes use `api2.lagoon.co.uk/api` (existing `cancelParticipant`).
- **v1 scope:** membership-covered sessions only. Ride-pass/token, paid, and group bookings stay web-view.
- **Version bump** at the end (sw.js `CACHE` + config `APP_RELEASE`); add `js/views/book.js` to `sw.js` `ASSETS`.
- Match surrounding style; tests fully mocked (inject `fetchImpl`/data — never hit the network).
- Design reference: `docs/superpowers/specs/2026-08-15-in-app-booking-design.md`.

---

### Task 1: Confirm the £0 booking sequence (controller-led capture — do FIRST)

**This is not a code task.** The controller performs it with the human partner (who logs into `booking.lagoon.co.uk` in Chrome) before dispatching Tasks 2–6, using the browser tools + a fetch/XHR interceptor (as in the design session). Record the results in this plan's ledger; Tasks 3–4 reference them.

**Confirm and write down:**
- [ ] **Completion sequence:** after `POST /me/orders/pending/bookings` for a £0 (membership-covered) session, is the booking already **confirmed** (appears in `GET /me/bookings`), or is a completion call required? Capture the exact completion call if so (method + path + body — the observed candidate was `POST /me/cart/giftVoucherPayment {}`). → this defines `completeFreeOrder` in Task 3, or lets Task 4 skip completion.
- [ ] **Pending-order total shape:** `GET /me/orders/pending` — the exact field that is £0 for a free order (e.g. `total`, `amountDue`, `price`) and its type/value. → this defines the £0 assertion in Task 4.
- [ ] **Abort/clear:** how a pending (uncompleted) booking is removed if the total is NOT £0 (e.g. `DELETE /me/orders/pending/bookings/{id}`, or it simply expires / can be left). → defines the abort cleanup in Task 4.
- [ ] **(optional) `canBookCourseRun`:** capture the SPA's own `POST /me/canBookCourseRun` request + response; if it cleanly returns £0/coverage, note it as an optional pre-check for Task 4.

**Deliverable:** a short "Confirmed booking API" block appended to the ledger with the exact create → (complete?) → confirmed sequence, the £0 field, and the abort mechanism. Cancel the test booking afterward.

---

### Task 2: Flag, terms storage, and eligibility logic (pure)

**Files:**
- Modify: `app/js/config.js` (add `inAppBooking` flag)
- Modify: `app/js/store.js` (terms-agreed accessors)
- Modify: `app/js/model.js` (eligibility helpers)
- Test: `app/test/model.test.js`, `app/test/store.test.js`

**Interfaces:**
- Produces: `coveringMembership(membership, courseId) -> boolean`
- Produces: `eligibleRidersFor(session, memberships, meBookings, meId, cap) -> [{ contactId, name, membershipId }]`
- Produces: `buildParticipants(riders) -> [{ contact:{id}, membership:{id} }]`
- Produces: `getBookingTermsAgreed() -> boolean`, `setBookingTermsAgreed(v)`

- [ ] **Step 1: Flag**

In `app/js/config.js` `FEATURES`, add:
```js
  inAppBooking: "internal", // book membership-free sessions in-app (dev-only while built out)
```

- [ ] **Step 2: Terms storage (`store.js`)**

Add (matching the try/catch pattern of the other opt-ins):
```js
const BOOKING_TERMS_KEY = "lagoon.bookingTermsAgreed";
export function getBookingTermsAgreed() { try { return localStorage.getItem(BOOKING_TERMS_KEY) === "1"; } catch { return false; } }
export function setBookingTermsAgreed(v) { try { if (v) localStorage.setItem(BOOKING_TERMS_KEY, "1"); else localStorage.removeItem(BOOKING_TERMS_KEY); } catch {} }
```

- [ ] **Step 3: Write failing eligibility tests (`model.test.js`)**

Extend the existing `../js/model.js` import to add `coveringMembership, eligibleRidersFor, buildParticipants`. Append:
```js
// ---- in-app booking eligibility ----
const membership = (id, memberIds, freeCourseIds) => ({
  id, status: "active",
  membershipType: { freeCourses: freeCourseIds.map(c => ({ id: c })) },
  members: memberIds.map(m => ({ id: m.id, firstName: m.name })),
});
const sessionFor = (courseId, start) => ({ courseId, start, key: slotKey(courseId, start) });

test("coveringMembership: true only when the course is in freeCourses", () => {
  const m = membership(1125, [{id:9720,name:"You"}], [51, 50]);
  assert.equal(coveringMembership(m, 51), true);
  assert.equal(coveringMembership(m, 66), false);
});

test("eligibleRidersFor: members covered for the course, not already booked, under cap", () => {
  const m = membership(1125, [{id:9720,name:"Dave"},{id:48114,name:"Hamish"}], [51]);
  const s = sessionFor(51, "2026-08-20T17:00:00+00:00");
  // Hamish already booked on this exact session
  const meBookings = [{ status:"confirmed",
    participants:[{ id:1, status:"confirmed", contact:{ id:48114 } }],
    courseRun:{ course:{ id:51 }, startDate:"2026-08-20T17:00:00+00:00" } }];
  const out = eligibleRidersFor(s, [m], meBookings, 9720, 4);
  assert.deepEqual(out.map(r=>r.contactId), [9720]);          // Hamish excluded (already on it)
  assert.equal(out[0].membershipId, 1125);
});

test("eligibleRidersFor: empty when the membership doesn't cover the course", () => {
  const m = membership(1125, [{id:9720,name:"Dave"}], [50]); // covers 50, not 51
  const s = sessionFor(51, "2026-08-20T17:00:00+00:00");
  assert.deepEqual(eligibleRidersFor(s, [m], [], 9720, 4), []);
});

test("eligibleRidersFor: excludes a rider at the per-rider cap", () => {
  const m = membership(1125, [{id:9720,name:"Dave"}], [51]);
  const s = sessionFor(51, "2026-08-20T17:00:00+00:00");
  const capped = Array.from({length:4}, (_,i) => ({ status:"confirmed",
    participants:[{ id:i+1, status:"confirmed", contact:{ id:9720 } }],
    courseRun:{ course:{ id:51 }, startDate:`2026-08-21T${10+i}:00:00+00:00` } }));
  assert.deepEqual(eligibleRidersFor(s, [m], capped, 9720, 4), []);
});

test("buildParticipants shapes the API payload", () => {
  assert.deepEqual(buildParticipants([{contactId:9720, membershipId:1125}]),
    [{ contact:{ id:9720 }, membership:{ id:1125 } }]);
});
```

- [ ] **Step 4: Run — verify they fail**

Run: `node --test app/test/model.test.js` → FAIL (`coveringMembership is not defined`).

- [ ] **Step 5: Implement in `model.js`**

```js
// Does this membership make the given course £0? (freeCourses lists covered course ids.)
export function coveringMembership(membership, courseId) {
  const free = (membership && membership.membershipType && membership.membershipType.freeCourses) || [];
  return free.some(c => c && c.id === courseId);
}

// Riders a membership makes £0 for this session, excluding anyone already booked on it or at the
// per-rider cap. Returns [{contactId, name, membershipId}] — empty means "not in-app bookable".
export function eligibleRidersFor(session, memberships, meBookings, meId, cap) {
  const booked = bookingKeys(meBookings || []);                 // slot keys already held
  // per-rider count of active upcoming session bookings (for the cap)
  const counts = {};
  for (const b of meBookings || []) {
    if (!bookingIsHeld(b) || !countsTowardLimit(b)) continue;
    for (const p of activeParticipants(b)) { const c = (p.contact||{}).id; if (c!=null) counts[c] = (counts[c]||0)+1; }
  }
  const out = []; const seen = new Set();
  for (const m of memberships || []) {
    if ((m.status||"").toLowerCase() !== "active") continue;
    if (!coveringMembership(m, session.courseId)) continue;
    for (const mem of m.members || []) {
      const id = mem.id;
      if (id == null || seen.has(id)) continue;
      // already booked on THIS session? (courseId@startDate key)
      const onThis = (meBookings||[]).some(b => bookingIsHeld(b)
        && slotKey(((b.courseRun||{}).course||{}).id, (b.courseRun||{}).startDate) === session.key
        && activeParticipants(b).some(p => (p.contact||{}).id === id));
      if (onThis) continue;
      if ((counts[id] || 0) >= cap) continue;
      seen.add(id);
      out.push({ contactId: id, name: id === meId ? "You" : (mem.firstName || "Rider"), membershipId: m.id });
    }
  }
  return out;
}

export function buildParticipants(riders) {
  return (riders || []).map(r => ({ contact: { id: r.contactId }, membership: { id: r.membershipId } }));
}
```

- [ ] **Step 6: Store test + run all**

Add to `app/test/store.test.js` (uses the existing Map-backed localStorage stub) a test that `setBookingTermsAgreed(true)`/`getBookingTermsAgreed()` round-trips and defaults false. Then:
Run: `node --test app/test/*.test.js` → all pass.

- [ ] **Step 7: Commit**

```bash
git add app/js/config.js app/js/store.js app/js/model.js app/test/model.test.js app/test/store.test.js
git commit -m "feat: inAppBooking flag, terms storage, membership eligibility logic"
```

---

### Task 3: Booking API client (`api.js`)

**Files:**
- Modify: `app/js/api.js`
- Test: `app/test/api.test.js`

**Interfaces:**
- Consumes: the confirmed sequence from **Task 1** (whether a completion call is needed, and its path).
- Produces: `createPendingBookings(courseRunId, participants, token, fetchImpl?) -> json`
- Produces: `getPendingOrder(token, fetchImpl?) -> json`
- Produces: `completeFreeOrder(token, fetchImpl?) -> json|true` (per Task 1; omit if `pending/bookings` self-confirms £0)

- [ ] **Step 1: Write failing tests (`api.test.js`)**

Follow the existing mocked-`fetchImpl` pattern (see the `cancelParticipant`/`login` tests). Assert the create call's URL, method, headers, and body:
```js
test("createPendingBookings POSTs the courseRun + participants payload", async () => {
  let captured;
  const fake = async (url, opts) => { captured = { url, opts }; return { ok:true, status:200, json: async()=>({id:1}) }; };
  await createPendingBookings(99001, [{contact:{id:9720},membership:{id:1125}}], "TOK", fake);
  assert.equal(captured.url, "https://api.lagoon.co.uk/me/orders/pending/bookings");
  assert.equal(captured.opts.method, "POST");
  assert.equal(captured.opts.headers.Authorization, "Bearer TOK");
  assert.deepEqual(JSON.parse(captured.opts.body),
    { courseRun:{id:99001}, groupParticipantsCount:0, participants:[{contact:{id:9720},membership:{id:1125}}] });
});

test("createPendingBookings throws code 401 on unauthorized", async () => {
  const fake = async () => ({ ok:false, status:401 });
  await assert.rejects(() => createPendingBookings(1, [], "T", fake), e => e.code === 401);
});

test("getPendingOrder GETs the pending order with auth", async () => {
  let u; const fake = async (url) => { u=url; return { ok:true, status:200, json: async()=>({total:0}) }; };
  const r = await getPendingOrder("TOK", fake);
  assert.equal(u, "https://api.lagoon.co.uk/me/orders/pending");
  assert.equal(r.total, 0);
});
```

- [ ] **Step 2: Run — verify fail**

Run: `node --test app/test/api.test.js` → FAIL (functions undefined).

- [ ] **Step 3: Implement in `api.js`**

```js
// Create pending booking(s) for a course run — one participant per rider, each under the
// membership that makes it £0. WRITE. Returns the pending-order/booking response.
export async function createPendingBookings(courseRunId, participants, token, fetchImpl = fetch) {
  const res = await fetchImpl(`${API_BASE}/me/orders/pending/bookings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ courseRun: { id: courseRunId }, groupParticipantsCount: 0, participants }),
  });
  if (res.status === 401) { const e = new Error("unauthorized"); e.code = 401; throw e; }
  if (!res.ok) throw new Error(`createBooking ${res.status}`);
  return res.json();
}

// The pending order ("cart") including its total — read to assert £0 before completing.
export async function getPendingOrder(token, fetchImpl = fetch) {
  const res = await fetchImpl(`${API_BASE}/me/orders/pending`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) { const e = new Error("unauthorized"); e.code = 401; throw e; }
  if (!res.ok) throw new Error(`pendingOrder ${res.status}`);
  return res.json();
}
```
Add `completeFreeOrder(token, fetchImpl)` here **iff** Task 1 found a required completion call, using its captured method/path/body; otherwise omit it and note in the commit that `pending/bookings` self-confirms £0. Add a matching mocked test for it.

- [ ] **Step 4: Run + commit**

Run: `node --test app/test/*.test.js` → all pass.
```bash
git add app/js/api.js app/test/api.test.js
git commit -m "feat: booking API client — createPendingBookings, getPendingOrder(, completeFreeOrder)"
```

---

### Task 4: Booking sheet + submit flow with the £0 safety gate (`views/book.js`)

**Files:**
- Create: `app/js/views/book.js`
- Test: `app/test/book.test.js` (for the pure £0-gate helper)

**Interfaces:**
- Consumes: Task 2 (`eligibleRidersFor`, `buildParticipants`, terms accessors), Task 3 (API client), Task 1 (£0 field + completion + abort).
- Produces: `openBookSheet(session, state, go, onBooked)` and pure `isFreeOrder(pendingOrder) -> boolean`.

- [ ] **Step 1: Write the failing £0-gate test (`book.test.js`)**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { isFreeOrder } from "../js/views/book.js";

test("isFreeOrder: only a zero total is free", () => {
  assert.equal(isFreeOrder({ total: 0 }), true);
  assert.equal(isFreeOrder({ total: 25 }), false);
  assert.equal(isFreeOrder({}), false);           // unknown → treat as NOT free (safe default)
  assert.equal(isFreeOrder(null), false);
});
```
(Use the exact £0 field name from Task 1 if it isn't `total`.)

- [ ] **Step 2: Run — verify fail; implement `book.js`**

Implement `isFreeOrder` (defaulting to **false** when the total is missing/unknown — safety), plus:
- `openBookSheet(session, state, go, onBooked)`: builds a modal (pattern: `intro.js`) with the eligible-rider checkboxes (from `eligibleRidersFor(session, state.memberships, state.meBookings, state.me.id, BOOKING_LIMIT)`; already-booked/at-cap simply aren't listed), the one-time terms checkbox (only when `!getBookingTermsAgreed()`, with a link to the Lagoon terms), and Confirm/Cancel. Inject its own `<style>` (guarded id).
- `submitBooking(selected)`:
  1. If the terms checkbox is present and unticked → keep it required (don't submit).
  2. `setBookingTermsAgreed(true)` (first agree).
  3. `await createPendingBookings(session.runId, buildParticipants(selected), getToken())`.
  4. `const order = await getPendingOrder(getToken());` — **if `!isFreeOrder(order)` → abort**: clear the pending booking (per Task 1), close the sheet, and open the `Book ↗` web link (`window.open(BOOKING_SITE + "/book?courseRunId=" + session.runId)`); return.
  5. `await completeFreeOrder(getToken())` (if Task 1 requires it).
  6. Optimistically add the participants to `state.meBookings`, `saveCache(state)`, call `onBooked()` (re-render), and kick a background refresh.
  7. Any thrown error (incl. 401 → `logout()`) → friendly message + web-link fallback.

Keep DOM specifics minimal; the only unit-tested unit is `isFreeOrder`.

- [ ] **Step 3: Run + commit**

Run: `node --test app/test/*.test.js` → all pass.
```bash
git add app/js/views/book.js app/test/book.test.js
git commit -m "feat: booking sheet + submit flow with the £0 abort-to-web safety gate"
```

---

### Task 5: Entry-point wiring (`day.js`, `lastminute.js`)

**Files:**
- Modify: `app/js/views/day.js` (the `right` Book branch)
- Modify: `app/js/views/lastminute.js` (the `right` Book branch)

- [ ] **Step 1: Branch the Book control to in-app when eligible**

In each view, for a non-booked slot, decide once: `const canInApp = isOn("inAppBooking") && getToken() && eligibleRidersFor(s, state.memberships, state.meBookings, (state.me||{}).id, BOOKING_LIMIT).length > 0;`. When `canInApp`, render an in-app **Book** button (`class="bk" data-inapp`) instead of the `Book ↗` anchor; wire its click to `openBookSheet(s, state, go, () => rerender())`. Otherwise render the existing `Book ↗` anchor **unchanged**. Import `isOn`, `getToken`, `eligibleRidersFor`, `openBookSheet`, `BOOKING_LIMIT` as needed.

- [ ] **Step 2: Verify + manual**

Run: `node --test app/test/*.test.js` → all pass.
Manual (flag on, signed-in member): an eligible session shows in-app **Book** → sheet → rider(s) + terms → confirm → £0 booking appears on Bookings + Availability; a non-covered/paid session shows `Book ↗` (web) and never charges; flag off → all `Book ↗`.

- [ ] **Step 3: Commit**

```bash
git add app/js/views/day.js app/js/views/lastminute.js
git commit -m "feat: in-app Book button for eligible sessions (else the web link)"
```

---

### Task 6: Version bump + service-worker asset

**Files:**
- Modify: `app/sw.js` (CACHE + add `./js/views/book.js` to ASSETS)
- Modify: `app/js/config.js` (APP_RELEASE)

- [ ] **Step 1: Bump + register the new file**

Bump `sw.js` `CACHE` and `config.js` `APP_RELEASE` to the next `vNN` together, and add `"./js/views/book.js"` to the `./js/views/*` group in `sw.js` `ASSETS`.

- [ ] **Step 2: Verify + commit**

Run: `grep -n "book.js" app/sw.js && node --test app/test/*.test.js` → asset present, all pass.
```bash
git add app/sw.js app/js/config.js
git commit -m "chore: bump app version (in-app booking) + cache book.js"
```

---

## Self-Review

**Spec coverage:**
- £0 membership-only booking + no-payment £0 gate → Task 4 (`isFreeOrder`, abort-to-web) + Task 1 (£0 field). ✓
- Eligibility from memberships (members × freeCourses), exclude already-booked/at-cap → Task 2 (`eligibleRidersFor`). ✓
- Multi-select riders → Task 4 sheet (checkboxes) + Task 2 `buildParticipants` (array). ✓
- Terms once, remembered → Task 2 storage + Task 4 (checkbox only when not agreed). ✓
- Create call with the captured payload + token → Task 3 (`createPendingBookings`). ✓
- Web fallback everywhere (flag off / not signed in / no eligible rider / not £0 / error) → Task 4 + Task 5. ✓
- Flag internal, additive → Task 2 flag + guards in Task 5. ✓
- Version bump + ASSETS → Task 6. ✓
- The two API unknowns → Task 1 (capture) feeding Tasks 3–4. ✓

**Placeholder scan:** the only deferred specifics are `completeFreeOrder`'s exact call, the £0 field name, and the abort/clear call — all explicitly produced by **Task 1** (a real capture step) and consumed via the Interfaces blocks, not vague "TBD"s.

**Type consistency:** `eligibleRidersFor(...) -> [{contactId, name, membershipId}]` feeds `buildParticipants(riders) -> [{contact:{id}, membership:{id}}]` feeds `createPendingBookings(courseRunId, participants, token)`. `isFreeOrder(order)` consumes `getPendingOrder`'s return. `session` carries `courseId`, `key`, `runId` (the slot shape from `runsToSlots`). Consistent across tasks.
