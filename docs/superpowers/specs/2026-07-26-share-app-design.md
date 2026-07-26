# Share the app — design

**Date:** 2026-07-26
**Status:** Approved (design), dev-only

## Goal

Let a user quickly share the app with someone else, from the **About** tab. Dev-only for
now (behind an `internal` feature flag) while we try it out.

## Placement & gating

- New flag `shareApp: "internal"` in `config.js` `FEATURES`.
- On the **About** sub-tab of Settings, a "Share this app" section appears **only when
  `isOn("shareApp")`**. Flag off → nothing renders; About is unchanged.

## What's in the section

- **Share** button → `navigator.share({ title, url })` — the native OS share sheet on
  mobile. Hidden (or disabled) when `navigator.share` is unavailable (most desktops).
- **Copy link** button → `navigator.clipboard.writeText(APP_URL)`, transient "Copied ✓".
- A scannable **QR** of the app URL — point a camera at it to open the app.

## Implementation (vanilla JS, no deps, no build)

- **`config.js`** — add `APP_URL = "https://dave-smith.co.uk/lagoon"` (the canonical public
  URL, hardcoded so a QR scanned off a locally-served dev build still points at prod). Add
  the `shareApp` flag.
- **`js/views/share.js`** — new small module (mirrors `cafe.js`): `shareSectionHtml()`
  builds the markup; `wireShareSection(view)` wires the Share + Copy buttons and injects its
  `<style>` once.
- **`js/views/settings.js`** — import the helper; include `shareSectionHtml()` in `aboutTab`
  when `isOn("shareApp")`, and call `wireShareSection(view)` when the About tab is active.
  The live About path is untouched when the flag is off.
- **QR asset** — `app/share-qr.svg`, pre-generated offline from `APP_URL` (no QR library),
  decode-verified before committing. Referenced as `<img src="share-qr.svg">`. Added to the
  `sw.js` `ASSETS` list.
- **Version bump** — `sw.js` `CACHE` + `config.js` `APP_RELEASE` together.
- **Test** — smoke test that `shareSectionHtml()` includes `APP_URL` and the QR image.

## Out of scope (YAGNI)

- No share analytics / referral tracking.
- No custom share text beyond title + URL.
- No clipboard polyfill (PWA is HTTPS; `navigator.clipboard` exists).
