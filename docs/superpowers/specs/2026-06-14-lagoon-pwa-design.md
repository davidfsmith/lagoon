# Lagoon PWA — Design Spec

**Date:** 2026-06-14
**Status:** Approved (design); pending implementation plan
**Author:** Dave + Claude (brainstorming session)

## 1. Purpose

A phone-first companion app for Hove Lagoon wakeboarding. It shows, in one place:

- **Your stuff** — upcoming bookings, membership status, ride-pass token balance.
- **Find a session** — upcoming free Tech/Air 30 sessions ("Ride the Cables"), with
  weather per day, so short-notice weekend spots are easy to spot and grab.

It complements the existing background **watcher** (which pushes alerts when new
slots appear). The watcher answers "tell me when something frees up"; this app
answers "let me look at what's free and what the weather's doing, and see my
account."

### Scope decisions (agreed)

- **v1 is read-only.** Login, your bookings/membership/passes, an availability
  agenda with weather, and a day-detail view. Booking is done by deep-linking out
  to the existing booking website.
- **Booking from the app is a later phase** with its own spec. It will only ever
  cover the **no-payment path** (sessions that are free with membership / covered
  by ride-pass tokens). **Card payment is explicitly out of scope, permanently.**
- **No backend for the app.** It is a self-contained static PWA talking directly
  to the public Lagoon API and a weather API from the browser.

## 2. Key technical findings (validated this session)

- **The Lagoon API is browser-callable cross-origin.** `api.lagoon.co.uk` reflects
  the request `Origin` back in `access-control-allow-origin` and allows the
  `authorization` header on preflight. So a static PWA on any origin (localhost,
  Hugo site, etc.) can call it directly with a bearer token.
- **Auth** is `POST /login` returning a JWT (HS256). Authenticated reads used in
  v1: `me`, `me/bookings`, `me/memberships`, `me/packages`. (`me/availableCredit`
  exists but returns empty for this account, so it is unused in v1.)
- **Availability** comes from `public/courseRuns?course=<id>` (no auth), already
  sorted ascending from today; free spaces = `maxNumbers − participantsCount`.
- **Membership** carries a `freeCourses` list — for this account it includes the
  Tech 30 (id 50) and Air 30 (id 51) ride sessions, which is why those bookings
  are £0. This is the basis for the "free w/ membership" flag.
- **Weather:** Open-Meteo (free, no API key) returns daily + hourly temp, rain
  (% and mm), wind speed/gusts/direction, UV, sunrise/sunset for Hove Lagoon
  (~50.827, −0.171), up to 16 days out.

## 3. Architecture

A single self-contained static PWA, mirroring the existing
`daves-adventures/site/static/compose` app: vanilla JS, no build step, dark theme,
installable to the iPhone home screen.

```
app/
  index.html        # app shell + views
  sw.js             # service worker (network-first HTML, cache fallback)
  manifest.json     # PWA manifest (standalone, dark theme)
  icon.svg, icon-192.png, icon-512.png, icon-180.png
  js/
    api.js          # Lagoon API client (login + me/* + public/courseRuns)
    weather.js      # Open-Meteo client (daily + hourly for Hove Lagoon)
    store.js        # token + cached data in localStorage
    model.js        # pure logic: courseRuns→slots, merge weather, cross-ref bookings
    views/
      login.js
      agenda.js
      day.js
      account.js
```

Module responsibilities (each one job, testable in isolation):

- **api.js** — `login(email, password) → token`; authed GETs for `me`,
  `me/bookings`, `me/memberships`, `me/packages`; unauthed `public/courseRuns`.
  Attaches `Authorization: Bearer <token>`. Surfaces `401` distinctly.
- **weather.js** — fetch daily + hourly forecast for the fixed Hove Lagoon
  coordinates; expose "weather at a given ISO datetime" and "day summary".
- **store.js** — read/write token and last-good cached payloads in `localStorage`.
- **model.js** — pure functions: parse `courseRuns` → slots (free > 0), group by
  day, attach weather, flag slots the user is already booked into (from
  `me/bookings`), flag free-with-membership (from `membership.freeCourses`).
