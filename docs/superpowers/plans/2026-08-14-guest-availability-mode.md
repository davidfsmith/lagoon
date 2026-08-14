# Guest (logged-out) Availability Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let logged-out visitors browse public availability (splash → Availability → Last-minute → Day → weather), with sign-in required only for personal features (Bookings, cancel, notifications), all behind a `guestMode` flag.

**Architecture:** Availability + weather are public (`…/public/courseRuns`, no token). Add a token-optional data load and a `guestMode`-gated boot path so a missing token loads public data and lands on Availability instead of the login wall. Personal surfaces (Bookings tab, Settings notifications) render sign-in prompts when logged out; a header button toggles Sign in / Sign out. Every change is gated by `isOn("guestMode")` so non-opted-in users hit today's exact login-wall path.

**Tech Stack:** Vanilla JS ES modules, no build, no dependencies. Node's built-in test runner.

## Global Constraints

- **No dependencies, no build, no framework.** Plain `.js`/`.html` the browser runs as-is.
- **Golden rule — additive gating:** with `guestMode` off, boot, header, Bookings, and Settings behave EXACTLY as today. All new behaviour is behind `isOn("guestMode")`.
- **"Signed in" = `getToken()` truthy.** Use this (not `!!state`) to distinguish a guest (has `state`, no token) from a signed-in user.
- **Version bump v97 → v98** at the end: `sw.js` `CACHE` + `config.js` `APP_RELEASE`, together. No new files → `ASSETS` unchanged.
- **No new API endpoints**; the public course-runs endpoint already exists.
- Match surrounding style; terse *why* comments.
- Design reference: `docs/superpowers/specs/2026-08-14-guest-availability-mode-design.md`.

---

### Task 1: Flag, `bootMode` helper, and token-optional data load

Foundation: the flag, a pure boot-decision helper (unit-tested), and the public-only load path.

**Files:**
- Modify: `app/js/config.js` (add `guestMode` to `FEATURES`)
- Modify: `app/js/features.js` (add `bootMode`)
- Modify: `app/js/data.js` (public-only branch in `loadEverything`)
- Test: `app/test/features.test.js`

**Interfaces:**
- Produces: `bootMode(hasToken, guestEnabled) -> "full" | "public" | "login"` (pure).
- Produces: `loadEverything(token, now)` — when `token` is falsy, returns
  `{ me:null, meBookings:[], memberships:[], packages:[], agenda, weather }` from public data only.

- [ ] **Step 1: Add the flag**

In `app/js/config.js`, add to `FEATURES`:

```js
export const FEATURES = {
  cancelSuppress: "internal", // don't self-notify about a slot you just cancelled (dev-only while built out)
  rum: "internal", // first-party cookieless usage analytics (dev-only while validated)
  guestMode: "internal", // browse public availability without signing in (dev-only while built out)
};
```

- [ ] **Step 2: Write the failing `bootMode` test**

Add to `app/test/features.test.js` (it already stubs `localStorage` and imports from `../js/features.js` — extend that import to include `bootMode`):

```js
test("bootMode: token → full; no token + guest on → public; no token + guest off → login", () => {
  assert.equal(bootMode(true, false), "full");   // signed in → always full
  assert.equal(bootMode(true, true), "full");
  assert.equal(bootMode(false, true), "public"); // guest browsing
  assert.equal(bootMode(false, false), "login"); // unchanged login wall
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test app/test/features.test.js`
Expected: FAIL — `bootMode is not defined`.

- [ ] **Step 4: Implement `bootMode`**

Add to `app/js/features.js`:

```js
// Boot routing decision (pure): signed in → full personal+public load; else if guest mode
// is enabled → public-only load; else the classic login wall. Kept pure for testing; the
// caller passes getToken()-presence and isOn("guestMode").
export function bootMode(hasToken, guestEnabled) {
  if (hasToken) return "full";
  return guestEnabled ? "public" : "login";
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test app/test/features.test.js`
Expected: PASS.

- [ ] **Step 6: Add the public-only load path**

In `app/js/data.js`, split `loadEverything` so a missing token loads only public data. Replace the current file body with:

