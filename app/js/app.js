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

export function go(route, arg) {
  currentRoute = route;
  if (route === "login") { nav.hidden = true; renderLogin(view, onLoggedIn); return; }
  if (route === "settings") { renderSettings(view, state, go); return; } // works pre/post login
  if (!state) return;
  if (route === "lastminute") {
    if (!isOn("lastMinute", state)) { go("agenda"); return; } // safe degrade for non-gated
    setActiveNav("lastminute"); renderLastMinute(view, state, go);
  }
  else if (route === "agenda") { setActiveNav("agenda"); renderAgenda(view, state, go); }
  else if (route === "day") { setActiveNav("agenda"); renderDay(view, state, arg, go); }
  else if (route === "account") { setActiveNav("account"); renderAccount(view, state, go); }
}

nav.addEventListener("click", (e) => { const b = e.target.closest("button"); const r = b && b.dataset.route; if (r) go(r); });
document.getElementById("btn-settings").addEventListener("click", () => go("settings"));

async function onLoggedIn() { await loadAndRender(); }

export function logout() { clearToken(); state = null; go("login"); }

// Reload data from the API and render `target`. `showLoading` shows the full-page
// spinner (initial load); pull-to-refresh skips it since it has its own indicator.
async function reload(target, showLoading) {
  if (showLoading) view.innerHTML = `<p class="muted">Loading sessions…</p>`;
  const token = getToken();
  try {
    const prev = loadCache();                       // previous snapshot, BEFORE we overwrite it
    const data = await loadEverything(token);
    // Slots that newly freed since our last successful load — drives "just opened ↑".
    // Derived, ephemeral: not persisted to the cache.
    const justOpened = justOpenedKeys(prev && prev.data && prev.data.agenda, data.agenda);
    state = { ...data, stale: false, refreshedAt: Date.now(), justOpened };
    saveCache(data);
    afterLoad();
    go(target ?? getDefaultLanding(state));         // null target -> configurable default page
  } catch (e) {
    if (e.code === 401) { logout(); return; }
    const cached = loadCache();
    if (cached) {
      state = { ...cached.data, stale: true, refreshedAt: cached.at, justOpened: new Set() };
      afterLoad();
      go(target ?? getDefaultLanding(state));
    }
    else if (showLoading) view.innerHTML = `<p class="err">Couldn't load: ${e.message}</p>`;
    // on a pull-to-refresh failure with existing state, keep what's on screen
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
