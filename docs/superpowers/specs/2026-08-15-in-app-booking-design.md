# In-app booking (membership-free sessions) — design

**Date:** 2026-08-15
**Status:** approved (design), ready for planning
**Scope:** `app/` (client only — uses existing Lagoon API endpoints; no new backend)

## Problem / goal

Today, tapping **Book ↗** on a session deep-links out to the Lagoon booking website
(`booking.lagoon.co.uk/book?courseRunId=…`) — a clunky, multi-tab, "tedious" flow. For
signed-in members booking a session their **membership already makes free (£0)**, we can do
the whole thing **inside the app**: pick the rider(s), agree the terms once, confirm.

Everything else — no membership coverage, any cost, ride-pass bookings, terms not agreed,
or any error — keeps the current `Book ↗` web link, unchanged.

## Golden rule — NO PAYMENTS, EVER (hard constraint)

The app must never take, or route the user toward, a payment. In-app booking therefore fires
**only for genuinely £0 bookings**, and the flow is built so it *cannot* complete a booking
that carries a charge:

- Only offered when a rider's **membership covers the session** (client-side check).
- After creating the pending booking, the flow reads the **pending-order total and asserts it
  is £0**. If it is anything else, it **aborts** (discards the pending booking, never completes)
  and falls back to the web link.
- The free-checkout completion call is the only completion path invoked; the app never touches
  the card/Stripe checkout.

This aligns with the app's long-standing `app/CLAUDE.md` rule: "No payments, ever."

## Decisions (agreed)

- **Terms agreement:** the "I agree to the Lagoon terms" checkbox is ticked **once and
  remembered on-device**; after that, eligible bookings are one-tap. Not agreed → web fallback.