```js
import { authedGet, getCourseRuns } from "./api.js";
import { fetchForecast } from "./weather.js";
import { buildAgenda } from "./agendaModel.js";
import { HOVE, HORIZON_DAYS } from "./config.js";
import { activeCourses } from "./features.js";

// Fetch course runs (public) for the active discipline + weather, degrading per-course so
// one failing course doesn't blank the agenda. Shared by both the signed-in and guest paths.
async function loadRunsAndWeather() {
  const weather = await fetchForecast(HOVE.lat, HOVE.lon).catch(() => null); // best-effort
  const courses = activeCourses();
  const results = await Promise.all(courses.map(async (c) => {
    try { return { id: c.id, runs: await getCourseRuns(c.id), ok: true }; }
    catch { return { id: c.id, runs: [], ok: false }; }
  }));
  if (results.every(r => !r.ok)) throw new Error("courseRuns unavailable");
  const runsByCourse = {};
  for (const r of results) runsByCourse[r.id] = r.runs;
  return { courses, runsByCourse, weather };
}

export async function loadEverything(token, now = new Date()) {
  // Guest (no token): public availability only — no personal calls.
  if (!token) {
    const { courses, runsByCourse, weather } = await loadRunsAndWeather();
    const agenda = buildAgenda({ runsByCourse, courses, meBookings: [], meMemberships: [], weather, now, horizonDays: HORIZON_DAYS, meId: null });
    return { me: null, meBookings: [], memberships: [], packages: [], agenda, weather };
  }
  // Signed in: personal data + public availability.
  const [me, bookingsRes, memberships, packages] = await Promise.all([
    authedGet("me", token),
    authedGet("me/bookings", token),
    authedGet("me/memberships", token),
    authedGet("me/packages", token),
  ]);
  const meBookings = Array.isArray(bookingsRes) ? bookingsRes : (bookingsRes.data || []);
  const { courses, runsByCourse, weather } = await loadRunsAndWeather();
  const agenda = buildAgenda({ runsByCourse, courses, meBookings, meMemberships: memberships, weather, now, horizonDays: HORIZON_DAYS, meId: me && me.id });
  return { me, meBookings, memberships, packages, agenda, weather };
}
```

(This preserves the signed-in behaviour — same calls, same shape — and adds the guest branch. The per-course degrade and `courseRuns unavailable` throw are retained via `loadRunsAndWeather`.)

- [ ] **Step 7: Run the full suite**

Run: `node --test app/test/*.test.js`
Expected: PASS (existing `data.js` behaviour unchanged; `bootMode` covered).

- [ ] **Step 8: Commit**

```bash
git add app/js/config.js app/js/features.js app/js/data.js app/test/features.test.js
git commit -m "feat: guestMode flag, bootMode helper, token-optional public data load"
```

---

### Task 2: Session, auth affordance & sign-in flow

The app-glue core: boot gate, guest-aware logout, return-to-tab after sign-in, the header Sign in / Sign out button, and a back control on the login screen.

**Files:**
- Modify: `app/js/app.js` (boot gate, `loadState`, `logout`, `loadAndRender(target)`, `onLoggedIn`, `signIn` export, `updateAuthButton` + wiring)
- Modify: `app/index.html` (header Sign in/out button + style)
- Modify: `app/js/views/login.js` (‹ back control in guest mode)

**Interfaces:**
- Consumes: `bootMode` (Task 1).
- Produces: `signIn(returnRoute?)` exported from `app.js` — sets the post-login target and navigates to the login screen. Used by Task 3 (`signIn("account")`) and Task 4.

- [ ] **Step 1: Header markup + style (`index.html`)**

In `app/index.html`, replace the header's settings button with a right-side group containing the auth button and the gear. Change (lines ~105-110):

```html
    <button id="btn-settings" class="icon-btn" aria-label="Settings" title="Settings">⚙</button>
```
to:
```html
    <div class="hdr-right">
      <button id="auth-btn" class="auth-btn" hidden></button>
      <button id="btn-settings" class="icon-btn" aria-label="Settings" title="Settings">⚙</button>
    </div>
```

And add to the shell `<style>` (near the `.icon-btn` rule, ~line 68):

```css
    .hdr-right { display:flex; align-items:center; gap:8px; }
    .auth-btn { background:none; border:1px solid var(--border); color:var(--accent);
      font-size:12px; font-weight:600; padding:5px 11px; border-radius:8px; cursor:pointer; }
    .auth-btn[hidden] { display:none; }
```

- [ ] **Step 2: Login screen back control (`login.js`)**

In `app/js/views/login.js`, accept `go` and show a ‹ back (guest mode only) that returns to Availability. Change the signature and prepend the back button:

