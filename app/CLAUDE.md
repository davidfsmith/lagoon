# Hove Lagoon app — contributor notes

Hello! This is the wakeboarding-availability web app at **dave-smith.co.uk/lagoon**.
It's open source and contributions are welcome — these are the working notes for
anyone (human or AI assistant) hacking on the `app/` folder. Keep it friendly and
keep it simple: the whole point of this app is that it's tiny and has no build step.

> This file is auto-read by Claude Code when working in `app/`. It's also just a
> good orientation doc — start here.

## What it is

A **PWA** (installable web app) that shows live wakeboarding availability at Hove
Lagoon, your bookings, ride-pass tokens, and the weather per session. It reads the
**public Lagoon booking API directly, live, every time you open it** — there's no
server of ours in the middle. See `../README.md` for the full data-flow picture.

It also does **push notifications** (a spot opened on your days/types — sent by the AWS
watcher in `../aws/`), a **Last-minute** tab, and a **History** tab (your past sessions +
a ride streak). All live/GA. See `../README.md` roadmap for the feature list.

No payments, ever. It's read-only browsing + cancelling your own places (a real
write). In-app booking may come later, but never card payments.

## Ground rules (please keep these)

- **Vanilla JS, ES modules, no build, no dependencies, no framework.** If you're
  reaching for npm or a bundler, stop — it doesn't belong here. Plain `.js` files
  the browser runs as-is.
- **No secrets in the repo** — it's public. The app only ever stores a Lagoon
  *access token* in `localStorage` (never username/password), and never commits it.
- **Match the surrounding style.** Small focused files, terse comments that explain
  *why* not *what*.

## Run & test locally

```sh
# serve the app folder (any static server works)
cd app && python3 -m http.server 8000
# open http://localhost:8000  — login hits the real Lagoon API (CORS allows it)

# tests (Node's built-in runner, no deps)
node --test app/test/*.test.js
```

Tests are **fully mocked** — they pass a stub `fetch` or inject data, so they never
hit the network. Add tests the same way (see `app/test/api.test.js` for the pattern).

## Layout

```
app/
  index.html        — shell: header, bottom nav (Availability · Last-minute · Bookings), theme
                       palette, injects the <base> + entry module, registers the service worker
  sw.js             — service worker: network-first for the app shell/code, never caches the
                       Lagoon/weather APIs; push + notificationclick handlers. CACHE + ASSETS list.
  manifest.json     — PWA manifest (icons, name, standalone)
  js/
    config.js       — all the knobs: API_BASE, COURSES, BOOKING_LIMIT, HORIZON_DAYS, FEATURES,
                       VAPID_PUBLIC_KEY, PUSH_REGISTER_URL, APP_RELEASE/APP_VERSION
    api.js          — thin Lagoon API client: login, authedGet, getCourseRuns, cancelParticipant
    data.js         — loadEverything(): fetches bookings/memberships/courses/weather, builds the agenda
    model.js        — pure data logic: runsToSlots, slotKey, free-count, bookingKeys, groupByDay
    agendaModel.js  — assembles the day-by-day agenda from runs + bookings + weather
    historyModel.js — pure past-session history + stats (pastSessions: list, totals, ride streak)
    tz.js           — Europe/London conversion (londonParts). ALWAYS use this for times (see Gotchas)
    weather.js      — Open-Meteo fetch + parse + attach-to-slot
    store.js        — localStorage: token, cache fallback, notif prefs, feature-flag opt-ins
    features.js     — feature-flag helpers: isOn / accessTier / isBetaUser (see below)
    theme.js        — light / dark / system
    filters.js      — the per-type filter (chips + selection), SHARED by agenda + day so they agree
    tabs.js         — shared tab-bar markup/styles (Bookings + Settings sub-tabs)
    push.js         — Web Push client: subscribe/unsubscribe/syncPrefs/suppressSlot + prefsEqual
    deeplink.js     — parse a #day/<date>/<key> hash (notification-tap deep-links)
    calendar.js     — .ics add-to-calendar export for a booking
    pullToRefresh.js— pull-down-to-refresh gesture
    refreshedTicker.js — live "X ago" ticker for "Last refreshed"
    intro.js        — first-run welcome carousel (shown once; replayable from Settings)
    app.js          — the router: go(route, arg), boot, reload/refresh
    views/          — one file per screen, each exports render<Name>(view, state, go):
                      login, agenda, day, lastminute, account (Bookings + Extras + History),
                      history, settings, format (shared helpers incl. sessionWx/dayWx/prettyCourse)
  test/             — node --test, *.test.js, all mocked
```

## How a screen works

Each view is a function `renderX(view, state, go)` that:
1. builds an HTML string and sets `view.innerHTML`,
2. wires up event listeners (and calls `go("route")` to navigate),
3. injects its own `<style>` once, guarded by an element id (`injectXStyles`).