- **Riders:** **multi-select** — the eligible roster shown as checkboxes; book several onto one
  session in a single confirm (the API's `participants[]` is an array).
- **Free scope (v1):** **membership-covered sessions only** — exactly the flow we captured and
  understand. Ride-pass/token-covered and paid bookings stay web-view (a later iteration may add
  ride-pass once its payload is confirmed).

## The Lagoon booking API (discovered 2026-08-15 by capturing the web flow)

All on `https://api.lagoon.co.uk` with the **same Bearer token the app already stores** (from
login). The booking web app (`booking.lagoon.co.uk`) is just another client of this API.

**Create a booking (add to the pending order / "cart") — the key call:**
```
POST /me/orders/pending/bookings
Authorization: Bearer <token>
Content-Type: application/json
{
  "courseRun": { "id": <courseRunId> },
  "groupParticipantsCount": 0,
  "participants": [
    { "contact": { "id": <riderContactId> }, "membership": { "id": <membershipId> } }
    // one entry per selected rider, each under the membership that makes it £0
  ]
}
```
Observed with a real £0 booking: `{courseRun:{id:99001}, groupParticipantsCount:0,
participants:[{contact:{id:9720}, membership:{id:1125}}]}`.

**Roster (who can be booked):** `GET /me/children`, `GET /me/partners`, `GET /me/friendships`
(each returns `{meta, data:[…]}` with contact objects `{id, firstName, lastName, …}`), plus the
signed-in user themselves. NOTE: the app currently derives the roster only from
`membership.members`; the fuller roster lives in these endpoints.

**Membership coverage / free determination:** `GET /me/memberships` (already fetched by the app)
returns memberships with `members[]` (the covered roster) and `membershipType.freeCourses[]`
(the courses that membership makes £0). A rider is £0-eligible for a session's course C iff they
are a `member` of a membership whose `freeCourses` includes C.

**Eligibility / cost oracle (authoritative):** `POST /me/canBookCourseRun` — exists (GET → 405;
wrong-payload POST → 400 `{description, code, extraInfo}`). Payload not yet decoded. Intended as
an authoritative pre-check (covers caps, availability, coverage) — see "to confirm" below.

**Cancel (already in the app):** `POST api2.lagoon.co.uk/api/booking-order/cancelParticipant/{participantId}`.

**Pending order / cart:** `GET /me/orders/pending` (holds the not-yet-completed bookings + total).
The completion step observed was `POST /me/cart/giftVoucherPayment {}` (a £0 checkout finish) —
exact £0-completion sequence to be confirmed (see below).

## To confirm before building (a short controlled capture, like the design session)

1. **£0 completion sequence:** does `POST /me/orders/pending/bookings` alone confirm a
   membership-covered (£0) booking, or is a completion call required (and is
   `/me/cart/giftVoucherPayment {}` it, or is there a `/me/orders/pending/complete`-style call)?
   Determine by booking a £0 session and inspecting `/me/bookings` before/after each step.
2. **`/me/canBookCourseRun` payload + response:** capture the SPA's own call to learn the exact
   request shape and whether the response gives the price/coverage (a cleaner £0 oracle than the
   client-side membership check).

The **£0-total assertion gate keeps the feature safe regardless** of these — they refine
correctness/UX, not safety.

## Architecture

### 1. API client (`api.js`)

Add (all take the token, mockable `fetchImpl`):
- `createPendingBookings(courseRunId, participants, token)` — `POST /me/orders/pending/bookings`
  with the payload above. `participants` = `[{contactId, membershipId}, …]`. Returns the response.
- `getPendingOrder(token)` — `GET /me/orders/pending` (to read the total for the £0 assertion).
- `completeFreeOrder(token)` — the confirmed £0-completion call (endpoint set once §"to confirm"
  #1 is captured).
- (optional) `canBookCourseRun(courseRunId, token)` once its payload is known.

### 2. Eligibility (pure, in `model.js` — unit-tested)

- `coveringMembership(membership, courseId)` → true if `membershipType.freeCourses` includes
  `courseId`.
- `eligibleRidersFor(session, memberships, meBookings, meId, cap)` → the list of
  `{contactId, name, membershipId}` who (a) are members of a membership covering the session's
  course, (b) aren't already booked on that session, (c) are under the per-rider `BOOKING_LIMIT`.
  Returns `[]` when none → session is not in-app bookable (web fallback).
- `buildParticipants(selectedRiders)` → the `participants[]` payload array.

### 3. Booking flow (`views/book.js` — new; a sheet/modal)

`openBookSheet(session, state, onDone)`:
- Renders the eligible roster as checkboxes (multi-select; already-booked/at-cap shown disabled).
- Renders the one-time terms checkbox: shown unchecked+required only if `!getBookingTermsAgreed()`;
  once agreed it's stored (`store.js`) and the checkbox is hidden on later bookings. A "Lagoon
  terms" link opens the terms page.
- **Confirm** runs `submitBooking`:
  1. `createPendingBookings(courseRunId, participants, token)`.
  2. `getPendingOrder(token)` → **assert `total === 0`** (or the API's £0 marker). If not £0 →
     **abort**: discard pending (cancel/remove), close the sheet, and open the `Book ↗` web link.
  3. `completeFreeOrder(token)`.
  4. Optimistically add the participants to `state.meBookings`, `saveCache`, re-render; refresh
     from the API in the background. The new booking then also appears on Availability via the
     existing bookings overlay.
- Errors at any step (network/401/validation) → friendly message + fall back to the web link.

### 4. Entry point (`views/day.js`, `views/lastminute.js`)

The `Book ↗` control gets a small branch: for a signed-in user with `isOn("inAppBooking")` and a
session that has ≥1 eligible rider → render an in-app **Book** button that calls
`openBookSheet(...)`. Otherwise → the existing `Book ↗` web link (unchanged markup). Gate at the
smallest seam so the web path is literally untouched for everyone else.

### 5. Store (`store.js`)

- `getBookingTermsAgreed()` / `setBookingTermsAgreed(true)` — `lagoon.bookingTermsAgreed` (try/catch).

## Fallbacks (all → today's `Book ↗` web link, no regression)

- Not signed in · flag off · no eligible rider (no membership coverage) · terms not agreed and the
  user cancels · pending total not £0 · any API error.

## Flag & rollout

- New `FEATURES.inAppBooking: "internal"` in `config.js` (internal → beta → on → remove flag).
  This is a real **write** to members' accounts, so it ships dev-gated and is trialled internally
  (Dave books a real £0 session in-app, verifies it lands, cancels it) before beta.
- Additive gating: with the flag off, every Book control is exactly today's web link.

## Testing

- **Pure logic (unit-tested, `model.js`):** `coveringMembership`, `eligibleRidersFor` (covers:
  covered vs uncovered course, already-booked exclusion, cap exclusion, multi-membership),
  `buildParticipants` (payload shape).
- **API client:** `createPendingBookings`/`getPendingOrder`/`completeFreeOrder` with a mock
  `fetchImpl` — assert the URL, method, body shape, and 401 handling (mirrors `cancelParticipant`
  tests).
- **The £0 safety gate:** a unit test that a non-£0 pending total makes `submitBooking` abort
  (not complete) and signal web-fallback.
- **Views/sheet:** DOM glue — verified manually + suite stays green.
- **Manual (internal):** book a real membership-free session in-app for one + multiple riders;
  confirm £0, that it appears on Bookings + Availability, and cancels cleanly; confirm a
  non-covered/paid session bounces to web and never charges.

## Out of scope (v1)

- **Ride-pass / token-covered** bookings (needs the token payload) and any **paid** booking —
  both stay web-view.
- **Group bookings** (`groupParticipantsCount` > 0).
- No new backend, no AWS/watcher changes, no payments handling of any kind.

## Housekeeping

- New file `app/js/views/book.js` (and its tests) → add to `sw.js` `ASSETS`; version bump at
  implementation. New flag in `config.js`.
- Deploy is separate (the daves-adventures "Deploy Hugo Site (AWS)" workflow).
