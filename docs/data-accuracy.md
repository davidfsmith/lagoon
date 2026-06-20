# Data accuracy — how the app's numbers are verified

The app and the watcher both derive availability from the same public Lagoon API.
This note records how that data is shaped, the two non-obvious traps that can make
it *wrong*, and the one command that re-checks everything.

## TL;DR — re-verify any time

```sh
python3 verify_data.py          # hits the live API, exits 0 if all good
```

Checks: (1) course IDs still map to the expected names, (2) the free-slot count the
code produces == an independent recomputation from the API, (3) the timezone ground
truth below. Run it whenever you suspect the app is showing the wrong thing.

## What the app shows

For each enabled course it lists sessions with **at least one free space** in the
next 21 days:

```
free spaces = maxNumbers − participantsCount        (per courseRun)
show if     = free > 0  AND  now < startDate ≤ now + 21 days
```

Enabled courses (`courses.json` / `app/js/config.js`): **Tech 30 (id 50)** and
**Air 30 (id 51)**. Times are session start in **Europe/London**.

## Trap 1 — runs are ordered by runId, NOT date

`GET /public/courseRuns?course=<id>` returns runs ordered by **runId (creation
order)**. Start dates are **scattered across every page**, and `order[startDate]=asc`
is ignored by the server. `filteredCount` can be 400+ runs over several pages.

**The bug this caused (fixed 2026-06-20):** both code paths assumed ascending
`startDate` and stopped early — `fetch_openings` did `return out` on the first
out-of-horizon run; the app's `getCourseRuns` broke pagination when a page's last
run was beyond the horizon. Because dates are scattered, a single far-future session
mid-pagination aborted the scan and **dropped in-horizon sessions on later pages** —
the app undercounted (e.g. showed 78 Air slots when 93 were free).

**The fix:** fetch *all* pages (drive pagination by `filteredCount` only), then
filter by horizon. Never early-exit on a `startDate` comparison.
Guards: `tests/test_fetch_openings.py`, `app/test/api.test.js`.

## Trap 2 — the API stamps UTC, even in summer

Every `startDate` carries a `+00:00` offset **even during British Summer Time**. It
is genuine UTC, so London display is **+1h** in summer. Reading the hour off the raw
string lands every session an hour early.

**Ground truth (externally verifiable):** lagoon.co.uk advertises the Wednesday
"Jam Sessions" as **6pm & 7pm** UK local. The API returns those same Wednesday runs
(course 478) stamped **17:00** and **18:00** `+00:00` — confirming `+00:00` is UTC
and London is +1h in summer.

| Advertised (London) | API raw stamp           | = BST (+1h) |
|---------------------|-------------------------|-------------|
| 6pm                 | `…T17:00:00+00:00` (Wed)| 18:00       |
| 7pm                 | `…T18:00:00+00:00` (Wed)| 19:00       |

Conversion lives in `app/js/tz.js` (`londonParts`) and `lagoon_client.py`
(`Slot.local`). Guards: `app/test/tz.test.js`, `tests/test_tz.py`.

## Course-ID reference (live wakeboard "Ride the Cables" sessions)

Verified against the catalogue 2026-06-20. IDs are stable but resolved by name at
runtime so a renumber fails loudly.

| id  | session                              | in app? |
|-----|--------------------------------------|---------|
| 50  | Wakeboard Tech – Ride Session 30     | ✅ core (default) |
| 51  | Wakeboard Air – Ride Session 30      | ✅ core (default) |
| 714 | Wakeboard Tech – Ride Session 15     | ✅ extra (filter) |
| 713 | Wakeboard Air – Ride Session 15      | ✅ extra (filter) |
| 9   | Wakeboard Taster                     | ✅ extra (filter) |
| 478 | Clinic Wakeboard – Jam session       | ✅ extra (filter) |
| 586 | Clinic Wakeboarding – Drop-in Ride   | ✅ extra (filter) |
| 8   | Wakeboard – Private Cable Hire 60min | not added |
| 66  | Clinic – Wakeboard                   | not added |

(`701`/`702` are `DO NOT USE` decoys for the old 15-min sessions — skipped by the
name resolver. The live 15-min sessions are `713`/`714`.)
