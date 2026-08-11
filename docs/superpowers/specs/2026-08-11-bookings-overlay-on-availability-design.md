# Show all your bookings on Availability + Last-minute — design

**Date:** 2026-08-11
**Status:** approved (design), ready for planning
**Scope:** `app/` (client only — no API, no AWS, no flag)

## Problem

The Availability and Last-minute screens are built from live course runs, and
`runsToSlots` (`model.js`) drops any run with `free <= 0`. A session you're booked on
therefore appears on those screens **only while it still has spare capacity** — the
`booked` flag rides on a slot that happens to still be listed. The moment a Jam or
Clinic fills up, it vanishes, even though you're on it.

Today that "you're booked on this" hint is genuinely useful (Dave uses it a lot), but
it's unreliable: to see where you're actually booked you have to flick to the Bookings
screen. The goal is to make the booking overlay complete, so Availability and
Last-minute always show every session you (or anyone on your account) is booked on.

## Decisions (agreed)

- **Whose bookings:** the **whole roster** — any session anyone on the account
  (membership members + you) is held on. Rows name who (see label rules).
- **Type filter:** booked sessions **always show**, regardless of the per-type filter
  chips. The filter only hides free-slot noise, never your own commitments.
- **Horizon:** **within the existing 21-day window only.** Bookings further out still
  live on the Bookings screen; we do not extend the agenda span.
- **Flag:** none. Straight GA change, consistent with other small UX improvements.

## Approach

Merge bookings into the agenda **once, at build time**, rather than overlaying them
separately in each view. A single pure function keeps the dedupe / discipline / label /
rider logic in one testable place, and means all three consumers — Availability, Day,
Last-minute — inherit the behaviour (so tapping a booked chip through to the Day view
still works).

The tempting minimal fix (keep full runs in `runsToSlots` when booked) is insufficient:
we only fetch runs for the *tracked* course types (`activeCourses()`), so a booking on a
course we don't track (e.g. a private lesson) has no run to keep. The Bookings screen
shows those via the booking's own `courseRun.course.name`; to reach parity we must derive
the overlay from the bookings list, not from runs.

## Components

### 1. `mergeBookings(slots, meBookings, opts)` — new pure fn in `model.js`

Signature:

```
mergeBookings(slots, meBookings, { courseLabels, meId, now, horizonDays })
  -> slots  (mutated/returned: annotated existing slots + synthesized booked slots)
```

- `slots` — the free-slot list already produced by `runsToSlots` for the active
  discipline.
- `courseLabels` — a `Map<courseId, label>` for the active discipline (from
  `activeCourses()`), used to label booked sessions on tracked course types.
- `meId` — `state.me.id`, to render the current rider as `"You"`.
- `now`, `horizonDays` — same window as availability (default 21).

Logic:

1. Build a `Map<slotKey, entry>` from `meBookings`, where each `entry` is
   `{ courseId, runId, start, end, label, riders }`. Include a booking only when:
   - `bookingIsHeld(b)` is true (active top-level **and** ≥1 active participant), **and**
   - `countsTowardLimit(b)` is true — i.e. a real cable/SUP session, **not** a board-store /
     hire / storage add-on (those are non-SUP and would otherwise pass the discipline
     check and wrongly appear as a session), **and**
   - `inActiveDiscipline(courseId)` is true (wake vs SUP), **and**
   - the session is **upcoming** (`start >= now`) and **within horizon**
     (`start <= now + horizonDays`).
   - `courseId` / `startDate` are present (skip malformed).
2. **Riders:** from `activeParticipants(b)`, map each to a display name —
   `p.contact.id === meId → "You"`, else `p.contact.firstName || "Rider"`. Order
   `"You"` first, then others in encounter order; de-duplicate by contact id. Multiple
   bookings that map to the same `slotKey` merge their rider lists.
3. **Label:** `courseLabels.get(courseId)` if tracked, else
   `prettyCourse(courseRun.course.name)`.
4. **Annotate existing slots:** for each slot in `slots` whose `key` is in the map, set
   `booked = true` and `riders = entry.riders`.
5. **Synthesize absent slots:** for each map key with no matching slot, push a new slot:
   ```
   { courseId, label, runId, start, end,
     free: 0, capacity: null,
     key, booked: true, riders,
     freeWithMembership: false, weather: null }
   ```
6. Return the combined list.

This **replaces the `markBooked(slots, bookingKeys(...))` call** in `buildAgenda`.
`bookingKeys` / `markBooked` remain exported (still used by `account.js`'s optimistic
post-cancel update).

Note: existing free slots keep `riders` undefined unless booked, so any check is
`slot.booked` (the source of truth); `riders` is presentation only.

### 2. `buildAgenda` / `loadEverything` — thread `meId` through

