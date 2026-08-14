# Guest (logged-out) availability mode — design

**Date:** 2026-08-14
**Status:** approved (design), ready for planning
**Scope:** `app/` (client only — no new API; uses the existing public endpoint)

## Problem / goal

Availability and weather are **public** — `getCourseRuns` hits `…/public/courseRuns` with no
token (api.js:43), and the forecast is public. Yet the app gates *everything* behind login:
boot is `if (getToken()) loadAndRender(); else go("login")` (app.js:246), and `go()` bails out
of every data route when there's no `state`. So a first-time / logged-out visitor is sent
straight to a sign-in wall and never sees availability — the worst first impression, and the
one where the new cold-open splash would shine most.

Let logged-out visitors **browse public availability** (splash → Availability → Last-minute →
Day → weather), with sign-in required only for the *personal* features (Bookings, cancel,
notifications). "Book ↗" already links out to the Lagoon booking site, so booking works
logged-out today.

## Decisions (agreed)

- **Entry:** logged-out visitors land **straight on Availability** (no wall); the splash greets
  them too.
- **Personal bits:** all three nav tabs stay visible; the **Bookings** tab shows a friendly
  **sign-in prompt** when logged out; notifications/cancel likewise prompt sign-in.
- **Sign-in affordance:** a **header button** — "Sign in" when logged out, "Sign out" when
  logged in — beside the ⚙ gear.
- **After signing in from the Bookings prompt:** return to **Bookings** (else land on the
  default page).
- **Rollout:** behind `FEATURES.guestMode`, `internal` → `beta` → `on` → remove flag.

## Golden rule (additive gating)

Every change is gated by `isOn("guestMode")`. With the flag off (all non-opted-in users), the
boot path, the header, the Bookings tab, and Settings behave **exactly as today** (login wall).
The guest flow is a new alternative path, never a change to the existing one. At GA the flag is
promoted then removed and guest mode becomes the only entry.

## Architecture

### 1. Token-optional data load (`data.js`)

`loadEverything` currently assumes a token and fetches `me`, `me/bookings`, `me/memberships`,
`me/packages` (all authed) plus `courseRuns` + weather (public). Split it so a missing token
loads only the public data:

- **Signed in (token present):** unchanged — full personal + public load.
- **Guest (no token):** fetch **only** `courseRuns` (per active discipline) + weather. Return
  `{ me: null, meBookings: [], memberships: [], packages: [], agenda, weather }`.
  `buildAgenda` runs with `meBookings: []`, `meId: null` → availability with no booked overlay
  (the overlay code already no-ops on empty bookings). State shape is otherwise identical, so
  every downstream view works unchanged.

Suggested shape: keep `loadEverything(token, now)` and, when `!token`, take the public-only
branch (a small internal `loadPublic(now)` helper). The caller (`loadState`) already handles
the returned object generically.

### 2. Boot gate & session transitions (`app.js`)

- **Boot** (app.js:246):
  ```
  if (getToken())          loadAndRender();      // full load → Availability (splash)
  else if (isOn("guestMode")) loadAndRender();   // public load → Availability (splash)
  else                     go("login");          // unchanged: login wall
  ```
  `loadAndRender` → `reload(null, true)` → `loadState()` → `loadEverything(getToken())`
  (token may be null) → lands on the default page. The splash shows on the guest path too.
- **`loadState`:** `loadEverything(getToken())` — pass the (possibly null) token through.
- **Expired token (401):** today `loadState` calls `logout()` and rethrows. With guestMode on,
  `logout()` should drop to **guest browsing**, not the login wall (see below), so a lapsed
  session degrades gracefully into public availability.
- **`logout()`** (app.js:172): today `clearToken(); state = null; go("login")`. With guestMode
  on → `clearToken();` then **re-load public availability** (`loadAndRender()`), landing on
  Availability. With the flag off → unchanged (`go("login")`).

### 3. Navigation & personal gating

- **Nav tabs:** all three stay visible in guest mode (`afterLoad` already reveals Last-minute
  for wake). Availability / Last-minute / Day / weather / the wake⇄SUP switch all work on the
  guest `state` (which has an `agenda`). `updateDisciplineToggle`'s `show = !!state` is already
  satisfied by the guest state.