`app.js` holds the router (`go`) and the loaded `state` (me, bookings, memberships,
packages, agenda, refreshedAt, stale). Data is live-loaded in `data.js`; the
`localStorage` cache is **only** a fallback shown with a "Showing saved data" banner
when the live fetch fails.

## Feature flags & beta / hidden features

New work is gated behind **client-side opt-in tiers** so it can ship to `main` (and go
live) before it's ready for everyone. The machinery lives in `js/features.js` +
`js/store.js`; declare a flag's tier in `js/config.js` `FEATURES` and check it with
`isOn("myFlag")`.

**Two tiers** (both plain `localStorage` opt-ins — no allowlist, no server):

- **`internal`** — hidden developer tier for half-built features. Unlocked by tapping the
  About version row 7×; toggled off in the Settings *Developer* section. Shows a `DEV` badge.
- **`beta`** — public, always-visible *Beta features* toggle in Settings, for
  works-but-not-GA features. Shows a `BETA` badge. `internal` is a superset of `beta`.

Lifecycle: gate `internal` while building → promote to `beta` when it works → `on` (or
delete the flag) at GA. No deploy needed to move a user between tiers.

**The golden rule: gating is *additive*, never *destructive*.** A flag may **add** a new
capability or **offer an alternative** path — it must never remove, degrade, or change the
existing GA path. A non-opted-in user must execute the *current* code, unchanged. So all
beta code lives behind the `isOn(flag)` guard (default off); "current functionality is
unaffected" is then structurally true, not just hoped for.

This takes two shapes:

- **Purely additive** (e.g. push notifications) — no existing equivalent, so opt in → new
  UI appears, opt out → it's simply absent. Nothing to reconcile.
- **Dual-flow** — a *rework* of something that already exists. The current flow and the
  new beta flow coexist. Rules:
  - **Gate at the smallest seam** — branch at the entry point, don't fork a whole view
    into two parallel files. The live path stays literally untouched.
  - **Share the data model** — both flows read/write the *same* state and storage. Fork
    presentation, converge data — so opting out (and GA cleanup) stays clean.
  - **Beta flow is primary, old flow is a fallback link** for opted-in users, and the
    global Beta toggle is the ultimate escape hatch. So a beta user can always get back to
    the working flow without a deploy.
  - **At GA the duality ends** — the new flow becomes the only flow, the old code is
    deleted, and the flag is removed. The two-flow period is temporary scaffolding.

## ⚠️ Two rules that bite if you forget them

1. **Bump the version when you add/remove/rename a file or change cached code.**
   Edit `sw.js` → `const CACHE = "lagoon-vNN"` **and** `js/config.js` →
   `APP_RELEASE = "vNN"` together (keep them in sync — bump to the next number each
   release). If you add a new JS file, also add it to the `ASSETS` list in `sw.js`.
   Without the bump, returning users get stale code.

2. **Times: only ever convert via `tz.js` (`londonParts`).** The Lagoon API serialises
   every session as UTC with a `+00:00` offset **even in summer (BST)**. Reading the
   hour off the raw string lands sessions an hour early. `tz.js` converts to
   Europe/London correctly. (There's a ground-truth test in `test/tz.test.js`.)

## Other gotchas (all handled — don't undo them)

- **courseRuns are ordered by runId (creation order), NOT by date.** Dates are
  scattered across pages, so `getCourseRuns` fetches *all* pages and filters the
  horizon client-side. Don't add an early-exit on a date comparison — it undercounts.
  (See `../docs/data-accuracy.md`.)
- **Live, not cached.** Show the API as it is *right now*; don't wire the app to the
  AWS watcher's stored data — that's a separate background system and is up to 10 min
  stale (fine for alerts, wrong for "is this bookable").
- Course IDs/labels live in `config.js` `COURSES` (filter chips are driven by `group`
  + `extra`). To add a session type: add an entry there, then bump the version.

## Contributing & deploying

`main` is **protected — no direct pushes**. Work on a branch and **open a PR**; CI
(offline tests) must pass to merge. Install the hooks once: `pip install pre-commit
&& pre-commit install --install-hooks` (see `../CONTRIBUTING.md`).

You don't deploy from here directly. This repo is the **single source**: once a PR is
merged to `main`, the dave-smith.co.uk site's CI ("Deploy Hugo Site (AWS)") clones
`app/` into its static site, stamps `APP_VERSION` with the commit SHA + date, and
ships it to S3/CloudFront — live on the next site build. (`APP_VERSION` shows as
`"dev"` locally — expected; it's filled in at deploy.)

## Where to look next

- `app/README.md` — deploy details + the cache-control note.
- `../README.md` — the whole system + data-flow diagram.
- `../docs/data-accuracy.md` — the API quirks and how the logic is verified.
- `../aws/README.md` — the cloud watcher (separate from the app).

Ideas, fixes, new session types, nicer UI — all welcome. Have fun, ride safe. 🏄
