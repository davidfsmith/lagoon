# Cold-open Splash Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a sunset wakeboarding photo (band under the persistent header, over a dusk backdrop, with a loading cue) while availability loads on a cold open, then fade to the list.

**Architecture:** The splash markup + CSS live in `index.html` as the initial content of `<main id="view">`, so it paints on the first frame below the always-visible header — no positioning maths, header stays put. A tiny `splash.js` fades it out when data is ready, keeping it visible a minimum time and force-removing it after a safety timeout. Photo is an optimised WebP; consent (photographer Rob Goldings + rider) is cleared, so image and credit ship normally.

**Tech Stack:** Vanilla JS ES modules, no build, no dependencies. Node's built-in test runner.

## Global Constraints

- **No dependencies, no build, no framework.** Plain `.js`/`.html`/`.css` the browser runs as-is.
- **Version bump v96 → v97**: `sw.js` `const CACHE = "lagoon-v97"` **and** `js/config.js` `APP_RELEASE = "v97"`, together. Add the new files to `sw.js` `ASSETS`.
- **No feature flag** — straight GA.
- **Base-href gotcha:** the app runs at `/lagoon` (no trailing slash) with a JS-set `<base href="/lagoon/">`. A static `<link rel="preload">` is resolved by the preload scanner against the raw document URL (not `<base>`) and 404s at `/lagoon` — same reason `app.js` is loaded via JS (see index.html:117-126). So **do NOT add a `rel=preload` for the image**; the `<img>` in the initial markup resolves against `<base>` correctly and fetches it early enough.
- **Cold open only** — the splash lives in the boot path / initial `#view`; it must not appear on background→foreground resume.
- **Consent cleared:** Rob Goldings OK'd the photo (silhouette, nothing of his son visible); rider consent already held. Ship image + "Photo © Rob Goldings" credit normally. Only the raw 1.4 MB `54474.jpg` stays git-ignored; commit the optimised `app/splash.webp`.
- Match surrounding style: small focused edits, terse *why* comments; reuse existing shell CSS patterns.
- Design reference: `docs/superpowers/specs/2026-08-14-cold-open-splash-design.md`.

---

### Task 1: Splash asset + instant-paint markup/CSS in `index.html`

The visible splash: WebP asset, markup inside `#view`, dusk backdrop + band + dots, and the one-line `app.js` guard so the splash isn't immediately overwritten by the "Loading sessions…" text.

**Files:**
- Create: `app/splash.webp` (generated, committed)
- Modify: `app/index.html` (markup inside `<main id="view">`; `<style>` additions; `main{position:relative}`)
- Modify: `app/js/app.js:201-202` (guard the loading-text write)

**Interfaces:**
- Produces: a `#splash` element present as the initial `#view` content on cold boot; consumed by Task 2's `splash.js`.

- [ ] **Step 1: Generate the optimised WebP asset**

Run from the repo root (the raw source `54474.jpg` is present, git-ignored):

```sh
cwebp -q 82 -resize 1290 0 54474.jpg -o app/splash.webp
```

Expected: `app/splash.webp` ~36 KB, 1290×850. Verify: `sips -g pixelWidth -g pixelHeight app/splash.webp` (or `identify`) → 1290×850.

- [ ] **Step 2: Add the splash markup inside `<main id="view">`**

In `app/index.html`, replace the empty `<main id="view"></main>` (line 111) with:

```html
  <main id="view">
    <div id="splash" aria-hidden="true">
      <img class="splash-band" src="splash.webp" alt="" width="1290" height="850">
      <div class="splash-dots"><i></i><i></i><i></i></div>
    </div>
  </main>
```

- [ ] **Step 3: Add the splash CSS to the shell `<style>`**

Append inside the existing `<style>` block in `app/index.html`'s `<head>` (before `</style>` at line 91). Also add `position:relative` to the existing `main` rule (line 76) so the absolutely-positioned splash fills the content area (it establishes a containing block; no current view depends on a different one):

