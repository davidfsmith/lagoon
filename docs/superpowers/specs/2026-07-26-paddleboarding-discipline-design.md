# Paddle boarding via a discipline switch — design

**Date:** 2026-07-26
**Status:** Approved (design), dev-only

## Goal

Let the app show **paddle boarding (SUP)** availability alongside wakeboarding, chosen via
a top-level **discipline switch**. Dev-only for now (behind an `internal` flag). Availability
+ Book link only — **no push notifications** (no AWS/watcher changes).

## Model

- **Discipline** = `wake` | `sup`, stored in `localStorage` (`lagoon.discipline`, default
  `wake`), like theme.
- `activeCourses()` (in `features.js`) returns the course set for the current discipline:
  `SUP_COURSES` when `isOn("supBooking")` **and** discipline is `sup`; otherwise `COURSES`
  (wake). When the flag is off it always returns `COURSES`, so non-dev users are unaffected.
- The whole availability pipeline reads `activeCourses()`: `data.js` fetches that set's runs,
  and the agenda / day view / Last-minute all follow from the loaded agenda.

## SUP course set

Six live types (verified as having scheduled runs on 2026-07-26), all `group: "paddle"`,
all default-on (no `extra` flag) so switching to SUP shows everything:

| id | chip label | catalogue name |
|----|------------|----------------|
| 37  | Ready to Ride | 2026 SUP - Ready to Ride |
| 38  | Touring       | 2026 SUP - Intro to Touring |
| 71  | Sea Social    | 2026 Clinic SUP - Sea social and Improve |
| 72  | Training      | 2026 Clinic SUP - Training/Race |
| 73  | SUP Yoga      | 2026 Clinic - SUP Yoga |
| 415 | Private       | 2026 SUP - Private Lesson |

## The switch

- A segmented control at the **top of the Availability view**: `🏄 Wakeboard | 🏄‍♂️ SUP`,
  rendered **only when `isOn("supBooking")`**. Flag off → no switch, view unchanged.
- Selecting a discipline calls an exported `switchDiscipline(disc)` in `app.js`:
  `setDiscipline(disc)` then `reload("agenda", true)` — **reload on switch** (fetch only the
  selected discipline's runs; brief full-page spinner). Reuses the existing reload path.

## Filters

- `filters.js` computes labels **and groups** from `activeCourses()` at call-time (not at
  module load), so the flag/discipline apply live. Wake renders the ride/other chip rows as
  now; SUP renders its `paddle` row.
- **Filter selection persists per discipline** — key `lagoon.types.<discipline>` — so wake
  and SUP selections don't clobber each other (the current single key would leave SUP empty).

## Booking

- Book links already build from `runId` (`day.js`), and SUP runs carry `runId`, so booking a
  SUP session works with no change.

## Explicitly unchanged / out of scope

- **Notifications:** the notify-pref chips in `settings.js` stay bound to wake-only `COURSES`,
  so SUP is availability + Book only and never becomes a notifiable type. No `courses.json`,
  `KNOWN_TYPES`, or register-Lambda changes.
- **Bookings tab** shows the user's actual bookings regardless of discipline (unchanged).
- No SUP-specific weather/branding tweaks — the generic session rendering is reused.

## Implementation checklist

- `config.js` — add `SUP_COURSES`, `supBooking: "internal"`; keep `COURSES`/`FILTER_GROUPS`.
- `store.js` — `getDiscipline()` / `setDiscipline()`.
- `features.js` — `activeCourses()`.
- `data.js` — fetch/build from `activeCourses()`.
- `filters.js` — dynamic labels + groups from `activeCourses()`; per-discipline persistence key.
- `views/agenda.js` — discipline segbar (gated) + wiring.
- `app.js` — export `switchDiscipline(disc)`.
- Version bump (`sw.js` CACHE + `config.js` APP_RELEASE).
- Tests — `activeCourses()` gating (off → wake, on+sup → SUP); SUP_COURSES shape.
