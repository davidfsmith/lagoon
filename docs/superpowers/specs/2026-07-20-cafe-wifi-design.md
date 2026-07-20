# Café WiFi section — design

**Date:** 2026-07-20
**Status:** Approved (design), ready for implementation

## Goal

Let people working from the Lagoon Café find and join the guest WiFi from the app:
show the network name and password, make them one-tap copyable, and offer a QR code
that a phone camera can scan to join.

Source of the details (guest network, already shared publicly on WhatsApp):
- **SSID:** `HoveLagoonGuest`
- **Password:** `topsecretgoonies`
- **Security:** WPA/WPA2

The user has confirmed it's fine to commit these to the public repo.

## Placement

A new **third sub-tab in the Settings tab bar**, alongside *Settings* and *About*,
labelled **Café**. Reached via the ⚙ header icon. Keeps the About tab uncluttered and
gives the WiFi its own space (room to grow into other venue info later).

## Tab contents

- Intro line: "Work from the Lagoon Café — hop on the guest WiFi."
- **Network** row: `HoveLagoonGuest` + tap-to-copy button (transient "Copied ✓").
- **Password** row: `topsecretgoonies` + tap-to-copy button.
- **QR code**: scannable WiFi QR; caption "Fastest way — scan with your camera."
- **How to connect**: 3 short manual steps (open WiFi settings → pick the network →
  paste the password).

## Implementation notes (vanilla JS, no deps, no build — house rules)

- **`js/config.js`** — add `CAFE_WIFI = { ssid, password, security }` as the single
  source of truth. The QR encodes the same values.
- **`js/views/cafe.js`** — new small module:
  - `cafeTabHtml()` → returns the tab markup (pure, testable).
  - `wireCafeTab(view)` → wires the copy buttons (`navigator.clipboard.writeText`) and
    injects its `<style>` once (guarded by element id, matching the app pattern).
- **`js/views/settings.js`** — add `{ id: "cafe", label: "Café" }` to `tabBarHtml`;
  render `cafeTabHtml()` and call `wireCafeTab(view)` when that tab is active. The live
  Settings/About paths stay untouched.
- **QR asset** — `app/wifi-qr.svg`, pre-generated offline from
  `WIFI:T:WPA;S:HoveLagoonGuest;P:topsecretgoonies;;` (no QR library in the app —
  respects no-deps). Referenced as `<img src="wifi-qr.svg">` (resolves against `<base>`).
  Verified to decode back to the correct payload before committing.
- **Version bump** (the two-rules note): bump `sw.js` `CACHE` and `config.js`
  `APP_RELEASE` together, and add `js/views/cafe.js` + `wifi-qr.svg` to the `sw.js`
  `ASSETS` list.
- **Test** — a smoke test that `cafeTabHtml()` renders the SSID and password, following
  the existing mocked `*.test.js` pattern.

## Out of scope (YAGNI)

- No feature-flag gating — simple public info, ships straight to GA.
- No clipboard polyfill — the PWA runs over HTTPS where `navigator.clipboard` exists.
- No auto-connect — web pages can't join WiFi programmatically; the QR is the fast path.
