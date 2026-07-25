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

- **Guest passes remaining.** ~~Show how many guest passes are available on an account
  (alongside the existing membership / ride-pass readout on Bookings → Extras).~~
  **BLOCKED — not exposed by the customer API (investigated 2026-07-13).** Probed
  `me` / `me/memberships` / `me/packages` and guessed endpoints (`me/guest-passes`,
  `me/vouchers`, `me/credits`, `me/passes`, …) — no "guest" field anywhere and every guess
  404s. `me/packages` only returns the "Learn to Wakeboard" bundles (packageId 19). Crucially,
  the **booking website (same `api.lagoon.co.uk`) doesn't show a guest-pass balance either**,
  even for an account that *has* guest passes — so they're tracked staff/admin-side only and
  aren't customer-facing. Not buildable until Lagoon exposes it (ask the team), or via a
  non-API source. Revisit if their API adds it.
- **In-app booking (investigate — user request).** Dig into whether we could handle
  *booking* a session in-app in future, not just browsing + cancelling. Would need the
  Lagoon booking API's create/reserve endpoints (we already use `api2.lagoon.co.uk` for
  cancel). Scope the flow, auth, and error handling. **Never card payments** (project rule)
  — so this only covers bookings that don't require payment at point of booking; anything
  involving payment stays on the booking site.

## Notifications

- **Self-cancel suppression — needs device testing, then promote.** *Built, reviewed clean,
  and fully deployed 2026-07-15 (v80: app + watcher/register Lambdas), gated
  `FEATURES.cancelSuppress = "internal"`.* Stops a rider being notified about a slot **they
  themselves just cancelled**: on cancel the app posts the freed slot key to the register
  Lambda, which stashes it on that subscription's `suppress` map (6h TTL); `notify_filter`
  skips it — only the canceller, everyone else still gets notified. **NOT yet device-tested.**
  To verify (dev mode): subscribe on a reachable watched day/type, book then cancel a session,
  confirm no self-notification on the next watcher run (≤10 min). Then promote
  `internal → GA → retire flag`. Spec:
  `docs/superpowers/specs/2026-07-15-notif-self-cancel-suppression-design.md`.
- **Reconcile notification prefs between app and server** — *done (v76→v79, GA, flag retired).*
  `syncPrefs` now surfaces failures (Saving…/Saved ✓/Retry) and the register Lambda echoes the
  stored prefs so the client reconciles local ↔ server. Kept here as a record.

## Café / venue

- **Café WiFi tab** — *done (GA v83, 2026-07-25).* Settings → **Café** tab with the guest
  network name + password (tap-to-copy), a scannable WiFi QR, and manual connect steps.
  Shipped dev-only first (`cafeWifi:"internal"`, v81/v82), then promoted to GA
  (`cafeWifi:"on"`). Copy/paste verified on-device; the **QR auto-join is untested on-site**
  (feedback-driven — a wrong `CAFE_WIFI.security`, assumed `WPA`, would only break the QR's
  join prompt, with copy/paste as a full fallback). The `cafeWifi` flag is kept as a quick
  revert lever — **retire it (+ the `isOn` guard in `settings.js`) once stable**; if QR
  feedback is bad, fix `CAFE_WIFI.security` and regenerate `wifi-qr.svg`. Spec:
  `docs/superpowers/specs/2026-07-20-cafe-wifi-design.md`.
