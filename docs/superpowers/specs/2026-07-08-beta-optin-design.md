# Beta opt-in — design

**Date:** 2026-07-08
**Status:** approved, ready for implementation plan
**Area:** `app/` (PWA)

## Summary

Build the Settings control that lets any user opt into beta features by flipping the
`lagoon.betaOptIn` localStorage flag. The feature-gating scaffold already exists
(`app/js/features.js`) and reads this flag via `optedIn()`; the comment there notes it
is "set by a future Settings toggle (not built yet)". This is that toggle, plus a small
tidy so the flag is owned by `store.js` like every other setting.

Opting in today unlocks nothing *visible* beyond the **BETA** badge, because `FEATURES`
in `config.js` is currently empty. This is deliberate scaffolding: the first time a
feature is gated at the `beta` tier, opted-in users will see it with no further wiring.

## Decisions (from brainstorming)

- **Discoverability: public toggle, always visible.** A "Beta features" switch in
  Settings that anyone can find and flip. Not hidden behind a gesture, and shown even
  when no beta feature is currently live.
- **Allowlisted testers: locked-on.** A user in `BETA_TESTERS` already has beta access
  (the allowlist is a separate, stronger grant), so the switch renders **on and
  disabled** with the caption "Enabled for testers." The allowlist always wins;
  the opt-in flag is a second, independent path to the same `beta` tier.
- **Control style: iOS-style toggle switch** (not the segmented On/Off `.seg` bar). It
  handles the disabled/locked state more naturally.

## Changes

### 1. `app/js/store.js` — own the key

Add a getter/setter beside the other settings, matching the existing pattern
(private key const + `try/catch`-guarded accessors):

```js
const BETA_OPTIN_KEY = "lagoon.betaOptIn";
export function getBetaOptIn() {
  try { return localStorage.getItem(BETA_OPTIN_KEY) === "1"; } catch { return false; }
}
export function setBetaOptIn(on) {
  try { localStorage.setItem(BETA_OPTIN_KEY, on ? "1" : "0"); } catch {}
}
```

Storing `"0"` explicitly (rather than removing the key) means an allowlisted tester who
would otherwise inherit nothing has a clear stored value, and keeps the setter symmetric.
Any non-`"1"` value reads as false, so this is backwards-compatible with the current
`=== "1"` check.

### 2. `app/js/features.js` — read through the store, expose allowlist status

- `optedIn()` calls `getBetaOptIn()` (imported from `store.js`) instead of reading
  `localStorage` directly. Remove the local `BETA_OPTIN_KEY` const and the inline
  `localStorage` access.
- `tierAllows`, `isOn`, `isBetaUser` are **unchanged** in behaviour.
- Export a thin `isAllowlisted(state)` wrapper over the existing private `inAllowlist`,
  so `settings.js` can render the locked state without reaching into allowlist internals.

### 3. `app/js/views/settings.js` — a "Beta" section in the Settings tab

Placement: in the **Settings** tab (not About), below the Calendar section, above the
Data section.

- Import `getBetaOptIn`, `setBetaOptIn` from `store.js` and `isAllowlisted` from
  `features.js`.
- Render a `.set-row` containing a label ("Beta features") and a toggle switch:
  - **Allowlisted user** (`isAllowlisted(state)` true): switch is `on` + `disabled`,
    caption below reads *"Enabled for testers."*
  - **Everyone else:** switch reflects `getBetaOptIn()`. On change →
    `setBetaOptIn(checked)`, then `renderSettings(view, state, go)` (same re-render
    pattern the theme `.seg` buttons use). Caption reads
    *"Try in-progress features early. They may be rough or change."*
- Re-rendering on toggle makes the **BETA badge** in the About tab update live, and any
  future `beta`-gated Settings UI refresh, without a manual reload.
- Add the toggle-switch CSS (~10 lines) to `injectSettingsStyles()`, using the existing
  `--accent` / `--border` / `--surface` theme variables so it themes with light/dark.

Note: pre-login, `renderSettings` is called with `state` falsy. The Beta section lives
in the Settings tab which already renders pre-login, and `isAllowlisted(state)` handles a
falsy/absent `state.me` (returns false), so a signed-out user simply sees the normal
interactive switch. This is consistent with the existing scaffold, which reads opt-in
independent of login.

### 4. Version bump (the rule that bites)

Touched files are all existing JS (`store.js`, `features.js`, `views/settings.js`) — no
new files — so:

- `app/js/config.js`: `APP_RELEASE = "v47"` → `"v48"`.
- `app/sw.js`: bump `CACHE` to the matching `lagoon-v48`.
- `ASSETS` precache list is **unchanged** (no new files).

### 5. Tests (Node's runner, fully mocked, no network)

- **`app/test/store.test.js`:** add a `get/setBetaOptIn` round-trip using the existing
  `global.localStorage` Map backing already set up at the top of that file
  (unset → false; `setBetaOptIn(true)` → true; `setBetaOptIn(false)` → false).
- **`app/test/features.test.js`:** this file currently has no `localStorage` stub, so
  `optedIn()` always returns false there. Add the same `global.localStorage` Map backing
  used in `store.test.js`, then cover:
  - opted-in (non-allowlist) makes `tierAllows("beta", other)` and `isBetaUser(other)`
    true;
  - opting back out returns them to false;
  - an allowlisted user is beta **regardless** of the opt-in value (allowlist wins even
    when opted-out / stored `"0"`);
  - `isAllowlisted(dave)` true, `isAllowlisted(other)` false, `isAllowlisted(null)` false.
  - Clear the Map between assertions (as `store.test.js` does with `mem.clear()`).

## Data flow

```
toggle change → setBetaOptIn(checked)  → localStorage "lagoon.betaOptIn"
             → renderSettings(...)      → isBetaUser()/isOn() read new value
                                        → BETA badge + any beta-gated UI reflect it
```

No network calls, no mutation of the loaded `state` object, no interaction with the
live Lagoon API. Purely a client-side display preference.

## Out of scope

- No new gated features — `FEATURES` stays empty; this only builds the opt-in path.
- No server-side / cross-device sync of the preference (localStorage is per-device, like
  every other setting here).
- No change to the allowlist mechanism or `BETA_TESTERS`.
```
