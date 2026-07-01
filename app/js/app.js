import { getToken, clearToken, saveCache, loadCache, getDefaultLanding, getLastMinuteWindow } from "./store.js";
import { loadEverything } from "./data.js";
import { renderLogin } from "./views/login.js";
import { renderAgenda } from "./views/agenda.js";
import { renderDay } from "./views/day.js";
import { renderAccount } from "./views/account.js";
import { renderSettings } from "./views/settings.js";
import { renderLastMinute } from "./views/lastminute.js";
import { isOn } from "./features.js";
import { justOpenedKeys, sessionsInWindow } from "./model.js";
import { apply as applyTheme } from "./theme.js";
import { initPullToRefresh } from "./pullToRefresh.js";
import { maybeShowIntro } from "./intro.js";

const view = document.getElementById("view");
const nav = document.getElementById("nav");
let state = null; // { me, meBookings, memberships, packages, agenda, stale }
let currentRoute = "login";
let lmRefreshing = false; // a background Last-minute refresh is in flight
let lmAutoTimer = null;   // periodic refresh while the Last-minute tab is open
let pendingBookingReturn = false; // user tapped "Book ↗"; refresh when they come back
const LM_REFRESH_AFTER_MS = 300000; // only re-fetch if data is older than this (5 min) — spare the Lagoon API

function setActiveNav(route) {
  nav.hidden = false;
  for (const b of nav.querySelectorAll("button")) b.classList.toggle("active", b.dataset.route === route);
}

// After each load, reveal the Last-minute tab only for gated users and set its icon.
function afterLoad() {
  const btn = nav.querySelector('button[data-route="lastminute"]');
  if (!btn) return;
  const gated = isOn("lastMinute", state);
  btn.hidden = !gated;
  if (gated) setLastMinuteIcon();
}

// 🔥 when something's free in the user's SELECTED Last-minute window, 🌊 when not.
// Tied to the chosen window (default Today, not a fixed 48h) so the icon actually
// goes calm when there's nothing to grab — a busy lagoon nearly always has *some*
// 48h availability, which left it permanently lit. The view re-calls this when the
// window changes. Type-filter-independent: any session type counts as "available".
export function setLastMinuteIcon() {
  const em = nav.querySelector('button[data-route="lastminute"] .nav-emoji');
  if (!em || !state) return;
  em.textContent = sessionsInWindow(state.agenda, getLastMinuteWindow(), new Date()).length > 0 ? "🔥" : "🌊";
}

// True while a background Last-minute refresh is in flight (drives the "Refreshing…"
// label in the view). Exported so the view can read it.
export const isRefreshing = () => lmRefreshing;

// Background refresh fired when the user opens the Last-minute tab: show "Refreshing…",
// fetch fresh data, then fall back to the normal display (updated "Last refreshed", or
// the stale banner on failure). Doesn't navigate — only re-renders if still on the tab,
// so a slow fetch can't yank the user back after they've moved on.
async function refreshLastMinute() {
  if (lmRefreshing || !state || !isOn("lastMinute", state)) return;
  if (state.refreshedAt && Date.now() - state.refreshedAt < LM_REFRESH_AFTER_MS) return; // fresh enough — don't re-fetch
  lmRefreshing = true;
  renderLastMinute(view, state, go);              // swap "Last refreshed" -> "Refreshing…"
  try { await loadState(); } catch { /* logout / no-cache handled in loadState; keep data */ }
  finally {
    lmRefreshing = false;
    if (currentRoute === "lastminute") renderLastMinute(view, state, go);
  }
}

// While the Last-minute tab stays open, poll once a minute and background-refresh as
// soon as the data passes the freshness threshold — so just sitting on the tab keeps
// availability current (~every 5 min). refreshLastMinute() is throttled, so this won't
// over-fetch. Self-stops once the user leaves the tab.
function armLastMinuteAutoRefresh() {
  if (lmAutoTimer) return;                        // already polling
  lmAutoTimer = setInterval(() => {
    if (currentRoute !== "lastminute") { clearInterval(lmAutoTimer); lmAutoTimer = null; return; }
    refreshLastMinute();
  }, 60000);
}

