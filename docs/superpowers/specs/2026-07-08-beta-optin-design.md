# Beta opt-in (two-level) — design

**Date:** 2026-07-08
**Status:** approved, ready for implementation plan
**Area:** `app/` (PWA)

## Summary

Replace the hard-coded beta allowlist (`BETA_TESTERS = [9720]`) with **two client-side
opt-in levels**, and build the Settings UI for both. This gives a clean promotion path
for in-flight features (notably the upcoming push notifications):

- **Internal** (level 1) — a *hidden* developer opt-in, for features that are still being
  built. Only the developer enables it (via a version-tap gesture). Notifications will be
  gated here while we wire it up.
- **Beta** (level 2) — a *public*, always-visible Settings toggle any user can flip, for
  features that work but aren't General Availability yet.

The feature-gating scaffold already exists in `app/js/features.js` (`tierAllows`, `isOn`,
`isBetaUser`) and reads a `lagoon.betaOptIn` flag; the comment there notes it is "set by a
future Settings toggle (not built yet)". This work builds that toggle, adds the internal
level, and removes the allowlist.

Nothing is gated at `beta`/`internal` today (`FEATURES` in `config.js` is empty), so this
is infrastructure: opting in changes only the **BETA** badge until a feature uses a tier.

## Why remove the allowlist

Being permanently on the allowlist meant the developer could not easily *drop out* of beta
to reproduce a non-beta user's experience (or a bug in a non-beta feature) without cutting
a release to edit `BETA_TESTERS`. Making both levels plain client-side opt-ins means the
developer flips exactly the same switches as any user, and can move in/out of each level
instantly with no deploy.

## Decisions (from brainstorming)

- **Remove `BETA_TESTERS` / the allowlist entirely.** No user IDs are special.
- **Two levels, two localStorage flags** — `lagoon.internalOptIn`, `lagoon.betaOptIn`.
- **`internal` is a superset of `beta`:** an internal user sees every `beta` feature too.
- **Beta opt-in: public, always visible** — a plain interactive toggle in Settings for
  everyone. (The earlier "locked-on for allowlisted testers" idea is now moot — there is
  no allowlist.)
- **Internal opt-in: hidden, via a version-tap gesture** (~7 taps on the version row),
  which reveals a Developer section to toggle it back off. Keeps half-built features away
  from casual users while staying reachable inside the app on iOS/PWA. The user can opt
  **in** (gesture) and **out** (Developer toggle) freely, no deploy.
- **Distinct badge per level:** show a **`DEV`** badge (warning/amber) when internal is
  on, else a **`BETA`** badge (accent) when only beta is on, else none — so the active
  level is visible at a glance. (`DEV` label chosen for compactness; easy to reword.)
- **`state` argument dropped** from the `features.js` API — with the allowlist gone,
  nothing depends on `state.me.id`; the flags are read straight from `localStorage`.

## Audience model

Tiers keep their names (`off` / `internal` / `beta` / `on`); audience becomes:

| Tier | Seen by |
|------|---------|
| `off` | nobody |
| `internal` | internal opt-in |
| `beta` | internal **or** beta opt-in |
| `on` | everyone |

**Notifications lifecycle** falls out of this: gate it `"internal"` while building (only
the developer sees it) → promote to `"beta"` when it works (opted-in users try it) →
`"on"` / delete the flag at GA. No releases needed to move between levels.

## Changes

### 1. `app/js/config.js` — drop the allowlist

- Remove `export const BETA_TESTERS = [9720];`.
- Update the `FEATURES` comment block to describe the new audience model
  (`internal` = developer opt-in · `beta` = internal or beta opt-in · `on` = everyone).
- `FEATURES` itself stays `{}`.

### 2. `app/js/store.js` — own both flags

Add two getter/setter pairs beside the other settings, matching the existing pattern
(private key const + `try/catch`-guarded accessors, storing `"1"`/`"0"`):

```js
const BETA_OPTIN_KEY = "lagoon.betaOptIn";
export function getBetaOptIn() {
  try { return localStorage.getItem(BETA_OPTIN_KEY) === "1"; } catch { return false; }
}
export function setBetaOptIn(on) {
  try { localStorage.setItem(BETA_OPTIN_KEY, on ? "1" : "0"); } catch {}
}

const INTERNAL_OPTIN_KEY = "lagoon.internalOptIn";
export function getInternalOptIn() {
  try { return localStorage.getItem(INTERNAL_OPTIN_KEY) === "1"; } catch { return false; }
}
export function setInternalOptIn(on) {
  try { localStorage.setItem(INTERNAL_OPTIN_KEY, on ? "1" : "0"); } catch {}
}
```

Any non-`"1"` value reads as false, so this is backwards-compatible with the existing
`=== "1"` check in `features.js`.

### 3. `app/js/features.js` — two opt-ins, no allowlist, no `state`

Rewrite to read the flags from `store.js` and drop the allowlist:

