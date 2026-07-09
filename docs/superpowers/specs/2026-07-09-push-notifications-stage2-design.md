# Push notifications — Stage 2 (per-user filter + anti-spam) design

**Date:** 2026-07-09
**Status:** approved, ready for implementation plan
**Area:** `aws/` (watcher + registration Lambda) + `app/` (prefs UI + sync)

## Summary

Stage 1 shipped the pipe: enable → subscribe → the watcher sends every detected opening
to every subscription. Stage 2 makes it **personal and quiet** — each rider is notified only
about openings on **their** chosen days, of **their** chosen session types, that they can
**still reach**, within a **7-day** horizon, and never spammed (dedupe, daily cap, coalesce,
quiet hours). This is the send-time per-user filter from the umbrella design
(`2026-07-09-push-notifications-design.md`); it stays gated `internal`.

Behaviour was approved in that umbrella design. This document fixes the Stage 2
**implementation**: the data model, the broadened detection, the filter pipeline, the
anti-spam mechanics, and how prefs sync from the app to the server.

## Decisions (from brainstorming)

- **Prefs sync: reuse the registration endpoint.** No new infra. On subscribe *and* on any
  prefs change, the client re-POSTs `{subscription, prefs}`; the registration Lambda upserts
  the same DynamoDB item by `subId`.
- **Quiet hours: hold then deliver at 08:00** (not suppress). Openings detected 21:00–08:00
  London are held per-subscription and delivered on the first run ≥08:00 if still valid.
- **Type prefs mirror the app filter** — the same ride/other chips (Air 30, Tech 30, Air 15,
  Tech 15, Taster, Jam, Drop-in), core-on by default.
- Defaults on first enable: **all 7 days**, **core ride types** (Air 30, Tech 30), **30 min**
  travel. Weekdays stored as London 3-letter codes (`Mon`…`Sun`). `notifyLog` is
  `{slotKey: epochSecs}`.

## Data model (extends the Stage 1 subscription item)

The DynamoDB item (`LagoonWatcher-PushSubs…`, PK `subId`) gains:

| Field | Type | Meaning |
|-------|------|---------|
| `days` | list\<str\> | chosen London weekdays, e.g. `["Sat","Sun","Wed"]` |
| `types` | list\<str\> | chosen labels, e.g. `["Air 30","Tech 30"]` |
| `travelMins` | int | minutes to reach the lagoon |
| `notifyLog` | map str→int | `{slotKey: epochSecs}` of recently-sent slots (dedupe + cap) |
| `pending` | list\<str\> | slotKeys held during quiet hours, awaiting the 08:00 run |

Stage 1's fields (`subId, endpoint, p256dh, authKey, createdAt`) are unchanged. Existing
Stage-1 subscriptions with no prefs fields are treated as **defaults** (all days, core types,
30 min) until the client next syncs — so nothing breaks mid-migration.

## Detection broadens (watcher `run`)

Today: `find_openings(weekend_only=True, days_ahead=HORIZON_DAYS)` + a 48h "urgent" release
gate. Stage 2:

- `find_openings(weekend_only=False, days_ahead=7)` — **any day within 7 days**.
- The release detector keeps its "free rose since last state" semantics but the window is the
  full 7-day horizon (drop the 48h gate). Per-user prefs do the narrowing.
- `release_record` gains the absolute **UTC `start`** (ISO) alongside `startLondon`, so
  reachability can be recomputed at a later run (needed for held slots). It already carries
  `label`, `free`, `runId`, `book`.
- The CloudWatch `release` log now logs the broader 7-day set — no separate weekend path.

State (`state/free.json`) naturally grows to the 7-day all-day key set; that's fine.

## Per-user filter pipeline (pure Python)

For a subscription, a newly-opened slot is a **candidate** iff it passes all of:

1. **horizon** — `start` within 7 days of `now`.
2. **day** — London weekday of `start` ∈ `days`.
3. **type** — slot `label` ∈ `types`.
4. **reachable** — `start − now ≥ (travelMins + 15) minutes` (15-min see/decide/book/prep
   buffer). Future-day slots pass trivially; imminent same-day slots are gated.