```js
import { login } from "../api.js";
import { setToken } from "../store.js";
import { BOOKING_SITE } from "../config.js";
import { isOn } from "../features.js";

export function renderLogin(view, onLoggedIn, go) {
  const back = isOn("guestMode") && go
    ? `<button class="link" id="login-back">‹ Back</button>` : "";
  view.innerHTML = `
    ${back}
    <h2>Sign in</h2>
    <p class="muted">Use your existing <b>Lagoon Watersports</b> account — the same
      email &amp; password you use to book sessions online. We only store an access
      token on this device, never your password.</p>
    <input id="email" type="email" placeholder="Email" autocomplete="username">
    <input id="password" type="password" placeholder="Password" autocomplete="current-password">
    <button class="primary" id="signin">Sign in</button>
    <p id="err" class="err"></p>
    <p class="signup">Don't have a Lagoon account?
      <a href="${BOOKING_SITE}/auth/login" target="_blank" rel="noopener">Create one on the Lagoon booking site ↗</a></p>`;
  injectLoginStyles();
  const backBtn = view.querySelector("#login-back");
  if (backBtn) backBtn.addEventListener("click", () => go("agenda"));
  const err = view.querySelector("#err");
  const btn = view.querySelector("#signin");
  btn.addEventListener("click", async () => {
    err.textContent = "";
    const email = view.querySelector("#email").value.trim();
    const password = view.querySelector("#password").value;
    if (!email || !password) { err.textContent = "Enter email and password."; return; }
    btn.disabled = true; btn.textContent = "Signing in…"; // show the click registered
    try {
      const token = await login(email, password);
      setToken(token);
      await onLoggedIn(); // navigates away on success
    } catch (e) {
      err.textContent = "Sign-in failed. Check your details.";
      btn.disabled = false; btn.textContent = "Sign in";
    }
  });
}
```

