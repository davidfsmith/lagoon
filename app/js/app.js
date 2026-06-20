import { getToken, clearToken, saveCache, loadCache } from "./store.js";
import { loadEverything } from "./data.js";
import { renderLogin } from "./views/login.js";
import { renderAgenda } from "./views/agenda.js";
import { renderDay } from "./views/day.js";
import { renderAccount } from "./views/account.js";
import { renderSettings } from "./views/settings.js";
import { apply as applyTheme } from "./theme.js";
import { initPullToRefresh } from "./pullToRefresh.js";

const view = document.getElementById("view");
const nav = document.getElementById("nav");
let state = null; // { me, meBookings, memberships, packages, agenda, stale }
let currentRoute = "login";

function setActiveNav(route) {
  nav.hidden = false;
  for (const b of nav.querySelectorAll("button")) b.classList.toggle("active", b.dataset.route === route);
}

export function go(route, arg) {
  currentRoute = route;
  if (route === "login") { nav.hidden = true; renderLogin(view, onLoggedIn); return; }
  if (route === "settings") { renderSettings(view, state, go); return; } // works pre/post login
  if (!state) return;
  if (route === "agenda") { setActiveNav("agenda"); renderAgenda(view, state, go); }
  else if (route === "day") { setActiveNav("agenda"); renderDay(view, state, arg, go); }
  else if (route === "account") { setActiveNav("account"); renderAccount(view, state, go); }
}

nav.addEventListener("click", (e) => { const r = e.target.dataset.route; if (r) go(r); });
document.getElementById("btn-settings").addEventListener("click", () => go("settings"));

async function onLoggedIn() { await loadAndRender(); }

export function logout() { clearToken(); state = null; go("login"); }

// Reload data from the API and render `target`. `showLoading` shows the full-page
// spinner (initial load); pull-to-refresh skips it since it has its own indicator.
async function reload(target, showLoading) {
  if (showLoading) view.innerHTML = `<p class="muted">Loading sessions…</p>`;
  const token = getToken();
  try {
    const data = await loadEverything(token);
    state = { ...data, stale: false };
    saveCache(data);
    go(target);
  } catch (e) {
    if (e.code === 401) { logout(); return; }
    const cached = loadCache();
    if (cached) { state = { ...cached.data, stale: true }; go(target); }
    else if (showLoading) view.innerHTML = `<p class="err">Couldn't load: ${e.message}</p>`;
    // on a pull-to-refresh failure with existing state, keep what's on screen
  }
}

async function loadAndRender() { await reload("agenda", true); }

// Pull-to-refresh re-fetches and re-renders the current data view in place.
async function refresh() {
  const target = (currentRoute === "agenda" || currentRoute === "account") ? currentRoute : "agenda";
  await reload(target, false);
}

// boot
applyTheme();
initPullToRefresh({ onRefresh: refresh, canPull: () => !!state && currentRoute !== "login" });
if (getToken()) loadAndRender(); else go("login");
