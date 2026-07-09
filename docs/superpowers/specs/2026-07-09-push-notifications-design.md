# Push notifications — design

**Date:** 2026-07-09
**Status:** approved, ready for implementation plan (umbrella design — build is phased)
**Area:** `app/` (PWA client) + `aws/` (watcher + new infra)

## Summary

Notify a rider, **while the app is closed**, when a wakeboarding spot opens on a day they
ride and that they can still physically get to. This is the multi-user endgame: the AWS
watcher already *detects* openings and logs them; this design adds the per-user filtering
and Web Push delivery on top.

Purely **additive** — nothing the app does today changes. Everything is gated behind the
`internal` then `beta` tiers (see `app/CLAUDE.md` feature-flag conventions) until GA.

## What a rider configures

A new **Notifications** section in Settings:

- **Enable notifications** — master toggle. Turning on requests OS notification permission
  (platform-specific onboarding — see below). Turning off unsubscribes cleanly.
- **Days** — tick the days-of-week you ride (recurring; e.g. Sat/Sun/Wed).
- **Session types** — which types you care about (reuse the existing Tech/Air filter concept).
- **Travel time** — minutes to reach the lagoon. Drives the reachability gate.

Preferences are stored **server-side** (see Architecture) because the send-time filter runs
while the app is closed.

## What fires a notification

An **opening** = a session's free count rises between two watcher runs (a cancellation
frees a spot, or a batch of sessions posts). A rider is notified about an opening only if
**all** hold:

- the session starts within the **next 7 days**;
- it falls on one of their **chosen days**;
- it matches one of their **chosen session types**;
- it is **reachable**: `slot_start − now ≥ travel_time + buffer`, where **buffer = 15 min**
  (time to see, decide, book, and prep). Future-day slots pass this trivially; imminent
  same-day slots are gated — so we never tell a 40-min-away rider about a spot in 15 min.

## Anti-spam

All of the following apply together:

- **7-day horizon** — never consider slots more than a week out.
- **Dedupe** — a given slot notifies a given rider **at most once per day**.
- **Coalesce** — multiple eligible openings found in one watcher run for one rider become a
  single summary notification ("3 spots opened Sat–Sun · tap to view"), not one buzz each.
- **Quiet hours** — **21:00–08:00** local: openings are held until 08:00, then dropped if
  the slot has since become unreachable or passed. *(Fixed window in v1; making the window
  user-configurable is a future refinement — see Out of scope.)*
- **Daily cap / cooldown** — **max 5 notifications/rider/day**, **≥ 30 min apart**; extras
  are silently dropped (the openings remain visible in-app).

## The notification

- **Single opening:**
  `🌤 Sat 12 Jul 18:00 · Tech · 2 free — 🌬NE 15(28) · ☔20% · UV 4`
  (weather segment reuses the `sessionWx` format so it matches the in-app readout).
- **Coalesced:** `3 spots opened this weekend · tap to view`.
- **Tap action** → opens the PWA on **Last-minute**, deep-linked/scrolled to the freed
  slot(s), with full weather + the **Book ↗** button visible. From there the rider books or
  dismisses. (Deep-link handled in the service worker `notificationclick` handler.)

## Onboarding & opt-in

Notifications are **opt-in**; opt-out is the same master toggle, one tap.

- **Intro slide** added to the first-run carousel (`app/js/intro.js`) explaining what
  notifications do and how to turn them on. (Bumping the intro VERSION re-shows it.)
- **Platform-specific enable path** — the push machinery (service worker, VAPID,
  `PushManager`) is identical across platforms; only the *guidance* differs:
  - **Android** (Chrome/Firefox/Samsung Internet): web push works directly from the browser
    tab or an installed PWA — no home-screen install required. Tap Enable → OS permission
    prompt → done.
  - **iOS** (16.4+): web push **only** works when the PWA is installed to the home screen.
    If the enable flow detects iOS-and-not-installed, it shows "Add to Home Screen first"
    instructions rather than failing silently. This is the critical path — the audience is
    overwhelmingly iPhone (see the CloudFront usage evidence).

## Architecture — extend the watcher (one Lambda)

```
Client (PWA)                          AWS
─────────────                         ───
sw.js push / notificationclick        Registration Lambda (function URL)
enable → OS permission   ── POST ──►    ├ subscribe / update prefs / unsubscribe
subscribe (VAPID public)                └ writes DynamoDB (subscription + prefs + notify-log)
prefs UI (days/types/travel)
                                      Watcher Lambda (every 10 min — existing, extended)
                                        ├ detect openings  (broaden 48h weekend → 7-day window)
                                        ├ load subscriptions (DynamoDB)
                                        ├ filter per-user   (see "What fires" + "Anti-spam")
                                        └ send via pywebpush (VAPID private from SSM/Secrets Mgr)
```

- **VAPID keypair** — public key ships in client config; private key stored in SSM Parameter
  Store / Secrets Manager, read by the watcher at send time. Never committed (public repo).
- **DynamoDB table** — one item per push subscription: endpoint + p256dh/auth keys, chosen
  days, chosen types, `travelMins`, and a small rolling **notify-log** (recent
  slot→timestamp entries) backing dedupe and the daily cap/cooldown.
- **Registration Lambda** (function URL) — the only new HTTP surface. Client calls it to
  subscribe, update prefs, and unsubscribe. No auth beyond the opaque push endpoint in v1
  (the subscription itself is the capability; revisit if abuse appears).
- **Watcher extension** — detection broadens from the current weekend-only 48h release
  window to any free-count increase within the 7-day horizon, comparing consecutive
  snapshots (already persisted to S3). The per-user filter is **pure Python** — clock, subs,
  and openings passed in — so it is unit-testable offline with no AWS calls, matching the
  existing `verify_data.py` / mocked-test discipline. Client subscribe/prefs logic gets
  matching JS tests (Node's runner, mocked).

## Build phasing

Large but cohesive; built in stages, each behind the tier gate, likely **its own
spec + plan**. This document is the umbrella.

1. **Infra + basic send (`internal`).** VAPID keypair, DynamoDB, registration Lambda,
   `sw.js` push/notificationclick handlers, the enable toggle + subscribe, and the watcher
   send step — end-to-end for one rider (you), minimal filtering. Proves the pipe.
2. **Full per-user filter + prefs UI (`internal`).** Days/types/travel-time UI, the
   reachability gate, and the complete anti-spam set (7-day horizon, dedupe, coalesce,
   quiet hours, cap/cooldown). All pure-function, unit-tested.
3. **Onboarding + beta.** Intro slide, the iOS add-to-home-screen path + Android direct
   path, then promote to **`beta`** for opted-in riders. Harden → **GA**, delete the flag.

## Out of scope (v1)

- **User-configurable quiet-hours window** — fixed 21:00–08:00 for now; a future refinement.
- **Rich per-slot preferences** beyond day-of-week + type + travel time (e.g. specific
  dates, "only if X free").
- **Cross-device pref sync / accounts** — prefs are per push subscription (per device),
  consistent with the app's other per-device settings.
- **Anything but Web Push** — no email/SMS/native app.
- **Booking from the notification** — tap goes to the app's Last-minute + Book ↗; no card
  payments, ever (project rule).