- **views/** — render login, agenda, day-detail, account from model output.

### Configuration

- Monitored courses (Tech 30 = id 50, Air 30 = id 51) live in a small in-app
  config, mirroring the watcher's `courses.json` concept. Resolve by name where
  practical so a renumber is visible.
- Hove Lagoon coordinates fixed in `weather.js`.

### Hosting

Static. Can live under `daves-adventures/site/static/lagoon/` (served by Hugo,
like compose) or stand alone — decided at deploy time. Local dev:
`python3 -m http.server` from `app/`.

## 4. Screens

Bottom navigation: **Agenda · Account**.

### Login
Shown when there is no valid token. Email + password fields → `POST /login`.
On success, store the returned JWT (the password is never stored). Logout clears
the token.

### Agenda (home)
A scroll of upcoming days that have free Tech/Air 30 sessions. Each day is a card:
weather summary header (temp range, rain, wind+gusts) + the free-session times as
chips with free counts. Weekends are flagged. Days where the user is already fully
booked are de-emphasised. Tapping a day opens Day detail.

### Day detail
A horizontal hourly weather strip across the day's session hours, then each free
session as a row showing the weather **at its time**, a "free w/ membership" note,
free count, and a `Book ↗` button. Sessions the user already holds are greyed with
a "✓ You're booked" tag. `Book ↗` deep-links to the booking website (v1).

### Account
Membership type, status, and expiry; ride-pass token balance (remaining/total);
and the user's upcoming bookings from `me/bookings`.

## 5. Data flow & caching

- On open with a token, fetch in parallel: `me`, `me/bookings`, `me/memberships`,
  `me/packages`, the monitored `public/courseRuns`, and Open-Meteo (daily+hourly).
- `model.js` builds the agenda: free slots grouped by day, weather attached, booked
  slots flagged, membership-free slots flagged.
- Cache last-good responses in `localStorage`. The service worker is network-first
  with cache fallback, so the app opens instantly and read-only data still renders
  offline.
- Default horizon: 21 days ahead (configurable).

## 6. Booking

- **v1:** `Book ↗` opens the booking site (deep-linked to the course/day where the
  URL scheme allows, otherwise the booking home). The app performs **no writes**.
- **Later phase (separate spec):** in-app booking for the no-payment path only —
  `me/canBookCourseRun` → `POST me/orders/pending/bookings` with the participant's
  membership applied (100% discount → £0) → order completion. **Never card
  payment.** Out of v1 scope.

## 7. Relationship to the watcher / future AWS

The PWA is read-mostly and standalone; it does not depend on the watcher. The
Python watcher continues to provide background push alerts and will migrate to AWS
(Lambda + DynamoDB) separately. They share the "monitored courses" concept but have
no hard dependency. If phone push or saved preferences are wanted later, the future
AWS component can serve them; v1 needs no backend.

## 8. Error handling

- No token, or any `401` from a `me/*` call → clear token, show Login.
- API or weather fetch failure → render cached data with a "stale" badge; weather
  is best-effort (sessions still render without it).
- Empty state → "No free sessions in the next N days."

## 9. Testing

- **Unit:** the `model.js` pure functions — courseRuns→slots, weather merge,
  booking cross-reference, membership free-flagging.
- **Manual acceptance** against known ground truth captured 2026-06-14: 4 upcoming
  bookings (Mon 15 Air, Tue 16 Tech, Fri 19 Skills Clinic, Sun 21 Tech), ride-pass
  balance 2/6, membership expiry 2026-07-06. Log in and confirm these render and
  that a booked slot shows greyed.

## 10. Out of scope (v1)

- In-app booking (later phase).
- Any card payment (permanent).
- Push notifications from the app (the watcher handles alerts).
- Multi-user / accounts other than the logged-in user.
- Activities other than wakeboarding Tech/Air 30 (config can extend later).
