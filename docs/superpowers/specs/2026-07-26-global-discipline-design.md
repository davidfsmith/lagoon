# Global discipline (wake ⇄ SUP everywhere) — design

**Date:** 2026-07-26
**Status:** Approved, dev-only (rides the existing `supBooking` flag)

## Goal

Promote the discipline switch from Availability-only to **app-wide**: a header toggle that
filters Availability, Bookings, and History to the chosen activity, plus a "Default
activity" setting. Wake-specific content (booking-limit caps, ride-pass/membership Extras,
ride streak) is hidden in SUP mode. All behind `supBooking`; wake path unchanged when off.

## Classifier (features.js)

- `isSupCourse(id)` — `id` is in `SUP_COURSES`.
- `inActiveDiscipline(courseId)`:
  - **`!isOn("supBooking")` → `true`** (no filtering — non-dev users' bookings/history are
    never hidden, even a SUP session booked on the website). Non-destructive.
  - flag on → `getDiscipline() === "sup" ? isSupCourse(id) : !isSupCourse(id)`.

Used in the **views** (account.js, history.js), not the pure models — keeps `historyModel`
pure/testable.

## Header switch

- `index.html` header gains a compact `🏄 | 🏄‍♂️` toggle between the title and ⚙, `hidden`
  by default.
- `app.js` shows it only when `isOn("supBooking")` **and** logged in (`updateDisciplineToggle()`,
  called from `afterLoad`; hidden again on `go("login")`). Segments wired once at boot.
- **Removed from the Availability view** — it lives in the header now.
- `switchDiscipline(disc)` (generalised): `setDiscipline` + refresh the toggle + `reload` the
  **current** route (so it works from any tab), landing on Availability if on the now-hidden
  Last-minute; settings reloads quietly (no spinner) so the Default-activity dropdown stays put.

## Per-screen behaviour in SUP mode

- **Availability** — already discipline-aware.
- **Bookings (account.js)** — `upcoming` filtered by `inActiveDiscipline`; the wake
  booking-limit **caps row hidden**; **Extras tab removed** (tabs become Bookings · History;
  a stale `activeTab === "extras"` falls back to Bookings).
- **History (history.js)** — `meBookings` filtered by `inActiveDiscipline` before
  `pastSessions`; the **ride-streak line hidden** (count / favourite / per-rider still show).

## Default activity (Settings)

- A "Default activity" row (`🏄 Wakeboard` / `🏄‍♂️ SUP` select) in Settings, shown only when
  `isOn("supBooking")`. On change → `switchDiscipline(value)`; since `currentRoute` is
  settings, it reloads data and re-renders settings in place. Writes the same persisted
  `lagoon.discipline`, so it *is* the opening activity (discipline already persists).

## Out of scope

- No SUP-specific stats (streak/handling stays wake-only; SUP just hides it).
- No change to notifications (already wake-only + labelled) or Last-minute (already hidden in
  SUP). No AWS changes.

## Checklist

- `features.js` — `isSupCourse`, `inActiveDiscipline`.
- `index.html` — header toggle markup + styles.
- `app.js` — `updateDisciplineToggle()`, wire segments, generalise `switchDiscipline`, hide on login.
- `views/agenda.js` — remove the in-view switch.
- `views/account.js` — discipline filter, hide caps + Extras in SUP.
- `views/history.js` — discipline filter, hide streak in SUP.
- `views/settings.js` — Default activity row.
- Version bump; tests for `inActiveDiscipline` (off → all; on+wake → wake; on+sup → SUP).
