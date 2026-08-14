# Cold-open splash screen — design

**Date:** 2026-08-14
**Status:** approved (design), ready for planning
**Scope:** `app/` (client only — no API, no AWS, no feature flag)

## Problem / goal

On a cold open the app shows a bare `Loading sessions…` line (`app.js:202`) in the
content area while `loadEverything()` fetches availability in the background. It's a dead
moment. We have a striking photo from a rider — a wakeboarder grabbing the board mid-air,
silhouetted against the sunset at the lagoon (photographer **Rob Goldings**) — that gives
the app a real sense of place during that window.

Show it as a splash while availability loads, then fade to the list.

## Consent gate (blocking, non-negotiable)

The photo is used **only** after the photographer confirms. Rob has been asked; until he
says yes:

- **The image file is NOT committed** to the repo and **not pushed** to any branch — the
  repo is public, so committing/pushing = publishing it. During the build the asset is
  kept locally and git-ignored (see plan) so it can be tested but never leaves the machine.
- The mechanism is built and can run without the image — with no image it simply shows the
  dusk backdrop + loading dots (a fine splash on its own). The photo and its credit line
  land in a **single final commit gated on Rob's OK**, which also removes the git-ignore.
- The subject is a **silhouette against the sun — no identifiable features** — and consent
  to publish has been given by the rider; this gate is specifically the photographer's
  sign-off plus the attribution.

## Decisions (agreed)

- **When:** every cold open, during the availability-load window; fades out when data is ready.
- **Content:** the photo as a centred **landscape band** over a **dusk-gradient backdrop**,
  with a small pulsing three-dot loading cue. No text on the splash.
- **Header stays visible.** The splash fills the **content area below** the persistent
  "🏄 Hove Lagoon" header — it is not a full-screen takeover. The bottom nav stays hidden
  during load (as it already is) and appears with the list.
- **Framing:** band (not full-bleed) — keeps Rob's whole composition (full board, grab,
  sun, kickers) intact; full-bleed portrait clipped the board and lost the sun on wider phones.
- **Credit:** a small "Photo © Rob Goldings" line on the **About** section (Settings/About).
- **No feature flag** (straight GA). **Version bump v96 → v97.**

## Architecture

### Instant paint, header-anchored

The splash must appear on the **first frame**, before the JS modules parse — otherwise it
lags. So its markup and CSS live **directly in `index.html`**:

- The splash markup is the **initial content of `<main id="view">`** (the content area
  between header and nav). Because the header and nav are separate flex items in the shell,
  putting the splash inside `#view` means the header renders above it automatically — no
  positioning maths, no z-index tricks.
- A small `<style>` block for the splash goes in `index.html`'s `<head>` (alongside the
  existing shell styles), so it's styled on first paint without waiting for injected CSS.

### Structure (inside `#view`)

```
main#view  (position: relative so the splash can fill it, ignoring main's padding)
  └─ #splash  (position: absolute; inset: 0)
       ├─ .splash-bg    dusk gradient backdrop
       ├─ img.splash-band   the photo, centred band (width:100%, vertically centred)
       └─ .splash-dots  three pulsing dots near the bottom
```

- **Backdrop:** a vertical dusk gradient echoing the photo (dusky blue-grey → warm amber →
  dark). Tuned so the band's sky/water edges blend into it; the band gets a soft top/bottom
  **feather** (CSS `mask-image` linear-gradient) so it melts into the backdrop rather than
  showing a hard seam.
- **Band:** `img` at `width:100%`, height auto, vertically centred in the splash area
  (`top:50%; transform:translateY(-54%)` — biased slightly up so the sun/kickers sit in the
  lower third above the dots).
- **Dots:** three dots, staggered pulse; **disabled under `prefers-reduced-motion`** (hold
  static at reduced opacity).
- Theme-agnostic: the dusk backdrop is a fixed palette (it's dusk regardless of app theme);
  it reads fine behind both the dark and light header.

### Boot / fade logic (`app.js`)

The splash element exists **only on the first cold render** (it's the initial `#view`
content from `index.html`). A tiny helper module (`splash.js`) owns its lifecycle:

- `splashEl()` → the `#splash` element or null.
- `leaveSplash()` → resolves after a **minimum visible time (~600ms)** has elapsed since
  boot, then adds a `.leaving` class (opacity → 0 over ~300ms) and resolves when the fade
  ends (or immediately if already gone). Idempotent.

Integration in `reload(target, showLoading)`:

- If the splash is present, **skip** writing `Loading sessions…` into `#view` (the splash
  already covers the area).
- After `loadState()` resolves (success **or** cache fallback), `await leaveSplash()` then
  `go(...)` renders the list into `#view` (which also removes the now-faded splash markup).
- **Safety:** a hard timeout (~8s from boot) removes the splash regardless, so a hung/slow
  load or an error never traps the user behind it (the existing `Loading…`/`Couldn't load`
  view shows beneath once the splash is gone). On the error path, the splash is removed
  before the error is written.
- **No token at boot:** `go("login")` runs synchronously and replaces `#view` (splash
  included) immediately — a single-frame splash flash at most, acceptable; login is unaffected.

Because the splash lives in the boot path and the initial `#view`, it shows on a genuine
cold launch/page-load only — **not** on background→foreground resume (which never rebuilds
`#view`). That matches "when it first opens".

### Asset

- One optimised image at `app/splash.jpg` (or `.webp` if a WebP encoder is available at
  build time — prefer WebP for size; otherwise JPEG ~72 quality). Source: the landscape
  original (3488×2296), downscaled to **~1290 px wide** (retina-crisp at phone widths).
  Silhouettes compress tiny — **target < 150 KB** (JPEG candidate already ~128 KB at 1400 px).
- Added to `sw.js` `ASSETS` (so it's offline-cached) and `<link rel="preload" as="image">`
  in `index.html` so it's fetched early. A solid dusk backdrop colour means there's never a
  white flash before the band decodes.

### About-page credit

A small muted line "Photo © Rob Goldings" in the **About** tab of `settings.js` (the
section that renders the app version row, ~`settings.js:149`). Committed **with** the image
in the consent-gated final step, not before.

## Testing

- `splash.js` timing helper: a small pure-ish unit is hard (DOM + timers); keep logic
  minimal. Where practical, unit-test a pure helper (e.g. "should the loading text be
  suppressed when a splash element is present" as a pure predicate). Otherwise this is
  boot/DOM glue verified manually.
- Full existing suite must stay green (`node --test app/test/*.test.js`).
- **Manual checks** (headless can't cover): cold open shows header + dusk band + dots, fades
  to the list when data arrives; a fast/cached load still shows the splash briefly (min-time),
  not a flicker; a slow/failed load removes the splash within the safety timeout; logged-out
  boot goes straight to login with no lingering splash; `prefers-reduced-motion` holds the
  dots still.

## Out of scope / non-goals

- No change to the data flow, API, AWS watcher, notifications, or any feature flag.
- No splash on background→foreground resume (cold open only).
- Login screen unchanged (no image behind it — decided earlier).
- No text/wordmark on the splash (the header already carries the brand).

## Housekeeping

- Version bump **v96 → v97**: `sw.js` `CACHE` + `config.js` `APP_RELEASE`, together. Add the
  new image (and `splash.js`, if added) to `sw.js` `ASSETS`.
- Deploy is separate (merge to `main` does not deploy) — the daves-adventures "Deploy Hugo
  Site (AWS)" workflow ships it.
- Remove the local `.splash-preview/` scratch dir and the raw `54474.jpg` before finishing.