```js
import { FEATURES } from "./config.js";
import { getBetaOptIn, getInternalOptIn } from "./store.js";

export function tierAllows(tier) {
  switch (tier) {
    case "on": return true;
    case "beta": return getBetaOptIn() || getInternalOptIn();
    case "internal": return getInternalOptIn();
    default: return false; // "off", undefined, unknown → safe default
  }
}
export function isOn(flag) { return tierAllows(FEATURES[flag]); }
export function isBetaUser() { return getBetaOptIn() || getInternalOptIn(); }

// Highest active level, for the badge: "internal" | "beta" | null.
export function accessTier() {
  if (getInternalOptIn()) return "internal";
  if (getBetaOptIn()) return "beta";
  return null;
}
```

- Delete `inAllowlist`, `optedIn`, the `BETA_OPTIN_KEY` const, and the `BETA_TESTERS`
  import.
- `isOn` / `isBetaUser` / `tierAllows` no longer take `state`. (`isBetaUser` is kept as a
  simple boolean for any "has any beta access" check; the badge uses `accessTier`.)
- `store.js` imports nothing from `features.js`, so no circular import.

### 4. `app/js/views/settings.js` — Beta toggle + hidden Developer section

**Settings tab**, below Calendar, above Data:

- **Beta features** row — a plain interactive toggle bound to `getBetaOptIn` /
  `setBetaOptIn`. On change → persist, then `renderSettings(view, state, go)` re-render
  (same pattern the theme `.seg` buttons use) so the BETA badge and any `beta`-gated UI
  update live. Caption: *"Try in-progress features early. They may be rough or change."*
- **Developer** section — rendered **only when `getInternalOptIn()` is true**. Contains an
  **Internal features** toggle bound to `getInternalOptIn` / `setInternalOptIn`; turning it
  off re-renders and the section disappears (re-do the gesture to bring it back). Caption:
  *"Unreleased, in-progress features. Expect breakage. Includes beta features."*

**About tab** — the version row (`Hove Lagoon … build/release/date`) becomes the gesture
target:

- A module-level `let devTaps = 0` counter (session-scoped; resets on reload — fine).
- Clicking the version row increments it; at **7** taps call `setInternalOptIn(true)` and
  re-render (the Developer section then appears in the Settings tab). If internal is
  already on, taps are a no-op.
- Replace the existing badge call `isBetaUser(state)` with `accessTier()`: render a
  `DEV` badge when it returns `"internal"`, a `BETA` badge when `"beta"`, nothing when
  `null`.

- Add the toggle-switch CSS (~10 lines) to `injectSettingsStyles()` using the existing
  `--accent` / `--border` / `--surface` theme variables so it themes with light/dark. The
  same switch markup serves both the Beta and Internal rows. Add a `.dev-badge` variant of
  the existing `.beta-badge` (warning/amber background) for the internal indicator.

Note on pre-login: the Settings tab renders with `state` falsy. The flags are read from
`localStorage` independent of login, so a signed-out user sees the normal Beta toggle
(and the Developer section iff already opted in). Consistent with the scaffold.

### 5. Version bump (the rule that bites)

Touched files are all existing JS (`config.js`, `store.js`, `features.js`,
`views/settings.js`) — no new files — so:

- `app/js/config.js`: `APP_RELEASE = "v47"` → `"v48"`.
- `app/sw.js`: bump `CACHE` to `lagoon-v48`.
- `ASSETS` precache list is **unchanged**.

### 6. Tests (Node's runner, fully mocked, no network)

Both files need the `global.localStorage` Map backing already used at the top of
`app/test/store.test.js` (copy that stub into `features.test.js`, which currently lacks
it). Clear the Map between assertions (`mem.clear()`).

- **`app/test/store.test.js`:** round-trip `get/setBetaOptIn` and `get/setInternalOptIn`
  (unset → false; set true → true; set false → false).
- **`app/test/features.test.js`:** rewrite around the two flags (no `state`):
  - neither flag → `isOn` for a `beta`/`internal` flag is false, `isBetaUser()` false;
  - beta only → `tierAllows("beta")` true, `tierAllows("internal")` false,
    `isBetaUser()` true;
  - internal only → both `tierAllows("beta")` and `tierAllows("internal")` true
    (superset), `isBetaUser()` true;
  - `tierAllows("on")` always true, `tierAllows("off")`/unknown always false;
  - `isOn` for an undefined flag is false;
  - `accessTier()`: `null` with neither flag, `"beta"` with beta only, `"internal"` when
    internal is on (even if beta is also on — internal wins).

## Data flow

```
toggle / 7-tap → set{Beta,Internal}OptIn(...) → localStorage flag
              → renderSettings(...)            → isBetaUser()/isOn() read new value
                                               → BETA badge + gated UI reflect it
```

No network calls, no mutation of the loaded `state`, no interaction with the live Lagoon
API. Purely a client-side display preference.

## Out of scope

- **The notifications feature itself** — this spec only builds the two-level gating it will
  later use. Web Push (SW handler, VAPID, subscription store, watcher send) is separate
  (see `docs/BACKLOG.md` Phase 2).
- No new gated features; `FEATURES` stays empty.
- No cross-device sync (localStorage is per-device, like every other setting).
```
