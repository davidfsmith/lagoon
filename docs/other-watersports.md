# Other watersports at Hove Lagoon

The app tracks **cable wakeboarding** availability. Hove Lagoon runs several *other* watersports
too, all bookable through the same public API. This is a survey of what's on offer beyond the
cables — recorded so we don't have to re-derive it if we ever expand the app.

> **Snapshot:** catalogue pulled 2026-07-11. Prices/IDs are stable, but the schedule ("is it
> running right now?") changes seasonally — re-check against the live API before relying on it.

## How this was derived

The full catalogue is **639 courses**, fetched by paging with no name filter:

```
GET https://api.lagoon.co.uk/public/courses?itemsPerPage=100&page=<n>
```

Most entries are noise — schools, group/hen bookings, RYA marina courses, staff/ops placeholders,
tests and `DO NOT USE` decoys. The tables below keep only the **individually bookable Lagoon
watersport sessions**. "Scheduled?" comes from counting future `courseRuns` per course:

```
GET https://api.lagoon.co.uk/public/courseRuns?course=<id>&itemsPerPage=100&page=<n>
```

- **● scheduled** — has upcoming dated runs (would show live availability, same as the cables).
- **○ not scheduled** — in the catalogue but no future runs: seasonal, walk-in hire, or booked
  on request. Nothing to "watch".

## The three scheduled sports

Only **SUP, Windsurf, and Wingfoil** run a regular programme with dated sessions — the same shape
as the cable ride/clinic sessions. These are the only realistic candidates for the app's
availability/notification machinery.

### 🏄 SUP (stand-up paddleboard) — the most active

The densest non-wake schedule; the Yoga and Sea-social clinics run nearly every day.

| ID | Session | Price | Max | Scheduled? |
|----|---------|------:|----:|:----------:|
| 73 | Clinic — SUP Yoga | £25 | 8 | ● |
| 71 | Clinic — Sea Social & Improve | £50 | 6 | ● |
| 72 | Clinic — Training / Race | £50 | 12 | ● |
| 37 | Ready to Ride | £65 | 6 | ● |
| 38 | Intro to Touring | £65 | 6 | ● |
| 415 | Private Lesson | £75 | 4 | ● |
| 70 | Coastal Touring | £69 | 8 | ○ |
| 80 | Clinic — Progression | £40 | 6 | ○ |
| 193 | Clinic — HIIT | £15 | 8 | ○ |
| 164 | SUP Yoga — 4-week class | £53.50 | 8 | ○ |
| 187 | SUP Hire on Lagoon | £20 | 10 | ○ (hire) |
| 396 | Sea SUP Hire | £55 | 6 | ○ (hire) |

### 💨 Windsurf

| ID | Session | Price | Max | Scheduled? |
|----|---------|------:|----:|:----------:|
| 25 | Taster | £75 | 6 | ● |
| 82 | Clinic — Improvers | £75 | 6 | ● |
| 26 | Intermediate P1 — Fast Tack & Flare | £125 | 6 | ● |
| 75 | Intermediate P2 — Beach Start | £125 | 6 | ● |
| 425 | Start Windsurfing Course | £199 | 6 | ● |
| 81 | Clinic — Progression | £40 | 6 | ○ |
| 83 | Clinic — Planing | £70 | 6 | ○ |
| 257 | Private lesson on the sea | £175 | 3 | ○ |
| 577 | Drop-in guided tuition | £50 | 10 | ○ |
| 677 | Taster Day — 4 hours | £95 | 6 | ○ |
| 402 | Windsurf Hire on Lagoon | £20 | 8 | ○ (hire) |
| 397 | Sea Windsurf Hire | £85 | 8 | ○ (hire) |

### 🪁 Wing / Wingfoil

| ID | Session | Price | Max | Scheduled? |
|----|---------|------:|----:|:----------:|
| 494 | Wingfoil — Start Course | £90 | 6 | ● |
| 501 | Wingfoil — Tow Progression Clinic | £100 | 2 | ● |
| 495 | Wingfoil — Improvers | £175 | 4 | ● |
| 507 | Wingfoil — Package | £325 | 10 | ● (Dec placeholder only) |
| 500 | WingSurf Foiling — Intro to Foil | £75 | 4 | ○ |
| 496 | WingSurf Clinic — Improvers | £50 | 4 | ○ |
| 498 | WingSurf Foiling — Advanced | £100 | 4 | ○ |
| 497 | WingSurf Foiling — Take-Away Hire | £40 | 8 | ○ |
| 611 | Wing — Private Lesson | £85 | 3 | ○ |
| 592 | Wingfoil — Private lesson (sea) | £175 | 1 | ○ |
| 705 / 706 | Wingfoil — Private Tow 60 / 30 min | £200 / £100 | 1 | ○ |
| 649 | Wing Hire on Lagoon | £20 | 6 | ○ (hire) |
| 560 | Wing Foil Sea Hire | £100 | 10 | ○ (hire) |

## Not scheduled — booked a different way

These appear in the catalogue but have **no dated runs**, so there's no availability to track.
They're walk-in hire, on-request rides/experiences, or currently dormant.

- **Cable foil** (uses the cable rig, not a wakeboard): Members cable foil (570, £90), Members
  Tow-foil clinic (571, £100) — no current runs.
- **Walk-in hire:** Kayak (493, £20), Pedalo (721, £6) — plus the SUP/windsurf/wing board hire
  listed above.
- **Rides / experiences (on request):** Jet Ski Safari (143 / 158 / 399, £75–£140), Powerboat
  rides (105 / 106 / 221 / 545 / 669, £30–£125), Ringo Ride (575, £50).
- **Lagoon dinghy sailing:** Dinghy Hire (719, £30), RS Venture Hire (443, £120), Try-Sail
  Trapezing / Spinnakers (567 / 568, £50), Club Sail 75 min (661, £75).
- **Fitness / social:** WaveReady Fitness Class (667 / 668, £10–£12), Yoga (641, £10), Wake &
  Bake (517, £60), SUP Polo (512, £15).

## Out of scope: the Brighton Marina operation

A large slice of the catalogue is **RYA yacht / sailing / powerboat / VHF / Dayskipper** training.
That's the separate **Brighton Marina** business, not the Hove Lagoon watersports centre — not
relevant to this app.

## If we ever expand beyond wakeboarding

**SUP is the obvious next candidate.** It has the densest schedule (SUP Yoga and Sea-social
clinics run nearly daily) and the sessions share the exact run structure as the cable clinics, so
they'd drop into the existing pipeline. Adding a scheduled sport needs the same three touch-points
as a new wake type (see `README.md` → session types):

1. `app/js/config.js` `COURSES` — the display + type-filter chip.
2. `courses.json` — the watcher's monitor list (for notifications).
3. `aws/lambda-register/handler.py` `KNOWN_TYPES` — so the pref survives `clean_prefs`.

…with the **label identical** across all three. Windsurf and Wingfoil would follow the same way.
The hire/ride/experience products don't fit — there's no schedule to watch.

See also the `lagoon-course-catalogue` project note for the wakeboard-side catalogue map (IDs in
the app, bookable-but-omitted types, decoys to avoid).
