# Hove Lagoon — PWA

Read-only companion: your bookings, membership, ride-pass tokens, and a weather-aware
availability agenda for the cable wakeboarding sessions (Tech/Air 30 & 15, plus clinics —
Taster, Jam, Drop-in, Skills, Tantrums, Clinic). Type-filter chips always show the full
set, greyed when nothing's available in the 21-day window. Static, no build step.

**Push notifications (beta)** — opt in via Settings → Beta features to get a Web Push when
a spot opens on the days / session types you ride and can reach; tapping deep-links to the
freed slot's Day view. Pick your days / types / travel time in Settings. The server side
(subscription store + per-user filter + sender) is the AWS watcher — see `../aws/README.md`.
Bump `CACHE` in `sw.js` **and** `APP_RELEASE` in `js/config.js` together every release.

## Run
    cd app && python3 -m http.server 8077
    # open http://localhost:8077, sign in with your Lagoon account

## Test
    cd app && node --test

## Design
See ../docs/superpowers/specs/2026-06-14-lagoon-pwa-design.md

Booking is deep-linked to booking.lagoon.co.uk in v1; in-app (no-payment) booking is a
later phase. No card payments, ever.

**Booking limit:** an account can hold at most ~4 booked (upcoming) sessions at once —
new bookings are refused past that until a session is ridden or cancelled. (Number is
from memory, not yet confirmed against the API.) This caps the per-rider cancel
live-test: a throwaway test booking needs a free slot under the limit first.

## Deployment

The app's **single source is this repo** (`davidfsmith/lagoon`, `app/`). It is served at
**https://www.dave-smith.co.uk/lagoon/** by the **`davidfsmith/daves-adventures`** site:
its deploy workflow clones lagoon `main`, copies `app/` → `site/static/lagoon/`, stamps
`APP_VERSION` from the lagoon short-SHA + date, builds Hugo, and ships to S3/CloudFront.

To ship an app change: **push to lagoon `main`, then run the daves-adventures deploy**
(`gh workflow run deploy.yml -R davidfsmith/daves-adventures`). A lagoon push alone does
not auto-deploy. The service worker is network-first, so clients pick up changes on next
load (bump `CACHE` in `sw.js` when adding files).

### Deploy cache-control — `/lagoon/*` must not be immutable
The site is served from AWS S3/CloudFront (cutover June 2026). The AWS deploy's
"immutable, 1 year" S3 sync (`--include "*.js"`) is right for Hugo's content-hashed
assets, but this app's files are **fixed-name** (`/lagoon/js/*.js`, `/lagoon/sw.js`) —
immutable caching would freeze returning browsers on a stale build and break the
network-first auto-update. So `/lagoon/*` is synced as a **dedicated
`max-age=300, must-revalidate` disjoint set**, carved out of the immutable rule.

**Resolved + verified** in the daves-adventures `deploy.yml` (commit `7a70063`):
immutable applies only to Hugo's hashed assets. If you ever touch that workflow, keep
the carve-out. Verify: `curl -sI https://www.dave-smith.co.uk/lagoon/js/app.js | grep -i
cache-control` → `max-age=300, must-revalidate` (NOT `immutable`). This lives in the
daves-adventures repo, not here.
