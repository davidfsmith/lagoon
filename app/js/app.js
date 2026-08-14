import { getToken, clearToken, saveCache, loadCache, getDefaultLanding, getLastMinuteWindow, getDiscipline, setDiscipline } from "./store.js";
import { loadEverything } from "./data.js";
import { renderLogin } from "./views/login.js";
import { renderAgenda } from "./views/agenda.js";
import { renderDay } from "./views/day.js";
import { renderAccount } from "./views/account.js";
import { renderSettings } from "./views/settings.js";
import { renderLastMinute } from "./views/lastminute.js";
import { justOpenedKeys, sessionsInWindow } from "./model.js";
import { isOn, bootMode } from "./features.js";
import { apply as applyTheme } from "./theme.js";
import { initPullToRefresh } from "./pullToRefresh.js";
import { maybeShowIntro } from "./intro.js";
import { parseDayHash } from "./deeplink.js";
import * as rum from "./rum.js";
import { splashEl, armSplash, leaveSplash, removeSplash } from "./splash.js";

const view = document.getElementById("view");
const nav = document.getElementById("nav");
const discToggle = document.getElementById("disc-toggle");
let state = null; // { me, meBookings, memberships, packages, agenda, stale }
let currentRoute = "login";
let lmRefreshing = false; // a background Last-minute refresh is in flight
let lmAutoTimer = null;   // periodic refresh while the Last-minute tab is open
let pendingBookingReturn = false; // user tapped "Book ↗"; refresh when they come back
let pendingDay = null; // deep-link target from a notification, applied once state loads
let postLoginRoute = null; // where to land after a successful sign-in (e.g. "account")
const LM_REFRESH_AFTER_MS = 300000; // only re-fetch if data is older than this (5 min) — spare the Lagoon API

function openDay(target) {
  if (!target) return;
  if (state) go("day", target); else pendingDay = target;
}

function setActiveNav(route) {
  nav.hidden = false;
  for (const b of nav.querySelectorAll("button")) b.classList.toggle("active", b.dataset.route === route);
}

// After each load, reveal the Last-minute tab only for gated users and set its icon.
function afterLoad() {
  updateDisciplineToggle();
  const btn = nav.querySelector('button[data-route="lastminute"]');
  if (!btn) return;
  // Last-minute is a wake-only spot-watching feature (like notifications) — hide it in SUP mode.
  btn.hidden = getDiscipline() === "sup";
  if (!btn.hidden) setLastMinuteIcon();
}

// Header discipline switch: shown to all logged-in users; segments reflect the current
// discipline. Wired once at boot (buttons persist across renders).
function updateDisciplineToggle() {
  if (!discToggle) return;
  const show = !!state;
  discToggle.hidden = !show;
  if (!show) return;
  const d = getDiscipline();
  for (const b of discToggle.querySelectorAll(".disc-seg")) b.classList.toggle("active", b.dataset.disc === d);
}

// 🔥 when something's free in the user's SELECTED Last-minute window, 🌊 when not.
// Tied to the chosen window (default Today, not a fixed 48h) so the icon actually
// goes calm when there's nothing to grab — a busy lagoon nearly always has *some*
// 48h availability, which left it permanently lit. The view re-calls this when the
// window changes. Type-filter-independent: any session type counts as "available".
export function setLastMinuteIcon() {
  const em = nav.querySelector('button[data-route="lastminute"] .nav-emoji');
  if (!em || !state) return;
  em.textContent = sessionsInWindow(state.agenda, getLastMinuteWindow(), new Date()).filter(s => s.free > 0).length > 0 ? "🔥" : "🌊";
}

// True while a background Last-minute refresh is in flight (drives the "Refreshing…"
// label in the view). Exported so the view can read it.
export const isRefreshing = () => lmRefreshing;

