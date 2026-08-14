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
