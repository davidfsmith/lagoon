# Lagoon Wake Watch

Tracks short-notice **wakeboarding availability at Hove Lagoon** ("Ride the Cables")
by reading the public Lagoon Watersports booking API, so you can grab weekend spots
that come up at the last minute (cancellations / released places).

> Status: early local tooling. Endgame is a hosted service on AWS
> (Lambda on a schedule + DynamoDB for state + push/email alerts), with a small
> web app on top — see [Roadmap](#roadmap).

## What's here

| File | Purpose |
|------|---------|
| `lagoon_client.py` | Reusable API client — search courses, fetch openings. **Pure Python, no deps** (portable to Lambda). |
| `check.py` | CLI: print current openings on demand. |
| `watch.py` | Logs all openings; alerts (`URGENT`) only on **releases** — a slot's free count rising — within a short-notice window. |
| `analyze.py` | Reads `state/history.jsonl` → churn / lead-time / heatmap report. |
| `schedule_policy.py` | When a firing should run (build vs production cadence). |
| `courses.json` | Which courses to monitor (resolved to live IDs by name at runtime). |
| `run_watch.sh` | Wrapper run by the scheduler; raises a macOS notification only on short-notice (`URGENT`) slots. |
| `launchd/` | Local macOS schedule (LaunchAgent) + install/uninstall scripts. |
| `state/` | Runtime state & logs (git-ignored). |

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
                         │   LIVE LAGOON API  (source of truth) │
                         │   https://api.lagoon.co.uk           │
                         │   GET /public/courseRuns?course=<id> │
                         └───────┬─────────────┬───────────┬────┘
              live, per page-load│             │every 10min│every 10min
                                 │             │(cloud)    │(local Mac)
                                 ▼             ▼           ▼
         ┌───────────────────────────────┐ ┌───────────┐ ┌──────────────┐
         │  PWA app  (dave-smith.co.uk   │ │ AWS Lambda│ │ launchd watch│
         │           /lagoon)            │ │ watcher   │ │  watch.py    │
         │  api.js getCourseRuns()       │ │ handler.py│ │ (this repo)  │
         │      │                        │ └────┬──────┘ └──────┬───────┘
         │      ▼                        │      │ free counts   │ release
         │  agendaModel.buildAgenda()    │      ▼               ▼ detection
         │   • free = max − participants │  ┌──────────┐   macOS alert +
         │   • drop full, 21-day horizon │  │   S3     │   state/*.jsonl
         │   • Europe/London times       │  │free.json │   (local logs)
         │   • mark your bookings        │  └───┬──────┘
         │      │                        │      │ (release logging only;
         │      ▼                        │      │  no alerting yet)
         │  FREE SESSION LIST  ◄─────────┼──────┘
         │      │  (shown to user)       │   NOT used by the app —
         │      ▼                        │   separate background system
         │  localStorage 'lagoon.cache'  │
         │   = fallback ONLY when the    │      ┌───────────────────────────┐
         │     live fetch fails entirely │ ···▶ │ static snapshot pages     │
         │     ("Showing saved data")    │      │ /lagoon/sunday.html (S3)  │
         └───────────────────────────────┘      │ /lagoon/week.html (cache) │
                                                │ frozen outage fallback    │
                                                └───────────────────────────┘
```

**So: the app's free-session list is live Lagoon data + our display logic, computed
client-side per load — not served from any store of ours.** The only time it isn't
live is the explicit *"Showing saved data — couldn't refresh"* banner, when the last
good response is replayed from the browser cache.

The three readers are independent and never feed each other:

| Reader | Reads | Produces | Used by app? |
|--------|-------|----------|--------------|
| **PWA app** | API live, every load | the free-session list (in-browser) | — it *is* the app |
| **AWS watcher** | API every 10 min (cloud) | `s3://…/free.json` + release logs | no (separate) |
| **launchd watcher** | API every 10 min (this Mac) | macOS alerts + `state/*.jsonl` | no (separate) |

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
# On-demand
python3 check.py                 # all openings, next 21 days
python3 check.py --weekend       # weekends only
python3 check.py --days 14 --json

# Watcher (alerts only on releases within the short-notice window, default 48h)
python3 watch.py                 # weekend slots, next 14 days
python3 watch.py --all --days 21 # include weekdays
python3 watch.py --urgent-hours 24  # tighten the short-notice window
python3 watch.py --reset         # forget free-count state
```

`watch.py` prints a marker first line — `URGENT: <n>` (places **released** within
the window — a slot's free count rose since last run) or `NONE` — so a scheduler
can key off it. Standing availability never alerts (browse it in the app); only
genuine releases do. Tracking free counts per slot (`state/free.json`) dedupes
naturally: a release pings once; a spot booked then freed again pings again.
First run records a baseline and never alerts.

## Local schedule (current setup)

Runs on this Mac via launchd. The agent **fires every 10 minutes**; `run_watch.sh`
then applies a schedule policy (`schedule_policy.py`) so only the right firings do
real work:

- `LAGOON_MODE=build` (default, while building) — every firing runs (~every 10 min,
  24/7) for dense test data.
- `LAGOON_MODE=production` — weekdays hourly; weekends every 10 min 08:00–16:00
  (the short-notice window). Switch by changing the default in `run_watch.sh` or
  setting the env var.

History (`state/history.jsonl`) always records **all** openings (weekday + weekend);
notifications are weekend-only by default and fire only for short-notice (`URGENT`)
slots — far-future availability is logged but stays quiet.

```sh
launchd/install.sh        # render plist + load the LaunchAgent
python3 watch.py >/dev/null   # prime alert state (so the first run only shows genuinely new urgent slots)
launchctl kickstart -k gui/$(id -u)/uk.co.lagoon.wakewatch   # test run now
launchd/uninstall.sh      # remove the schedule
```

Logs land in `state/`: `watch.log` (one line per run), `notified.log` (full detail
when slots are found), `launchd.*.log`.

To change cadence, edit the `StartCalendarInterval` entries in
`launchd/uk.co.lagoon.wakewatch.plist` and re-run `install.sh`.

## Analysing the data

Once the watcher has run for a while:

```sh
python3 analyze.py            # weekend churn, lead times, availability heatmap
python3 analyze.py --all      # include weekdays (scope=all records)
python3 analyze.py --events   # raw appearance/booking events
python3 analyze.py --json
```

Key outputs and why they matter for the AWS build:
- **Appearances by lead time** — how far ahead short-notice spots show up → how
  often the schedule actually needs to fire (and the 10th-percentile hint).
- **Bookings by lead time** — how fast released spots get taken → how stale an
  alert can be before it's useless.
- **Weekday × hour heatmap** — when availability exists at all → confirms (or
  refutes) "weekday hourly is enough".

## Roadmap

1. **Local CLI + notifier** — *done* (this repo).
2. **Hosted watcher on AWS** — `watch.py`'s core (`lagoon_client.py`) is dependency-free
   and side-effect-free, so the fetch/diff logic lifts into a Lambda. Swap the
   `state/seen.json` file for a DynamoDB table (PK = slot key); alert via SNS
   (push/SMS) or SES (email).
3. **Web app** — a small static PWA (mirroring `daves-adventures/site/static/compose`:
   self-contained `index.html` + manifest + service worker) that calls the same
   public API directly for live browsing, with the Lambda handling background alerts.

## Notes

This is a personal convenience tool for an activity the author books regularly; it
makes the same read-only calls the public booking calendar already makes.
