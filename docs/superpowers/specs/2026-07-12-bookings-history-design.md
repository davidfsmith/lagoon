# Bookings History — design

**Status:** approved shape, gated `internal` for the first release.
**Date:** 2026-07-12

## Goal

Give riders a **History** view of their past Hove Lagoon sessions — a reverse-chronological
log topped with a small, glanceable stats strip — reusing booking data the app *already*
loads. No new API calls, no server/AWS work.

## Non-goals

- **No spend/cost** anywhere (deliberate — can be added later).
- **No attendance/sign-in logic.** `signInDate` is recorded on only ~20% of past sessions
  (21/104 on the reference account) despite near-100% real attendance, so it's unreliable —
  we ignore it entirely.
- **No cancellation handling.** The reference account has zero past cancellations; a held
  booking is simply one that's `confirmed` and not cancelled.
- No new network/AWS/watcher involvement — pure client-side presentation.

## Gating

New feature flag **`FEATURES.history = "internal"`** in `app/js/config.js`. The History tab
and its logic are wrapped in `isOn("history")`, so:

- **Off (everyone):** the Bookings screen is exactly as today — `Bookings · Extras` tabs, no
  change to any existing path (additive, per `app/CLAUDE.md`).
- **On (`internal` = dev, unlocked by the 7-tap):** a third **History** tab appears.

Lifecycle: ship `internal` → promote `beta` → `on` → delete the flag, same as notifications.

## Data

Source is the `meBookings` array already in `state` (fetched via `authedGet("me/bookings")`
in `data.js`). No new fetch.

**A history entry = a past held booking:**
- `courseRun.startDate` exists and is `< now`, and
- `status === "confirmed"`, and
- not cancelled (`cancelledAt` falsy) and not cancelled-down-to-zero-riders
  (reuse `bookingIsHeld` / `activeParticipants` from `model.js`).

The far-future placeholder rows (e.g. a package's `2026-12-31` entry) are naturally excluded
because they're not in the past.

## Components

### 1. Stats strip (five stats, no money)

| Stat | Definition |
|------|------------|
| **Total all-time** | count of past held bookings (e.g. "104 rides") |
| **This year** | of those, `startDate` in the current calendar year (e.g. "18 in 2026") |
| **Ride streak** | consecutive **Monday-anchored London weeks** with at least one ridden session, counting back from the most recent ride (e.g. "🔥 5-week streak"). See definition below. |
| **Per-rider** | count of bookings each `participant.contact` appears on — "You 71 · Hamish 33". A session with two riders counts for both, so the split can sum above the total (honest). "You" = the logged-in `me.id`; others by `contact.firstName`. |
| **Favourite** | most-frequent prettified session type, and most-frequent weekday (London tz) — "Most: Air 30 · Saturdays" |

**Ride streak definition (precise, to avoid ambiguity):**
- Bucket every past ridden session into the **Monday** of its London week: take `londonParts(startDate).date`, then step back to that week's Monday. Key = that Monday's `YYYY-MM-DD`. (Monday-anchored avoids ISO week-number year-boundary bugs; consecutive weeks are Mondays exactly 7 days apart.)
- Let `W` = the set of week-Mondays that contain ≥1 ride. Let `latest` = the most recent Monday in `W`.
- **Live check:** the streak only counts as *current* if `latest` is **this week's or last week's** Monday (relative to `now` in London). This keeps a weekend rider's streak alive mid-week before their session, and for one full grace week after. If the latest ride is older than that, the current streak is **0**.
- **Count:** if live, walk back from `latest` while each preceding Monday (−7 days) is also in `W`; the streak is the run length (in weeks).
- Whole-household basis (any rider's ride keeps the streak), matching the "rides" total. All riders pooled — not per-rider.

### 2. The list

- **Grouped by calendar year**, year headers, newest first.
- **Row:** date (`fmtDate` on the London date) · prettified type · rider tag.
  - Type names are ugly in the API (`"2026 Wakeboard -Tech - Ride Session 30"`) → reuse the
    existing **`prettyCourse`** helper → "Tech 30".
  - **Rider tag** shows only riders who are *not* the logged-in user (so most of Dave's own
    rows are untagged; a Hamish session tags "Hamish"; a shared session tags "Hamish"). Keeps
    the list uncluttered.
- Shows **all** past session types (private hire, taster, clinics, ride sessions) — not just
  the availability-filter `COURSES` list.

### 3. Empty state

A brand-new member with no past sessions → a friendly single line, e.g.
"No past sessions yet — they'll show here after you've ridden."

## Layout sketch

```
┌────────────────────────────────────┐
│ Bookings · Extras · [History]      │
├────────────────────────────────────┤
│  104 rides         18 in 2026       │
│  🔥 5-week streak                   │
│  You 71 · Hamish 33                 │
│  Most: Air 30 · Saturdays           │
├─ 2026 ─────────────────────────────┤
│  Sat 5 Jul · Air 30                 │
│  Sun 29 Jun · Tech 30      Hamish   │
├─ 2025 ─────────────────────────────┤
│  Mon 12 Aug · Tech 30               │
│  … (104 past sessions)              │
└────────────────────────────────────┘
```

## Files

- **`app/js/historyModel.js`** *(new, pure)* — `pastSessions(meBookings, me, now)` returns
  `{ list, stats }` where `list` is `[{ year, date, startDate, typeLabel, riders }]` sorted
  newest-first and `stats` is `{ total, thisYear, streak, perRider: [{name, count}], favType,
  favDay }` (`streak` = current consecutive-week count, 0 if not live). No DOM, no I/O —
  unit-testable. `now` is injected so the streak's "live" check is deterministic in tests.
- **`app/js/views/history.js`** *(new)* — `renderHistory(container, state)` builds the tab
  HTML from `pastSessions(...)`; injects its own scoped styles once. Reuses `prettyCourse`,
  `fmtDate`, `londonParts`.
- **`app/js/views/account.js`** *(modify)* — add the `History` tab to the tab bar and, when
  `isOn("history")`, render `renderHistory` for it. The `Bookings`/`Extras` paths are
  untouched.
- **`app/js/config.js`** *(modify)* — `FEATURES.history = "internal"`; bump `APP_RELEASE`.
- **`app/sw.js`** *(modify)* — add `js/historyModel.js` + `js/views/history.js` to the
  precache `ASSETS`; bump `CACHE` to match.

## Testing

`app/test/historyModel.test.js` (Node `--test`, mocked — no network), fixtures covering:
- past vs future split (a future booking is excluded)
- `status`/cancelled exclusion (a cancelled or non-confirmed booking is excluded)
- total & this-year counts
- per-rider counts, including a two-rider session counting for both
- favourite type and favourite weekday (London tz — a session serialised in UTC that is a
  different London weekday must bucket by the London day)
- **ride streak:** consecutive weeks count back correctly; a one-week gap breaks it; a streak
  whose most recent ride is >1 full week before `now` is not live → 0; a mid-week `now` with
  last weekend's ride still counts as live; two rides in the *same* week don't double-count
- year grouping order (newest first)
- empty input → zeroed stats (streak 0) + empty list

## Deployment

Standard: bump `APP_RELEASE` + `sw.js` `CACHE` together, add the two new JS files to the SW
`ASSETS`, PR to `main`, then the daves-adventures site deploy. Gated `internal`, so it's live
in code but invisible until dev mode is on.
