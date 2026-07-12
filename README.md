# Lagoon Wake Watch

Tracks short-notice **wakeboarding availability at Hove Lagoon** ("Ride the Cables")
by reading the public Lagoon Watersports booking API, so you can grab weekend spots
that come up at the last minute (cancellations / released places).

> Status: live. A **PWA web app** (dave-smith.co.uk/lagoon) reads the Lagoon API
> directly for browsing, and an **AWS Lambda watcher** (`aws/`) polls every 10 min to
> detect openings and now **sends Web Push notifications** — per-rider, filtered by
> the days/session-types you ride and can reach (in **beta**: opt in via Settings →
> Beta features). The original local macOS watcher has been decommissioned now the
> cloud one is live — see [Roadmap](#roadmap).

## What's here

| File / dir | Purpose |
|------------|---------|
| `lagoon_client.py` | Reusable API client — search courses, fetch openings, release detection. **Pure Python, no deps** (shared by the AWS Lambda). |
| `check.py` | CLI: print current openings on demand (ad-hoc, runs anywhere). |
| `verify_data.py` | Check the app/client logic against the live API (mapping, free counts, timezone). |
| `courses.json` | Which courses to monitor (resolved to live IDs by name at runtime). |
| `aws/` | The live hosted watcher — Python Lambda + CDK (S3 state, EventBridge schedule). See `aws/README.md`. |
| `app/` | The PWA web app (vanilla JS). See `app/README.md`. |
| `tools/` | One-off helpers (e.g. outage snapshot-page generators). |
| `tests/` | `python3 -m unittest discover -s tests`. |

## The data source

The booking site `booking.lagoon.co.uk` is an Angular app talking to a **public,
unauthenticated** REST API at `https://api.lagoon.co.uk`:

```
GET /public/courses?name=<text>     # search catalogue (also ?id= ?salesCategory= ?itemsPerPage= ?page=)
GET /public/courseRuns?course=<id>  # dated sessions for a course (paginated)
    -> each run: { id, startDate, endDate, maxNumbers, participantsCount }
       free spaces = maxNumbers - participantsCount
```

Gotchas (handled in `lagoon_client.py`):
- Runs come back ordered by **runId (creation order), NOT `startDate`** — dates are
  scattered across every page, and `order[startDate]=asc` is ignored. So we fetch
  **all** pages and filter the horizon client-side; early-exiting on the first
  out-of-horizon run truncates and undercounts (bug fixed 2026-06-20 — see
  `docs/data-accuracy.md`).
- Server also **ignores** date-range params — always returns from today forward.
- Course IDs are resolved **by name at runtime** (whitespace-insensitive, skipping
  `DO NOT USE`/`test`/`closed` decoys) so a renumber fails loudly, not silently.
- It's an internal API and may change without notice.

Session types come from two lists (kept in sync by label):
- **`app/js/config.js` COURSES** — what the **app displays** (availability chips): the
  ride sessions (Air/Tech 30, Air/Tech 15) plus clinics/social (Taster, Jam, Drop-in,
  **Skills**, **Tantrums** kids, **Clinic**). The type-filter chips always show the full
  set; a type with no sessions in the 21-day window renders greyed/disabled so it's clear
  the app *supports* it, just none are open right now.
- **`courses.json`** — what the **watcher monitors + notifies** on (`monitor` entries,
  name-resolved at runtime, each with an `enabled` flag). Currently enabled: **Tech 30,
  Air 30, Skills, Tantrums, Clinic** (Tech/Air 15 present but off).

Adding a *notified* type needs both lists **and** the registration Lambda's `KNOWN_TYPES`,
with matching labels. The Lagoon's **other watersports** (SUP, windsurf, wingfoil, hire/rides)
— which run a schedule, which don't, and what it'd take to track them — are surveyed in
[`docs/other-watersports.md`](docs/other-watersports.md).

## Data flow

The **single source of truth is the live Lagoon API** — every consumer reads from it
directly. We never have our own "availability database" in front of the app; the
free-session list the app shows is computed **in the browser** from a live API read.

```
                       ┌──────────────────────────────────────┐
                       │   LIVE LAGOON API  (source of truth)  │
                       │   https://api.lagoon.co.uk            │
                       │   GET /public/courseRuns?course=<id>  │
                       └─────────┬──────────────────┬──────────┘
            live, per page-load  │                  │ every 10 min (cloud)
                                 ▼                  ▼
         ┌───────────────────────────────┐  ┌───────────────┐
         │  PWA app  (dave-smith.co.uk   │  │ AWS Lambda     │
         │           /lagoon)            │  │ watcher        │
         │  api.js getCourseRuns()       │  │ handler.py     │
         │      │                        │  └──────┬─────────┘
         │      ▼                        │         ▼  free counts
         │  agendaModel.buildAgenda()    │     ┌────────┐
         │   • free = max − participants │     │  S3    │
         │   • drop full, 21-day horizon │     │free.json│
         │   • Europe/London times       │     └───┬────┘
         │   • mark your bookings        │         ▼
         │      │                        │   detect openings → Web Push
         │      ▼                        │   (per-rider filtered, beta)
         │  FREE SESSION LIST            │
         │   (shown to user)             │   ── SEPARATE background system;
         │      │                        │      the app never reads S3, and
         │      ▼                        │      it never feeds the app ──
         │  localStorage 'lagoon.cache'  │
         │   = fallback ONLY when the    │     ┌───────────────────────────┐
         │     live fetch fails entirely │ ··▶ │ static snapshot pages      │
         │     ("Showing saved data")    │     │ /lagoon/sunday.html (S3)   │
         └───────────────────────────────┘     │ /lagoon/week.html (cache)  │
                                              │ frozen outage fallback     │
                                              └───────────────────────────┘
```

**So: the app's free-session list is live Lagoon data + our display logic, computed
client-side per load — not served from any store of ours.** The only time it isn't
live is the explicit *"Showing saved data — couldn't refresh"* banner, when the last
good response is replayed from the browser cache.

The two readers are independent and never feed each other:

| Reader | Reads | Produces | Used by app? |
|--------|-------|----------|--------------|
| **PWA app** | API live, every load | the free-session list (in-browser) | — it *is* the app |
| **AWS watcher** | API every 10 min (cloud) | `s3://…/free.json` + **per-rider Web Push** on openings | no (separate — push is a *nudge* to open the app, which then reads live) |

### Freshness: why the app reads live, not our polled data

Polled data is **up to 10 minutes stale** — a slot the watcher last saw as free may
have been booked in the gap before its next run. That's fine for the watcher's job
(*"ping me when something opens"*, then you check the live site), but it would be
**wrong to present as bookable truth**: someone could act on a spot that's already
gone.

That's exactly why the **app reads the API live on every load** rather than serving
the watcher's S3 data. A free session shown in the app reflects the API *at that
moment* — the only race left is the universal one any booking system has (someone
books in the seconds between your load and your tap), not a 10-minute window. The
only place polled/frozen data was ever shown as availability is the static
`/lagoon/*.html` **outage** exports — and those are explicitly stamped *"Snapshot,
not live"* (see `tools/build_snapshot.py` / `tools/build_week.py`). They're frozen
and don't auto-update.

See `docs/data-accuracy.md` for how the app's logic is verified against the live API
(`verify_data.py`).

## Usage

```sh
# Ad-hoc openings from the live API (runs anywhere — no state, no schedule)
python3 check.py                 # all openings, next 21 days
python3 check.py --weekend       # weekends only
python3 check.py --days 14 --json

# Verify the client/app logic against the live API
python3 verify_data.py           # course mapping, free counts, timezone

# Tests
python3 -m unittest discover -s tests
```

The scheduled watcher now runs in the cloud — see **`aws/README.md`** to build,
deploy, and inspect it. The PWA web app is in **`app/`** (see `app/README.md`).

## Roadmap

1. **Local CLI + notifier** — *done, then retired.* The original macOS launchd watcher
   (`watch.py` + `run_watch.sh` + `launchd/`) is decommissioned now the cloud watcher
   is live; its release-detection core lives on in `lagoon_client.py`.
2. **Hosted watcher on AWS** — *done* (`aws/`). EventBridge-scheduled Python Lambda
   reusing `lagoon_client.py`, free-count state in S3, release detection logged to
   CloudWatch.
3. **Web app** — *done* (`app/`, live at dave-smith.co.uk/lagoon). Vanilla-JS PWA that
   calls the public API directly for live browsing.
4. **Multi-user push notifications** — *done, **GA** (live for everyone; enable in
   Settings → Notifications).* Built in three stages on top of the watcher: **Web Push**
   (VAPID keypair — private in SSM, public in the client) sent from the watcher via
   `pywebpush`, stored subscriptions + prefs in **DynamoDB**, a **registration Lambda**
   (function URL) the client subscribes to. Each rider is filtered server-side by their
   chosen **days / session types / travel-time reachability**, within a 7-day horizon,
   with dedupe, a daily cap, coalescing and quiet hours (21:00–08:00, held-then-delivered).
   Tapping a notification **deep-links to the freed slot's Day view**. Shipped internal →
   beta → GA; the feature flag has been retired. See `aws/README.md` and the
   `docs/superpowers/specs|plans/2026-07-*-push-notifications-*` design docs.
5. **Next** — in-app (no-payment) booking; reconcile notification prefs app↔server
   (see `docs/BACKLOG.md`).

## Running costs (AWS)

**Effectively free** — the whole backend is a rounding error. Measured drivers
(eu-west-1): the watcher runs ~3,400×/month at ~8 s each (256 MB) ≈ **6,700 GB-s**,
which is ~1.7% of the perpetual Lambda free tier (400,000 GB-s + 1 M requests/month).
Everything else is negligible: DynamoDB (1 subscription, ~1 KB, pay-per-request), S3
(state = <1 KB; CloudFront logs ~7 MB with 90-day expiry), CloudWatch Logs (1-month
retention), and SSM standard SecureString + KMS decrypts. EventBridge scheduling, the
Lambda function URL, and the Web Push sends themselves cost nothing.

| Component | Cost |
|-----------|------|
| Watcher Lambda (every 10 min) | **$0** (well within the free tier) |
| DynamoDB · S3 · CloudWatch · SSM/KMS | ~**$0.05/month** combined |
| EventBridge · Function URL · Web Push | **$0** |
| **Total** | **~$0/month** (≤ ~$0.20 on a mature account with no free tier) |

Going **GA** (notifications for everyone) doesn't move the needle: even ~100 subscribers
is roughly $0.50/month more of DynamoDB writes — still well under **$1/month** total.
The site itself (CloudFront/S3 for dave-smith.co.uk) is a separate, pre-existing cost and
tiny at this traffic. (Site hosting + cache-control specifics live in `app/README.md`.)

## Notes

This is a personal convenience tool for an activity the author books regularly; it
makes the same read-only calls the public booking calendar already makes.
