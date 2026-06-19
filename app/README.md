# Hove Lagoon — PWA

Read-only companion: your bookings, membership, ride-pass tokens, and a weather-aware
availability agenda for Tech/Air 30 wakeboarding sessions. Static, no build step.

## Run
    cd app && python3 -m http.server 8077
    # open http://localhost:8077, sign in with your Lagoon account

## Test
    cd app && node --test

## Design
See ../docs/superpowers/specs/2026-06-14-lagoon-pwa-design.md

Booking is deep-linked to booking.lagoon.co.uk in v1; in-app (no-payment) booking is a
later phase. No card payments, ever.

## Deployment

The app's **single source is this repo** (`davidfsmith/lagoon`, `app/`). It is served at
**https://www.dave-smith.co.uk/lagoon/** by the **`davidfsmith/daves-adventures`** site:
its deploy workflow clones lagoon `main`, copies `app/` → `site/static/lagoon/`, stamps
`APP_VERSION` from the lagoon short-SHA + date, builds Hugo, and ships to S3/CloudFront.

To ship an app change: **push to lagoon `main`, then run the daves-adventures deploy**
(`gh workflow run deploy.yml -R davidfsmith/daves-adventures`). A lagoon push alone does
not auto-deploy. The service worker is network-first, so clients pick up changes on next
load (bump `CACHE` in `sw.js` when adding files).

### ⚠️ Deploy cache-control gotcha (daves-adventures `deploy.yml`)
The site moved from GitHub Pages to AWS S3/CloudFront (June 2026). The AWS deploy's
"immutable, 1 year" S3 sync uses `--include "*.js"`, which is correct for Hugo's
content-hashed assets but **must NOT apply to this app's fixed-name files**
(`/lagoon/js/*.js`, `/lagoon/sw.js`) — immutable caching freezes returning browsers on a
stale build and breaks the network-first auto-update. `deploy.yml` must carve `/lagoon/*`
into its own short-cache set:
- add `--exclude "lagoon/*"` to the immutable step (and the other two syncs), and
- add a dedicated `aws s3 sync … --exclude "*" --include "lagoon/*" --cache-control
  "public, max-age=300, must-revalidate"` step.

Verify after deploy: `curl -sI https://www.dave-smith.co.uk/lagoon/js/app.js | grep -i
cache-control` should show `max-age=300, must-revalidate` (NOT `immutable`). This fix
lives in the daves-adventures repo, not here.