- `agendaModel.js buildAgenda(...)` gains `meId`; it calls `mergeBookings` (with a
  `courseLabels` map built from the `courses` it already receives) in place of
  `markBooked`, **before** `applyMembershipFree` and `attachWeather` — so synthesized
  booked rows also get membership/weather treatment and are grouped by day normally.
- `data.js loadEverything(...)` passes `meId: me.id` into `buildAgenda`.

### 3. Views — always show booked rows

Three one-line filter changes so a booked row is never hidden by the type filter:

- `views/agenda.js`: `d.slots.filter(s => s.booked || active.has(s.label))`
  (both the `shownDays` slot filter and the `bookable`/"all booked" derivation read
  the same way).
- `views/day.js`: `day.slots.filter(s => s.booked || active.has(s.label))`.
- `views/lastminute.js`: the post-`sessionsInWindow` filter →
  `s => s.booked || active.has(s.label)`.

And in `model.js sessionsInWindow`: the base filter changes
`s.free > 0` → `s.free > 0 || s.booked` (keeping the `start > now` upcoming check, so a
booking earlier today doesn't resurface in a last-minute window).

### 4. Row label — name who

A shared helper (in `format.js`) turns a booked slot's `riders` into the right-hand tag.
`"You"` appears **only if the current rider is actually on the session** — a booking may
be for family members with no "You" at all, in which case the tag is just their names:

- riders is exactly `["You"]` → **"✓ You're booked"** (unchanged wording).
- otherwise → **"✓ " + riders.join(", ")** → e.g. **"✓ You, Hamish"**, **"✓ Hamish"**
  (you're not on it), **"✓ Hamish, Immy"**, **"✓ You, Hamish, Immy"**.
- defensive fallback (booked slot with an empty/absent rider list) → **"✓ Booked"**.

Used by `day.js` and `lastminute.js` (which render full rows). The compact agenda **chip**
is unchanged: `18:30 Jam ✓`, greyed via `.chip.booked` — names are seen on tap-through.

### 5. Guards so the overlay doesn't misfire

- **`justOpenedKeys` (`model.js`):** add a `s.free > 0` condition in the current-agenda
  loop, so a synthesized `free: 0` booked slot (e.g. a session you just booked, newly
  present vs the previous snapshot) never gets flagged as "just opened ↑".
- **Cancel path (`account.js onCancel`):** after removing a participant / booking and
  recomputing `s.booked` from `bookingKeys`, also **drop any synthesized booked slot**
  (`s.free === 0 && !s.booked`) whose booking is gone, so a cancelled-to-empty full
  session doesn't linger on Availability until the next reload.

## Data flow

```
loadEverything
  runsToSlots (free>0, per active-discipline course)   ─┐
  meBookings (all roster bookings)                       ├─> buildAgenda
                                                          │     mergeBookings  ← meId, courseLabels, horizon
                                                          │       · annotate booked-with-room slots (+riders)
                                                          │       · synthesize booked-full / untracked slots (free:0)
                                                          │     applyMembershipFree
                                                          │     attachWeather
                                                          │     groupByDay
state.agenda ──> Availability / Day / Last-minute  (booked rows always shown, labelled by rider)
```

## Testing

Pure-function tests in `test/` (Node runner, mocked — the existing pattern):

- `mergeBookings`:
  - annotates an existing free slot the roster is booked on (`booked`, `riders`).
  - synthesizes an absent (full) booked session as a `free:0` slot.
  - synthesizes a booking on an **untracked** course using `prettyCourse` for the label.
  - **excludes** the wrong discipline (SUP booking hidden in wake mode, and vice-versa).
  - **excludes** past and beyond-horizon bookings.
  - **excludes** non-held bookings (cancelled / cancelled-to-zero-riders).
  - **excludes** board-store / hire add-ons (`countsTowardLimit === false`).
  - labels a booking with no "You" using only the other riders' names.
  - merges riders across two bookings on the same session; `"You"` first; de-duped.
- `sessionsInWindow`: includes a booked-full slot in the window; still excludes a
  past-today booked slot.
- `justOpenedKeys`: a newly-present `free:0` booked slot is **not** flagged.

## Housekeeping

- No new files → bump `sw.js` `CACHE` and `config.js` `APP_RELEASE` **v95 → v96**
  together. `ASSETS` list unchanged.
- Deploy is separate (merge to `main` does not deploy) — the daves-adventures "Deploy
  Hugo Site (AWS)" workflow ships it.

## Out of scope / non-goals

- No change to notifications, the AWS watcher, or any API call.
- No extension of the 21-day horizon.
- No change to the compact agenda chip beyond the existing `✓` / greyed style.
- Board-store / hire extras are **excluded** from the overlay via `countsTowardLimit`
  (see §1) — they belong to the Bookings > Extras section, not Availability.
```