```css
    /* Cold-open splash: photo band on a dusk backdrop, filling the content area below the
       header. Lives in #view so the header/nav stay in place; splash.js fades it on load. */
    #splash { position:absolute; inset:0; overflow:hidden; z-index:1;
      background:linear-gradient(180deg,#45525f 0%,#5f5f5c 34%,#8a5f3c 64%,#b06f36 82%,#1a120b 100%);
      transition:opacity .3s ease; }
    #splash.leaving { opacity:0; }
    .splash-band { position:absolute; left:0; width:100%; height:auto; top:50%; transform:translateY(-54%);
      -webkit-mask-image:linear-gradient(180deg,transparent 0,#000 14%,#000 86%,transparent 100%);
      mask-image:linear-gradient(180deg,transparent 0,#000 14%,#000 86%,transparent 100%); }
    .splash-dots { position:absolute; left:0; right:0; bottom:40px; display:flex; gap:9px; justify-content:center; }
    .splash-dots i { width:9px; height:9px; border-radius:50%; background:rgba(255,255,255,.9);
      animation:splash-pulse 1.2s ease-in-out infinite; }
    .splash-dots i:nth-child(2){ animation-delay:.18s } .splash-dots i:nth-child(3){ animation-delay:.36s }
    @keyframes splash-pulse { 0%,100%{ opacity:.25; transform:translateY(0) } 50%{ opacity:1; transform:translateY(-3px) } }
    @media (prefers-reduced-motion:reduce){ .splash-dots i{ animation:none; opacity:.7 } }
```

And change the `main` rule (line 76) to add `position:relative;` — e.g. `main { flex:1; min-height:0; position:relative; overflow-y:auto; ... }`.

- [ ] **Step 4: Guard the loading-text write in `app.js` so it doesn't wipe the splash**

In `app/js/app.js`, `reload(target, showLoading)` (line 201), change the loading line so it only writes when there's no splash present:

```js
async function reload(target, showLoading) {
  if (showLoading && !document.getElementById("splash")) view.innerHTML = `<p class="muted">Loading sessions…</p>`;
```

(When the splash is present it covers the area; on the token path the splash stays until `go(...)` renders the list into `#view`, which replaces it. Fade + robustness come in Task 2.)

- [ ] **Step 5: Verify the suite still passes, then manually check**

Run: `node --test app/test/*.test.js` → all pass (no logic touched that tests cover).

Manual (serve locally): `cd app && python3 -m http.server 8000`, open it logged in — confirm the header shows with the dusk band + pulsing dots, replaced by the availability list when data loads. Logged out → login, no splash lingering.

- [ ] **Step 6: Commit**

```bash
git add app/splash.webp app/index.html app/js/app.js
git commit -m "feat: cold-open splash — photo band under header (instant paint)"
```

---

### Task 2: `splash.js` lifecycle — min-display, fade, safety timeout

Polish + robustness: keep the splash visible a minimum time (no flash on fast loads), fade it out, and force-remove after a safety timeout / on error / on the logged-out path.

**Files:**
- Create: `app/js/splash.js`
- Create: `app/test/splash.test.js`
- Modify: `app/js/app.js` (import + wire into boot, `reload`, and the logged-out branch)

**Interfaces:**
- Consumes: the `#splash` element from Task 1.
- Produces: `splashEl()`, `armSplash(now?)`, `leaveSplash()` (async), `removeSplash()`, and the pure `remainingHold(bootTime, now, minMs?)` → ms still to hold (≥0).

- [ ] **Step 1: Write the failing test (pure timing helper)**

Create `app/test/splash.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { remainingHold } from "../js/splash.js";

test("remainingHold returns time left in the minimum-visible window, clamped at 0", () => {
  assert.equal(remainingHold(1000, 1000, 600), 600);   // just booted → full hold
  assert.equal(remainingHold(1000, 1400, 600), 200);   // 400ms elapsed → 200 left
  assert.equal(remainingHold(1000, 1600, 600), 0);     // exactly met
  assert.equal(remainingHold(1000, 5000, 600), 0);     // long past → no wait (never negative)
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test app/test/splash.test.js`
Expected: FAIL — `Cannot find module ../js/splash.js` / `remainingHold is not defined`.