// Background refresh fired when the user opens the Last-minute tab: show "Refreshing…",
// fetch fresh data, then fall back to the normal display (updated "Last refreshed", or
// the stale banner on failure). Doesn't navigate — only re-renders if still on the tab,
// so a slow fetch can't yank the user back after they've moved on.
async function refreshLastMinute() {
  if (lmRefreshing || !state) return;
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
  if (route === "lastminute" && getDiscipline() === "sup") route = "agenda"; // Last-minute is wake-only
  currentRoute = route;
  rum.route(route);
  if (route === "login") { nav.hidden = true; if (discToggle) discToggle.hidden = true; renderLogin(view, onLoggedIn, go); return; }
  if (route === "settings") { renderSettings(view, state, go); return; } // works pre/post login
  if (!state) return;
  if (route === "lastminute") {
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
if (discToggle) for (const b of discToggle.querySelectorAll(".disc-seg"))
  b.addEventListener("click", () => switchDiscipline(b.dataset.disc));

// Tapping a "Book ↗" link opens the Lagoon booking site in a new tab. Flag it, and when
// the app returns to the foreground refresh once so a new booking shows on Bookings
// without a manual pull. Gated on the flag (not every tab-switch) to spare the API.
document.addEventListener("click", (e) => { if (e.target.closest("a.bk")) { pendingBookingReturn = true; rum.event("book_click"); } });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  consumeDeeplink(); // a notification tap resumed the app → jump to the freed slot's day
  if (pendingBookingReturn) { pendingBookingReturn = false; refreshAfterBooking(); }
});
// iOS can bring a backgrounded PWA forward without a visibilitychange event, so also check
// the deep-link cache on window focus / pageshow. All idempotent (the entry is deleted on read).
window.addEventListener("focus", consumeDeeplink);
window.addEventListener("pageshow", consumeDeeplink);
// If the SW's openWindow navigated us to a #day/… hash, route on that too, then strip it.
window.addEventListener("hashchange", () => {
  const t = parseDayHash(location.hash);
  if (t) { history.replaceState(null, "", location.pathname + location.search); openDay(t); }
});

// Durable notification deep-link: the SW stashes the freed slot in a Cache entry (which
// survives an iOS PWA being suspended/resumed, unlike a postMessage or client.navigate).
// Read + clear it when the app becomes visible after a tap. Cold-opens route via the boot
// #day/… hash instead (the app isn't alive to receive a visibility event).
async function consumeDeeplink() {
  try {
    const cache = await caches.open("lagoon-deeplink");
    const res = await cache.match("target");
    if (!res) return;
    await cache.delete("target");
    const t = await res.json();
    if (t && t.date && t.key) openDay({ date: t.date, key: t.key });
  } catch { /* cache unavailable — ignore */ }
}

async function onLoggedIn() {
  const target = postLoginRoute; postLoginRoute = null;
  await loadAndRender(target); // target null → default landing
  rum.event("login_success");
}

// Begin sign-in, remembering where to return afterwards (null → default landing).
export function signIn(returnRoute = null) { postLoginRoute = returnRoute; go("login"); }

export function logout() {
  clearToken();
  state = null;
  if (isOn("guestMode")) { loadAndRender(); return; } // drop to public browsing, not a wall
  go("login");
}

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
  const splash = splashEl();
  if (showLoading && !splash) view.innerHTML = `<p class="muted">Loading sessions…</p>`;
  try {
    await loadState();                              // success or cache-fallback both set state
    if (splash) await leaveSplash();                // held for min-visible time, then faded
    go(target ?? getDefaultLanding());              // null target -> configurable default page
  } catch (e) {
    if (splash) removeSplash();                     // never trap the user behind the splash
    if (e.code === 401) return;                     // logout() already navigated to login
    if (showLoading) view.innerHTML = `<p class="err">Couldn't load: ${e.message}</p>`;
    // on a pull-to-refresh failure with no cache + existing state, keep what's on screen
  }
}

// Switch riding discipline (wake ⇄ SUP) and reload the CURRENT screen with the new
// discipline's data — so it works from any tab (header toggle) or from Settings (Default
// activity). Exported + dev-gated. Landing on Availability if on the now-hidden Last-minute;
// Settings reloads quietly so its dropdown stays put.
export async function switchDiscipline(disc) {
  if (disc === getDiscipline()) return;
  setDiscipline(disc);
  rum.event("discipline_switch", { to: disc });
  updateDisciplineToggle();
  let t = currentRoute === "day" ? "agenda" : currentRoute;
  if (t === "lastminute" && disc === "sup") t = "agenda";
  if (!["agenda", "account", "lastminute", "settings"].includes(t)) t = "agenda";
  await reload(t, t !== "settings");
}

async function loadAndRender(target = null) {
  await reload(target, true);
  if (state && pendingDay) { go("day", pendingDay); pendingDay = null; return; } // deep-link wins over intro
  if (state) maybeShowIntro();
}

// Pull-to-refresh re-fetches and re-renders the current data view in place.
async function refresh() {
  const target = ["agenda", "account", "lastminute"].includes(currentRoute) ? currentRoute : "agenda";
  await reload(target, false);
}

// boot
applyTheme();
rum.init();
initPullToRefresh({ onRefresh: refresh, canPull: () => !!state && currentRoute !== "login" });
const bootDay = parseDayHash(location.hash);
if (bootDay) { pendingDay = bootDay; history.replaceState(null, "", location.pathname + location.search); }
const mode = bootMode(!!getToken(), isOn("guestMode"));
if (mode === "login") { removeSplash(); go("login"); }
else { armSplash(Date.now(), () => { view.innerHTML = `<p class="muted">Loading sessions…</p>`; }); loadAndRender(); }
