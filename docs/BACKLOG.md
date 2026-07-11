# Backlog

Loosely-prioritised ideas and follow-ups for the Hove Lagoon app. Not commitments —
just a place to park things so they aren't forgotten.

## Weather / riding conditions

- **Wind direction + speed → riding guidance.** Get notes from the Lagoon team on how
  wind direction and speed actually affect the riding (the cable's orientation means some
  winds are far better/worse than others). Use their input to turn the raw wind readout
  into *guidance* — e.g. flag favourable vs unfavourable wind for the cables, rather than
  just showing the bearing + speed. (Wind direction is now displayed as a starting point.)

## Account & bookings

- **Guest passes remaining.** Show how many guest passes are available on an account
  (alongside the existing membership / ride-pass readout on Bookings → Extras). Needs the
  guest-pass count from the Lagoon account/membership API — dig into what field exposes it.
- **In-app booking (investigate — user request).** Dig into whether we could handle
  *booking* a session in-app in future, not just browsing + cancelling. Would need the
  Lagoon booking API's create/reserve endpoints (we already use `api2.lagoon.co.uk` for
  cancel). Scope the flow, auth, and error handling. **Never card payments** (project rule)
  — so this only covers bookings that don't require payment at point of booking; anything
  involving payment stays on the booking site.

## Notifications — reliability

- **Reconcile notification prefs between app and server.** `syncPrefs` currently swallows
  failures silently (`.catch`), so if a POST fails — or the registration Lambda strips a
  label its `KNOWN_TYPES` doesn't yet recognise — the Settings UI and the DynamoDB item
  drift apart with no warning: the app shows a day/type as selected while the server never
  stored it, so no push is ever sent for it. (Seen live: Skills/Clinic ticked on-device but
  absent server-side after being added during a stale-Lambda deploy window.) Fix options:
  (a) have the register Lambda **return the stored prefs** and reconcile/warn on next load
  if they differ from local; and/or (b) surface a "couldn't save preferences" toast instead
  of failing quietly. Low urgency (self-heals on any successful re-save) but it's a silent
  correctness gap.

## Next up

- **Push notifications (Phase 2).** Notify when a spot opens on a rider's chosen days that
  they can still reach, while the app is closed: extend the AWS watcher with Web Push (VAPID,
  a DynamoDB subscription/prefs store, a registration Lambda, and the watcher sending via
  `pywebpush`). Now in active design — see
  `docs/superpowers/specs/2026-07-09-push-notifications-design.md` (umbrella; phased build,
  gated `internal` → `beta` → GA). The in-app Last-minute surfacing (Phase 1) is the interim.
