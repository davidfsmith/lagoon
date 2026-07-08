# Backlog

Loosely-prioritised ideas and follow-ups for the Hove Lagoon app. Not commitments —
just a place to park things so they aren't forgotten.

## Weather / riding conditions

- **Wind direction + speed → riding guidance.** Get notes from the Lagoon team on how
  wind direction and speed actually affect the riding (the cable's orientation means some
  winds are far better/worse than others). Use their input to turn the raw wind readout
  into *guidance* — e.g. flag favourable vs unfavourable wind for the cables, rather than
  just showing the bearing + speed. (Wind direction is now displayed as a starting point.)

## Next up

- **Push notifications (Phase 2).** Notify when a short-notice spot opens while the app is
  closed: the AWS watcher already detects releases → add Web Push (SW push handler, VAPID
  keys, a subscription store, and the watcher sending on release). The in-app Last-minute
  surfacing (Phase 1) is the interim. See `docs/superpowers/specs/` for the Phase 1 design.

## Tidy-ups

- **Remove the `lastMinute` feature flag** once the feature has proven stable in the wild
  (currently kept at `"on"` in `config.js` as a kill-switch) — then delete the `isOn`
  checks and make the code unconditional.