// After the user returns from the Lagoon booking site, background-refresh so a just-made
// booking shows without a manual pull. Re-fetches data, then re-renders the current data
// view in place (leaves day/settings navigation alone).
async function refreshAfterBooking() {
  if (!state) return;
  try { await loadState(); } catch { return; } // logout / no-cache handled in loadState
  if (["agenda", "account", "lastminute"].includes(currentRoute)) go(currentRoute);
}

export function go(route, arg) {
  currentRoute = route;
  if (route === "login") { nav.hidden = true; renderLogin(view, onLoggedIn); return; }
  if (route === "settings") { renderSettings(view, state, go); return; } // works pre/post login
  if (!state) return;
  if (route === "lastminute") {
    if (!isOn("lastMinute", state)) { go("agenda"); return; } // safe degrade for non-gated
    setActiveNav("lastminute"); renderLastMinute(view, state, go); armLastMinuteAutoRefresh();
  }
  else if (route === "agenda") { setActiveNav("agenda"); renderAgenda(view, state, go); }
  else if (route === "day") { setActiveNav("agenda"); renderDay(view, state, arg, go); }
  else if (route === "account") { setActiveNav("account"); renderAccount(view, state, go); }
}

nav.addEventListener("click", (e) => {
  const b = e.target.closest("button"); const r = b && b.dataset.route;
  if (!r) return;
  go(r);
  if (r === "lastminute" && currentRoute === "lastminute") refreshLastMinute(); // fresh data on entry
});
document.getElementById("btn-settings").addEventListener("click", () => go("settings"));

// Tapping a "Book ↗" link opens the Lagoon booking site in a new tab. Flag it, and when
// the app returns to the foreground refresh once so a new booking shows on Bookings
// without a manual pull. Gated on the flag (not every tab-switch) to spare the API.
document.addEventListener("click", (e) => { if (e.target.closest("a.bk")) pendingBookingReturn = true; });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !pendingBookingReturn) return;
  pendingBookingReturn = false;
  refreshAfterBooking();
});

async function onLoggedIn() { await loadAndRender(); }

export function logout() { clearToken(); state = null; go("login"); }

// Fetch fresh data into `state`. Returns true on a live load, false if it fell back
// to the cache (stale). Throws on a hard failure (no cache, or 401 after logout).
// Navigation is the caller's job — so a background refresh can update data without
// yanking the user back to a tab they've since left.
async function loadState() {
  const token = getToken();
  const prev = loadCache();                         // previous snapshot, BEFORE we overwrite it
  try {
    const data = await loadEverything(token);
    // Slots that newly freed since our last successful load — drives "just opened ↑".
    // Derived, ephemeral: not persisted to the cache.
    const justOpened = justOpenedKeys(prev && prev.data && prev.data.agenda, data.agenda);
    state = { ...data, stale: false, refreshedAt: Date.now(), justOpened };
    saveCache(data);
    afterLoad();
    return true;
  } catch (e) {
    if (e.code === 401) { logout(); throw e; }
    const cached = loadCache();
    if (!cached) throw e;
    state = { ...cached.data, stale: true, refreshedAt: cached.at, justOpened: new Set() };
    afterLoad();
    return false;
  }
}

// Reload data from the API and render `target`. `showLoading` shows the full-page
// spinner (initial load); pull-to-refresh skips it since it has its own indicator.
async function reload(target, showLoading) {
  if (showLoading) view.innerHTML = `<p class="muted">Loading sessions…</p>`;
  try {
    await loadState();                              // success or cache-fallback both set state
    go(target ?? getDefaultLanding(state));         // null target -> configurable default page
  } catch (e) {
    if (e.code === 401) return;                     // logout() already navigated to login
    if (showLoading) view.innerHTML = `<p class="err">Couldn't load: ${e.message}</p>`;
    // on a pull-to-refresh failure with no cache + existing state, keep what's on screen
  }
}

async function loadAndRender() {
  await reload(null, true); // null -> getDefaultLanding (Last-minute for gated, else Availability)
  if (state) maybeShowIntro();
}

// Pull-to-refresh re-fetches and re-renders the current data view in place.
async function refresh() {
  const target = ["agenda", "account", "lastminute"].includes(currentRoute) ? currentRoute : "agenda";
  await reload(target, false);
}

// boot
applyTheme();
initPullToRefresh({ onRefresh: refresh, canPull: () => !!state && currentRoute !== "login" });
if (getToken()) loadAndRender(); else go("login");