(Reuse the shared `.link` back-button style already defined in day.js/settings.js CSS — it's global once injected; `injectLoginStyles` needs no change. If the ‹ Back button appears unstyled when login is the first screen shown, add a minimal `.link{…}` fallback to `injectLoginStyles` — verify during the manual check.)

- [ ] **Step 3: `app.js` — boot gate, session transitions, auth button**

In `app/js/app.js`:

Add imports:
```js
import { justOpenedKeys, sessionsInWindow } from "./model.js";
import { isOn, bootMode } from "./features.js"; // add bootMode; keep existing isOn usage
```
(If `isOn` isn't already imported in app.js, add it; it's used by `setLastMinuteIcon`/others already — merge into the existing import line.)

Add a module-level post-login target near the other `let` state (~line 24):
```js
let postLoginRoute = null; // where to land after a successful sign-in (e.g. "account")
```

Generalise `loadAndRender` to accept a target, and use it from `onLoggedIn`:
```js
async function loadAndRender(target = null) {
  await reload(target, true);
  if (state && pendingDay) { go("day", pendingDay); pendingDay = null; return; }
  if (state) maybeShowIntro();
}
```

`onLoggedIn` honours the post-login target:
```js
async function onLoggedIn() {
  const target = postLoginRoute; postLoginRoute = null;
  await loadAndRender(target); // target null → default landing
  rum.event("login_success");
}
```

Export `signIn` (used by the header and the Bookings/Settings prompts):
```js
// Begin sign-in, remembering where to return afterwards (null → default landing).
export function signIn(returnRoute = null) { postLoginRoute = returnRoute; go("login"); }
```

Guest-aware `logout`:
```js
export function logout() {
  clearToken();
  state = null;
  if (isOn("guestMode")) { loadAndRender(); return; } // drop to public browsing, not a wall
  go("login");
}
```

`loadState` passes the (possibly null) token — it already calls `loadEverything(token)` with `token = getToken()`, so no change is needed beyond confirming it reads `getToken()` (it does).

The auth button updater + wiring. Add near `updateDisciplineToggle`:
```js
// Header Sign in / Sign out button — only in guest mode; hidden on the login screen itself.
function updateAuthButton() {
  const b = document.getElementById("auth-btn");
  if (!b) return;
  if (!isOn("guestMode") || currentRoute === "login") { b.hidden = true; return; }
  b.hidden = false;
  b.textContent = getToken() ? "Sign out" : "Sign in";
}
```
Wire its click once (near the settings-button wiring, ~line 132):
```js
document.getElementById("auth-btn").addEventListener("click", () => {
  if (getToken()) logout(); else signIn();
});
```
Call `updateAuthButton()` whenever the session/route changes — add a call at the end of `afterLoad()` and inside `go()` right after `currentRoute = route;`:
```js
// in afterLoad(): after updateDisciplineToggle();
updateAuthButton();
// in go(): immediately after `currentRoute = route;`
updateAuthButton();
```

The boot block (bottom of app.js, ~line 246) uses `bootMode`:
```js
const mode = bootMode(!!getToken(), isOn("guestMode"));
if (mode === "login") go("login"); else loadAndRender();
```

`go("login")` passes `go` to `renderLogin` so the back control works:
```js
if (route === "login") { nav.hidden = true; if (discToggle) discToggle.hidden = true; updateAuthButton(); renderLogin(view, onLoggedIn, go); return; }
```
(`getToken` is already imported in app.js line 1.)

- [ ] **Step 4: Run the full suite**

Run: `node --test app/test/*.test.js`
Expected: PASS (no unit-tested behaviour changed; this is boot/DOM glue).

- [ ] **Step 5: Manual smoke (served locally, flag ON)**

`cd app && python3 -m http.server 8123`. In the browser console set the internal opt-in so `guestMode` is active (`localStorage['lagoon.internalOptIn']='1'`) and clear any token (`localStorage.removeItem('lagoon.token')`), then reload. Confirm: cold open → splash → Availability (no login wall); header shows "Sign in"; tapping it → login with a ‹ Back; Back → Availability; signing in → loads and (from the header) lands on the default page; header now shows "Sign out"; Sign out → back to guest Availability. Then flip the flag off (`localStorage.removeItem('lagoon.internalOptIn')`), reload with no token → the login wall returns unchanged.

- [ ] **Step 6: Commit**

```bash
git add app/js/app.js app/index.html app/js/views/login.js
git commit -m "feat: guest-mode boot gate, header Sign in/out, login back, return-to-tab"
```

---

### Task 3: Bookings tab sign-in prompt

**Files:**
- Modify: `app/js/views/account.js` (early guest branch in `renderAccount`)

**Interfaces:**
- Consumes: `signIn` from `app.js` (Task 2).

- [ ] **Step 1: Render a sign-in prompt when logged out**

In `app/js/views/account.js`, `getToken` (from `../store.js`, line 4) and `isOn` (from `../features.js`, line 7) are **already imported**. Only add `signIn` to the existing app import:

```js
import { logout, signIn } from "../app.js"; // was: import { logout } from "../app.js";
```

At the very top of `renderAccount(view, state, go)`, before it reads `state.me`, add the guest branch:

```js
export function renderAccount(view, state, go) {
  // Guest (logged-out) browsing: Bookings is a personal surface — prompt sign-in.
  if (isOn("guestMode") && !getToken()) {
    view.innerHTML = `<h2>Bookings</h2>
      <div class="bkrow" style="flex-direction:column;align-items:flex-start;gap:10px">
        <div class="muted">Sign in with your Lagoon account to see and manage your bookings, ride passes and alerts.</div>
        <button class="primary" id="bk-signin">Sign in</button>
      </div>`;
    view.querySelector("#bk-signin").addEventListener("click", () => signIn("account"));
    injectAccountStyles();
    return;
  }
  const me = state.me || {};
  // …existing body unchanged…
```

(`injectAccountStyles` is defined at the bottom of the file — calling it keeps `.bkrow`/`.muted` styled. The early return runs before any personal-data logic.)

- [ ] **Step 2: Run the suite + manual**

Run: `node --test app/test/*.test.js` → all pass.
Manual (flag on, no token): the Bookings tab shows the prompt; "Sign in" → login → after signing in you land back on **Bookings** (via `signIn("account")` → `postLoginRoute`).

- [ ] **Step 3: Commit**

```bash
git add app/js/views/account.js
git commit -m "feat: Bookings tab shows a sign-in prompt for guests"
```

---

### Task 4: Settings notifications prompt + logout gating

**Files:**
- Modify: `app/js/views/settings.js` (notifications prompt when logged out; gate "Log out" on `getToken()`)

**Interfaces:**
- Consumes: `signIn` from `app.js` (Task 2).

- [ ] **Step 1: Imports**

In `app/js/views/settings.js`, add `getToken` to the existing `../store.js` import, and `signIn` to the existing `../app.js` import (`import { logout, switchDiscipline } from "../app.js"` → add `signIn`).

- [ ] **Step 2: Notifications prompt for guests**

The Notifications section currently renders `${notifBodyHtml()}` (line ~117). Gate it so a guest sees a sign-in prompt instead of the toggle:

```js
    <div class="t" style="margin-top:18px">Notifications</div>
    <div class="set-cap" style="margin:0 2px 6px">🏄 Wakeboarding sessions only.</div>
    ${isOn("guestMode") && !getToken()
      ? `<div class="set-cap">Sign in to set up spot alerts.</div>
         <button class="primary" id="notif-signin" style="margin-top:6px">Sign in</button>`
      : notifBodyHtml()}
```

- [ ] **Step 3: Gate "Log out" on being signed in**

The Data block (line ~127-130) is gated on `state`, but a guest has `state`. Keep the "Last refreshed" line for anyone with data, but show "Log out" only when signed in. Replace:

```js
    ${state ? `<div class="t" style="margin-top:18px">Data</div>
    <div class="set-row"><span>Last refreshed</span><span class="muted" id="set-refreshed">${agoText(state.refreshedAt)}${state.stale ? " (saved)" : ""}</span></div>

    <button class="primary" id="logout" style="margin-top:18px">Log out</button>` : ""}
```
with:
```js
    ${state ? `<div class="t" style="margin-top:18px">Data</div>
    <div class="set-row"><span>Last refreshed</span><span class="muted" id="set-refreshed">${agoText(state.refreshedAt)}${state.stale ? " (saved)" : ""}</span></div>` : ""}

    ${getToken() ? `<button class="primary" id="logout" style="margin-top:18px">Log out</button>` : ""}
```

(With the flag off, `state` is truthy only when signed in, so `getToken()` matches the old behaviour — no visible change for non-guest users.)

- [ ] **Step 4: Wire the notifications sign-in button**

In `renderSettings`, where the other controls are wired (after `view.innerHTML = …`), add:

```js
  const notifSignin = view.querySelector("#notif-signin");
  if (notifSignin) notifSignin.addEventListener("click", () => signIn());
```

- [ ] **Step 5: Run the suite + manual**

Run: `node --test app/test/*.test.js` → all pass.
Manual (flag on, no token): Settings → Notifications shows "Sign in to set up spot alerts" + button; no "Log out" button while logged out; signing in restores the toggle and the Log out button.

- [ ] **Step 6: Commit**

```bash
git add app/js/views/settings.js
git commit -m "feat: Settings notifications sign-in prompt; gate Log out on signed-in"
```

---

### Task 5: Version bump v97 → v98

**Files:**
- Modify: `app/sw.js:1`
- Modify: `app/js/config.js:63`

- [ ] **Step 1: Bump the cache name**

`app/sw.js` line 1 → `const CACHE = "lagoon-v98";` (no `ASSETS` change — no new files).

- [ ] **Step 2: Bump the app release**

`app/js/config.js` → `export const APP_RELEASE = "v98"; // release/version — bump together with sw.js CACHE`

- [ ] **Step 3: Verify + full suite**

Run:
```sh
grep -n "lagoon-v98" app/sw.js
grep -n 'APP_RELEASE = "v98"' app/js/config.js
node --test app/test/*.test.js
```
Expected: both match; all tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/sw.js app/js/config.js
git commit -m "chore: bump app to v98 (guest availability mode)"
```

---

## Self-Review

**Spec coverage:**
- Token-optional public load (me:null, empty personal, agenda) → Task 1 (`loadEverything` guest branch). ✓
- Boot gate token/guest/login → Task 1 (`bootMode`) + Task 2 (boot wiring). ✓
- Guest-aware logout / 401 degrade → Task 2 (`logout`). (401 path: `loadState` calls `logout()`, which now drops to guest browsing when the flag is on.) ✓
- Land on Availability; splash for guests → Task 2 (boot → `loadAndRender` → default landing; splash already in `#view`). ✓
- Bookings tab sign-in prompt; return to Bookings → Task 3 (`signIn("account")`) + Task 2 (`postLoginRoute`). ✓
- Header Sign in/Sign out → Task 2 (`updateAuthButton` + markup). ✓
- Login ‹ back → Task 2 (`login.js`). ✓
- Settings notifications prompt; Log out gated on signed-in → Task 4. ✓
- Flag internal, additive gating → Task 1 (flag) + `isOn("guestMode")` guards throughout. ✓
- Version bump v97→v98 → Task 5. ✓
- In-app booking parked (out of scope) → not implemented (correct). ✓

**Placeholder scan:** none — every step carries real code. The one conditional note (login `.link` fallback style) is a verify-during-manual item, not a placeholder.

**Type consistency:** `bootMode(hasToken, guestEnabled)` returns `"full"|"public"|"login"`, consumed in the boot block (Task 2) and tested (Task 1). `signIn(returnRoute?)` exported from app.js (Task 2), called as `signIn("account")` (Task 3) and `signIn()` (Task 2 header, Task 4). `loadEverything(token)` guest branch returns the same shape the signed-in branch does (`me, meBookings, memberships, packages, agenda, weather`), matching `loadState`'s generic spread. "Signed in" is uniformly `getToken()` across app.js/account.js/settings.js.