A rider with a Stage-1-only item (no prefs) uses the defaults above.

## Anti-spam (applied to candidates)

- **Dedupe** — drop a slot already in `notifyLog` from **today** (London day).
- **Cap / cooldown** — at most **5** sends/rider/day and **≥30 min** since the last send;
  overflow candidates are dropped (still visible in-app). Both derived from `notifyLog`
  timestamps.
- **Coalesce** — a rider's surviving candidates in one run become **one** push via
  `build_payload` (single line vs "N spots opened — tap to view").
- **Quiet hours 21:00–08:00 London:**
  - a run **inside** quiet hours: append surviving candidates to `pending` (dedup against
    existing `pending` + `notifyLog`); send nothing.
  - the first run **at/after 08:00**: re-evaluate each `pending` slot against the *current*
    run's open set (still free?), reachability (recomputed `now`), and horizon; deliver the
    survivors (coalesced, cap-respecting), record them in `notifyLog`, and clear `pending`.

After processing, each affected subscription's `notifyLog`/`pending` is written back to
DynamoDB (a small update per notified/held sub).

### Filter signature (testable)

Pure function, mocked clock, no AWS/network:

```
filter_for_sub(sub, new_openings, current_open_by_key, now)
  -> (payload_or_None, updated_sub_state)   # updated_sub_state = {notifyLog, pending}
```

`new_openings` = this run's released records; `current_open_by_key` = all currently-open
slots keyed by slotKey (for the held-slot "still open?" re-check). The watcher calls this per
subscription, sends `payload` if not None via the Stage-1 `send_all`, and persists
`updated_sub_state`.

## Prefs sync + UI (client)

### Sync
- `app/js/push.js`: `subscribe()` sends `{subscription, prefs}` where `prefs` = the locally
  stored prefs (or defaults). A new `syncPrefs()` re-POSTs `{subscription, prefs}` when prefs
  change *while subscribed* (upsert). If not subscribed, prefs are just saved locally and
  applied at the next enable.
- `app/js/store.js`: prefs accessors (`getNotifyPrefs`/`setNotifyPrefs`) over one
  `localStorage` key, following the existing `"1"`/JSON pattern.

### Registration Lambda
- `parse_request`/`sub_item` accept an optional `prefs` object; validate + default
  (`days` ⊆ Mon–Sun, `types` ⊆ known labels, `travelMins` a non-negative int). Unknown/absent
  → defaults. `notifyLog`/`pending` are **server-owned** — never taken from the client.
- Upsert must not clobber server-owned `notifyLog`/`pending` on a prefs update (use an update
  that sets only the prefs fields, or preserve them).

### UI
The gated Settings **Notifications** section (below the enable toggle) expands, shown only
when enabled:
- **Days** — Mon–Sun checkboxes (all on by default).
- **Session types** — the app's ride/other chips (reuse the filter taxonomy), core-on.
- **Travel time** — minutes input/stepper (default 30).
Changing any of these persists locally and, if subscribed, calls `syncPrefs()`.

## Testability

- **Python** (`aws/lambda/`): `filter_for_sub` and its helpers (`is_reachable`,
  `matches_day`, `matches_type`, `within_horizon`, `dedupe`, `cap_ok`, quiet-hours
  hold/deliver) are pure and unit-tested with a mocked `now` and in-memory subs — mirrors
  `push.py`'s discipline. Registration prefs validation gets tests too.
- **JS** (`app/test/`): prefs get/set round-trip; the `{subscription, prefs}` body shape;
  defaults. Browser push calls stay manually verified on-device.

## Out of scope (Stage 2)

- **Intro slide + iOS add-to-home-screen onboarding** — Stage 3.
- **Promotion to `beta`/GA** — Stage 3.
- **User-configurable quiet-hours window** — fixed 21:00–08:00 (future refinement).
- **Cross-device pref sync** — prefs are per subscription (per device).

## Version bump

Client changes (`store.js`, `push.js`, `views/settings.js`, maybe `config.js`) → bump
`APP_RELEASE` + `sw.js` `CACHE` together (v51 → v52). No new client files unless the plan
splits the prefs UI out.