- **Bookings tab, logged out** (`account.js`): when there's no signed-in user
  (`!state.me` / no token), render a **sign-in panel** instead of the booking cards/caps/tabs:
  a short line ("Sign in to see and manage your bookings") + a **Sign in** button that routes to
  login with a *return-to-Bookings* intent (see §4). The History/Extras sub-tabs are personal
  too, so the whole Bookings view becomes the prompt when logged out.
- **Settings** (`settings.js`): works logged-out as today (it already renders without `state`).
  The **notifications** section shows a "Sign in to set up spot alerts" prompt (with a Sign in
  button) instead of the toggle/controls when logged out. Theme, default page, Café, About,
  Share all work unchanged. The existing "Log out" button (settings.js:130) stays as-is
  (already gated on being signed in); the header adds a second, always-visible control (see §4)
  — at GA we may drop the Settings one to avoid duplication (optional cleanup, noted).

### 4. Sign-in / sign-out affordance

- **Header button** (`index.html` header + `app.js`): a small button beside ⚙, gated on
  `isOn("guestMode")`:
  - logged out → **"Sign in"** → `go("login")`.
  - logged in → **"Sign out"** → `logout()`.
  Hidden entirely when the flag is off (header unchanged for non-opted-in users). Updated
  whenever the session state changes (a small `updateAuthButton()` alongside
  `updateDisciplineToggle`, called from `afterLoad` and after login/logout).
- **Login view** (`login.js` / `renderLogin`): add a **‹ back/close** control (shown in guest
  mode) that returns to Availability — the login screen is no longer the root, so a guest who
  taps "Sign in" must be able to back out. Reuse the existing `.link` back-button style.
- **Return-to-tab after sign-in:** a module-level `postLoginRoute` in `app.js`. When "Sign in"
  is initiated from the **Bookings** prompt, set `postLoginRoute = "account"`. `onLoggedIn`
  (after the full load) navigates to `postLoginRoute ?? getDefaultLanding()`, then clears it.
  From the header "Sign in" it stays null → default landing.

### 5. Analytics / notifications notes

- **Push notifications** are a signed-in feature (subscriptions are per user/day/type) — the
  Settings prompt covers this; nothing else changes.
- **RUM** (currently `internal`/dormant) would naturally capture guest route views once live —
  desirable for measuring guest engagement, no work needed here.

## Out of scope (future)

- **In-app booking** — the separately-requested feature — is a *signed-in* capability for its
  own spec. "Book ↗" continues to deep-link to the Lagoon booking site for everyone. The
  guest/signed-in split defined here is the natural seam for it later (guest = browse,
  signed-in = personal + book in-app).
- No new API endpoints; no change to the watcher/AWS.

## Testing

- **`data.js` public-load path:** with no token, `loadEverything` fetches courseRuns + weather
  only (mock fetch asserts the `me*` endpoints are NOT called) and returns `me:null` + empty
  personal arrays + a built agenda.
- **`buildAgenda` with no bookings/`meId`:** already covered by existing tests (empty overlay);
  add an explicit guest case if useful.
- **Boot-gate decision** as a small pure predicate if practical (token? / guestMode? → full /
  public / login), unit-tested; otherwise the boot glue is manual.
- **View behaviour** (Bookings prompt, header button, login back) is DOM glue — verify the
  full suite stays green and do a manual pass (served locally, and by toggling the flag).
- Manual: with `guestMode` on and no token, cold open → splash → Availability; Bookings → prompt;
  Sign in → login (with back) → sign in → returns to Bookings; Sign out → back to guest
  Availability. With the flag **off**, everything is exactly as today (login wall).

## Housekeeping

- New flag `FEATURES.guestMode: "internal"` in `config.js`.
- Version bump at implementation (**v97 → v98**): `sw.js` `CACHE` + `config.js` `APP_RELEASE`.
- Deploy is separate (the daves-adventures "Deploy Hugo Site (AWS)" workflow).
