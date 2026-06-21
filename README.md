# Lagoon Wake Watch

Tracks short-notice **wakeboarding availability at Hove Lagoon** ("Ride the Cables")
by reading the public Lagoon Watersports booking API, so you can grab weekend spots
that come up at the last minute (cancellations / released places).

> Status: live. A **PWA web app** (dave-smith.co.uk/lagoon) reads the Lagoon API
> directly for browsing, and an **AWS Lambda watcher** (`aws/`) polls every 10 min to
> detect weekend releases. The original local macOS watcher has been decommissioned
> now the cloud one is live — see [Roadmap](#roadmap).

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

The "Ride the Cables" courses are Tech 30, Air 30, Tech 15, Air 15. Each is a
`monitor` entry in `courses.json` with an `enabled` flag (defaults to true), so a
session type can be switched off without deleting it. Currently enabled: **Tech 30,
Air 30** (15-min sessions off).

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
         │      │                        │   release detection / logging
         │      ▼                        │   (no alerting yet)
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
| **AWS watcher** | API every 10 min (cloud) | `s3://…/free.json` + release logs | no (separate) |

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
4. **Next** — multi-user alerting (push/email) on top of the watcher; in-app booking.

## Notes

This is a personal convenience tool for an activity the author books regularly; it
makes the same read-only calls the public booking calendar already makes.
