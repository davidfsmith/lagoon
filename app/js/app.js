import { getToken, clearToken, saveCache, loadCache } from "./store.js";
import { loadEverything } from "./data.js";
import { renderLogin } from "./views/login.js";
import { renderAgenda } from "./views/agenda.js";
import { renderDay } from "./views/day.js";
import { renderAccount } from "./views/account.js";
import { renderSettings } from "./views/settings.js";
import { apply as applyTheme } from "./theme.js";

const view = document.getElementById("view");
const nav = document.getElementById("nav");
let state = null; // { me, meBookings, memberships, packages, agenda, stale }

function setActiveNav(route) {
  nav.hidden = false;
  for (const b of nav.querySelectorAll("button")) b.classList.toggle("active", b.dataset.route === route);
}

export function go(route, arg) {
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

async function loadAndRender() {
  view.innerHTML = `<p class="muted">Loading…</p>`;
  const token = getToken();
  try {
    const data = await loadEverything(token);
    state = { ...data, stale: false };
    saveCache(data);
    go("agenda");
  } catch (e) {
    if (e.code === 401) { logout(); return; }
    const cached = loadCache();
    if (cached) { state = { ...cached.data, stale: true }; go("agenda"); }
    else view.innerHTML = `<p class="err">Couldn't load: ${e.message}</p>`;
  }
}

// boot
applyTheme();
if (getToken()) loadAndRender(); else go("login");
