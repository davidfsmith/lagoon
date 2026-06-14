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
| `watch.py` | Diffs against last run's state and reports only **new** openings. |
| `analyze.py` | Reads `state/history.jsonl` → churn / lead-time / heatmap report. |
| `schedule_policy.py` | When a firing should run (build vs production cadence). |
| `courses.json` | Which courses to monitor (resolved to live IDs by name at runtime). |
| `run_watch.sh` | Wrapper run by the scheduler; raises a macOS notification on new slots. |
| `launchd/` | Local macOS schedule (LaunchAgent) + install/uninstall scripts. |
| `state/` | Runtime state & logs (git-ignored). |

## The data source

The booking site `booking.lagoon.co.uk` is an Angular app talking to a **public,
unauthenticated** REST API at `https://api.lagoon.co.uk`:

```
GET /public/courses?name=<text>     # search catalogue (also ?id= ?salesCategory= ?itemsPerPage= ?page=)
GET /public/courseRuns?course=<id>  # dated sessions for a course, sorted ascending from today
    -> each run: { startDate, endDate, maxNumbers, participantsCount }
       free spaces = maxNumbers - participantsCount
```

Gotchas (handled in `lagoon_client.py`):
- Server **ignores** date-range params — always returns from today forward, so we
  filter the horizon client-side and stop paginating once we pass it.
- Course IDs are resolved **by name at runtime** (whitespace-insensitive, skipping
  `DO NOT USE`/`test`/`closed` decoys) so a renumber fails loudly, not silently.
- It's an internal API and may change without notice.

The "Ride the Cables" courses are Tech 30, Air 30, Tech 15, Air 15. Each is a
`monitor` entry in `courses.json` with an `enabled` flag (defaults to true), so a
session type can be switched off without deleting it. Currently enabled: **Tech 30,
Air 30** (15-min sessions off).

## Usage

```sh
# On-demand
python3 check.py                 # all openings, next 21 days
python3 check.py --weekend       # weekends only
python3 check.py --days 14 --json

# Watcher (only reports what's newly appeared since last run)
python3 watch.py                 # weekend slots, next 14 days
python3 watch.py --all --days 21 # include weekdays
python3 watch.py --reset         # forget state
```

`watch.py` prints a marker first line — `NEW: <n>` or `NONE` — so a scheduler can
key off it.

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
notifications are weekend-only by default. macOS notifications fire on new slots.

```sh
launchd/install.sh        # render plist + load the LaunchAgent
python3 watch.py >/dev/null   # prime state so the first run only shows NEW
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
