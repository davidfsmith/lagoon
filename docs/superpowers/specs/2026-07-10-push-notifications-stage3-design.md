# Push notifications — Stage 3 (onboarding, deep-link, polish) design

**Date:** 2026-07-10
**Status:** approved, ready for implementation plan
**Area:** `aws/lambda/` (payload) + `app/` (sw.js, app.js, settings.js, intro.js)

## Summary

Stages 1 (the pipe) and 2 (per-user filter + anti-spam) are live, gated `internal`.
Stage 3 is the presentation/onboarding polish from the umbrella design
(`2026-07-09-push-notifications-design.md`):

1. **Deep-link** the notification tap to the freed slot's **Day view** (scrolled to +
   highlighted), instead of just focusing the app.
2. **iOS add-to-home-screen** inline guidance so iOS users can get to a working state.
3. **Intro slide** introducing notifications (gated; carousel re-show deferred).

The feature **stays `internal`** — promotion to `beta`/GA is a separate later step. So
everything here is dev-only until then, and the intro slide / any user-facing copy is gated
accordingly.

## Decisions (from brainstorming)

- **Deep-link target = the freed slot's Day view** (not Last-minute). Last-minute only shows
  Today/Tomorrow/Weekend, but notifications span 7 days; the Day view works for any day and
  **already** implements scroll-to-slot + highlight (`renderDay(view, state, {date, key}, go)`
  from Availability). For a coalesced multi-slot push, target the **earliest** freed slot's day.
- **iOS guidance = inline in Settings**, shown in place of the enable toggle when push is
  unsupported on iOS-not-installed. Synchronous detection (no async needed).
- **Intro slide gated on `isOn("notifications")`**; **do not bump the intro `VERSION`** now
  (a bump re-shows the whole carousel to everyone for a feature they can't use). The bump
  rides with the eventual beta promotion. Internal testers preview via Replay intro.
- **Flag stays `internal`.** No `FEATURES` change this stage.

## 1. Deep-link the tap → the freed slot's Day view

### Payload (`aws/lambda/push.py` `build_payload`)
Add a deep-link target to the payload: the **earliest** delivered slot's London **date**
(`YYYY-MM-DD`) and its **key**. Records carry `startLondon` (`YYYY-MM-DDTHH:MM`), `start`
(UTC ISO), and `key`; earliest = min by `start`.

```
payload = {title, body, url, date: <earliest London date>, key: <earliest slot key>}
```

`url` stays the app root (fallback for the cold-open path, which encodes date/key in a hash).

### Service worker (`app/sw.js`)
- `push` handler: store the target on the notification —
  `data: { url: d.url, date: d.date, key: d.key }`.
- `notificationclick` handler:
  - `matchAll` windows → if one exists, `focus()` it and
    `client.postMessage({ type: "open-day", date, key })`.
  - else `openWindow("./#day/" + date + "/" + encodeURIComponent(key))`.
  - If `date`/`key` are absent (older payloads), fall back to the current focus/open-root
    behaviour.

### App (`app/js/app.js`)
- Add a `navigator.serviceWorker` `message` listener: on `{type:"open-day", date, key}` →
  `go("day", { date, key })` (only if `state` is loaded; otherwise stash + navigate after load).
- On boot, parse `location.hash` for `#day/<date>/<key>`; stash the target and, after the
  initial data load (`loadAndRender`), `go("day", {date, key})`. Clear the hash.

### Day view (`app/js/views/day.js`)
- **Unchanged.** `renderDay` already accepts `{date, key}`, jumps to the day, and
  scroll-highlights the slot whose `key` matches. If the slot has since filled/closed, it
  lands on the day without a highlight (acceptable). Requires the date to be within the app's
  loaded agenda (`HORIZON_DAYS=21` ≥ the 7-day notify horizon — always present).

## 2. iOS add-to-home-screen inline guidance

In `app/js/views/settings.js`, the Notifications section renders one of two states
(synchronous detection, no async):

- **needs-install** when `!("serviceWorker" in navigator) || !("PushManager" in window)`
  **and** iOS UA (`/iphone|ipad|ipod/i.test(navigator.userAgent)`) **and** not standalone
  (`!(navigator.standalone || matchMedia("(display-mode: standalone)").matches)`):
  render *"Add Hove Lagoon to your Home Screen to get spot alerts"* + steps
  (**1. Tap Share ⬆︎ · 2. Add to Home Screen**), **in place of** the toggle.
- **normal** otherwise: the existing enable toggle + (when on) the prefs UI.

Small helpers (`isIOS()`, `isStandalone()`, `pushSupported()`) local to settings.js.

## 3. Intro slide (built, gated, re-show deferred)

`app/js/intro.js`:
- Add a **Notifications** slide (emoji 🔔) to `SLIDES`, explaining that the app can alert you
  when a reachable spot opens, and that you enable + tune it in Settings.
- **Gate it**: `SLIDES` becomes filtered by an optional per-slide `gate()` —
  `SLIDES.filter(s => !s.gate || s.gate())` at carousel build time — with the notifications
  slide `gate: () => isOn("notifications")`. Import `isOn` from `features.js`.
- **`VERSION` unchanged** (no forced re-show). Deferred to the beta-promotion step.

## 4. Flag stays `internal`

`FEATURES.notifications` = `"internal"` (unchanged). All Stage 3 additions are gated behind
it or the intro gate. Promotion `internal → beta → GA` is a deliberate later step.

## Version bump

Client files change (`sw.js`, `app.js`, `settings.js`, `intro.js`) → bump `APP_RELEASE`
v55 → **v56** and `sw.js` `CACHE` to `lagoon-v56`. No new JS files (nothing to add to
ASSETS).

## Testing

- **Python** (`aws/lambda/test_push.py`): `build_payload` includes the earliest slot's
  `date`+`key`; a single-slot and a multi-slot (earliest-picked) case.
- **JS**: pure hash-parse helper for the boot deep-link (`parseDayHash("#day/2026-07-11/...")`
  → `{date, key}` / null) unit-tested. The service-worker handlers, the `postMessage` path,
  the iOS-guidance rendering, and the intro gating are verified on-device (browser APIs).
- **On-device**: force a send, tap the notification → lands on the correct Day view scrolled
  to + highlighting the freed slot (both app-open and cold-open paths); on an
  iOS-Safari-not-installed context, the Settings section shows the add-to-home-screen guidance.

## Out of scope

- **Beta/GA promotion** (separate later step; the intro `VERSION` bump goes with it).
- **Multi-slot deep-link** to more than the earliest slot's day (one target per tap).
- **Scroll-to-slot inside Last-minute** (superseded by the Day-view deep-link).
- **Non-iOS install prompts** (Android web push works without install).