- [ ] **Step 3: Implement `splash.js`**

Create `app/js/splash.js`:

```js
// Cold-open splash lifecycle. The splash markup is the initial #view content (index.html),
// so it paints on the first frame under the header. This fades it out once availability is
// ready — held for a minimum time so a fast load doesn't flash it, and force-removed after a
// safety timeout so a slow/failed load never traps the user behind it.

const MIN_VISIBLE_MS = 600; // don't flash the splash for a single frame on a fast/cached load
const FADE_MS = 300;        // matches the #splash opacity transition in index.html
const SAFETY_MS = 8000;     // hard cap: never leave the user stuck behind the splash

let bootAt = null;
let safetyTimer = null;

export function splashEl() { return document.getElementById("splash"); }

// ms still to wait before we're allowed to start fading (never negative). Pure/testable.
export function remainingHold(bootTime, now, minMs = MIN_VISIBLE_MS) {
  return Math.max(0, minMs - (now - bootTime));
}

// Record the start time and arm the safety removal. Call once at boot, only on the load path.
export function armSplash(now = Date.now()) {
  if (!splashEl()) return;
  bootAt = now;
  safetyTimer = setTimeout(removeSplash, SAFETY_MS);
}

// Fade out (after the minimum-visible time) and resolve when gone. Idempotent.
export async function leaveSplash() {
  const el = splashEl();
  if (!el) return;
  const wait = remainingHold(bootAt ?? Date.now(), Date.now());
  if (wait) await sleep(wait);
  el.classList.add("leaving");
  await sleep(FADE_MS);
  removeSplash();
}

// Remove immediately (error path, logged-out, safety timeout). Idempotent.
export function removeSplash() {
  if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null; }
  const el = splashEl();
  if (el) el.remove();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test app/test/splash.test.js`
Expected: PASS.

- [ ] **Step 5: Wire `splash.js` into `app.js`**

In `app/js/app.js`:

Add the import near the other view imports:

```js
import { splashEl, armSplash, leaveSplash, removeSplash } from "./splash.js";
```

In `reload(target, showLoading)` — capture the splash, fade it after load, remove on error:

```js
async function reload(target, showLoading) {
  const splash = splashEl();
  if (showLoading && !splash) view.innerHTML = `<p class="muted">Loading sessions…</p>`;
  try {
    await loadState();
    if (splash) await leaveSplash();
    go(target ?? getDefaultLanding());
  } catch (e) {
    if (splash) removeSplash();
    if (e.code === 401) return;
    if (showLoading) view.innerHTML = `<p class="err">Couldn't load: ${e.message}</p>`;
  }
}
```

(Step 4 of Task 1 added the `!document.getElementById("splash")` guard inline; replacing it with the captured `splash` const above is equivalent and tidier — keep the guard behaviour.)

At the bottom **boot** block (line 246), arm the splash on the load path and clear it on the logged-out path:

```js
if (getToken()) { armSplash(); loadAndRender(); } else { removeSplash(); go("login"); }
```

- [ ] **Step 6: Verify + manual check**

Run: `node --test app/test/*.test.js` → all pass.
Manual: cold open (logged in) shows the splash for ≥~600ms then fades to the list; a cached/fast load doesn't flicker; simulate a slow/failed load (e.g. offline with no cache) and confirm the splash clears within ~8s and the error/list shows beneath; logged-out boot → login immediately, no splash.

- [ ] **Step 7: Commit**

```bash
git add app/js/splash.js app/test/splash.test.js app/js/app.js
git commit -m "feat: splash fade with min-display + safety timeout"
```

---

### Task 3: About-page photo credit

**Files:**
- Modify: `app/js/views/settings.js` (About tab, after the Support block, before `${shareSectionHtml()}` — around lines 156-160)

- [ ] **Step 1: Add a Credits section**

In `app/js/views/settings.js`, in the About tab template, insert immediately **before** `${shareSectionHtml()}` (line 160):

```js
    <div class="t" style="margin-top:16px">Credits</div>
    <p class="muted" style="font-size:12px;line-height:1.5;margin:0">📷 Splash photo © Rob Goldings.</p>

```

- [ ] **Step 2: Verify**

Run: `node --test app/test/*.test.js` → all pass.
Manual: Settings → About shows a "Credits" line "📷 Splash photo © Rob Goldings." above the Share section.

- [ ] **Step 3: Commit**

```bash
git add app/js/views/settings.js
git commit -m "feat: credit Rob Goldings for the splash photo on the About page"
```

---

### Task 4: Version bump v96 → v97 + service-worker assets

**Files:**
- Modify: `app/sw.js` (line 1 `CACHE`; `ASSETS` list lines 2-6)
- Modify: `app/js/config.js:63` (`APP_RELEASE`)

- [ ] **Step 1: Bump the cache name and add the new assets**

In `app/sw.js`:
- Line 1 → `const CACHE = "lagoon-v97";`
- Add `"./splash.webp"` to the `ASSETS` array (with the other root assets on line 2, alongside `./wifi-qr.svg` etc.).
- Add `"./js/splash.js"` to the `ASSETS` array (with the other `./js/*.js` entries on line 5).

- [ ] **Step 2: Bump the app release**

In `app/js/config.js`:

```js
export const APP_RELEASE = "v97"; // release/version — bump together with sw.js CACHE
```

- [ ] **Step 3: Verify they match and the suite is green**

Run:
```sh
grep -n "lagoon-v97" app/sw.js
grep -n 'splash.webp\|js/splash.js' app/sw.js
grep -n 'APP_RELEASE = "v97"' app/js/config.js
node --test app/test/*.test.js
```
Expected: `CACHE` is v97, both new assets present in `ASSETS`, `APP_RELEASE` v97, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/sw.js app/js/config.js
git commit -m "chore: bump app to v97 (cold-open splash) + cache splash assets"
```

- [ ] **Step 5: Remove build scratch**

The raw source and local preview are git-ignored; delete them from disk so they don't linger:

```sh
rm -f 54474.jpg && rm -rf .splash-preview
```

(No commit — these were never tracked.)

---

## Self-Review

**Spec coverage:**
- Band under the persistent header, dusk backdrop, feathered band, dots → Task 1 (markup + CSS). ✓
- Instant paint (markup/CSS in index.html), no `rel=preload` (base-href 404 trap) → Task 1 + Global Constraints. ✓
- Fade on load, min-display ~600ms, ~8s safety timeout, error/logged-out removal → Task 2. ✓
- Cold open only (boot path / initial `#view`; not on resume) → Task 1/2 (lives in boot + `#view`). ✓
- `prefers-reduced-motion` holds dots static → Task 1 CSS. ✓
- Optimised WebP asset, offline-cached → Task 1 (generate) + Task 4 (`ASSETS`). ✓
- "Photo © Rob Goldings" credit on About → Task 3. ✓
- No flag; version bump v96→v97 → Task 4. ✓
- Raw source stays out of git; scratch removed → Global Constraints + Task 4 Step 5. ✓

**Placeholder scan:** none — every code/CSS/command step is concrete.

**Type consistency:** `splash.js` exports (`splashEl`, `armSplash`, `leaveSplash`, `removeSplash`, `remainingHold`) match their uses in `app.js` (Task 2 Step 5) and the test (Step 1). The `#splash` element id and `.leaving` class are consistent across index.html (Task 1) and splash.js (Task 2). Asset path `splash.webp` matches the `<img src>` (Task 1) and the `ASSETS` entry (Task 4). `FADE_MS` (300) matches the `#splash` CSS `transition:opacity .3s`.
