import { getTheme, setTheme } from "../theme.js";
import { APP_VERSION, APP_RELEASE, COURSES } from "../config.js";
import { logout } from "../app.js";
import { agoText } from "./format.js";
import { startRefreshedTicker } from "../refreshedTicker.js";
import { showIntro } from "../intro.js";
import { getReminderMinutes, setReminderMinutes, REMINDER_OPTIONS, TRAVEL_OPTIONS, getDefaultLanding, setDefaultLanding, LANDING_OPTIONS, getBetaOptIn, setBetaOptIn, getInternalOptIn, setInternalOptIn, getNotifyPrefs, setNotifyPrefs } from "../store.js";
import { accessTier } from "../features.js";
import { tabBarHtml, injectTabStyles } from "../tabs.js";
import { notifState, subscribe, unsubscribe, syncPrefs } from "../push.js";

// Two tabs: Settings (appearance, reminder, data, log out) and About (what it is,
// version, help, support). The active tab persists for the session.
let activeTab = "settings";
let devTaps = 0; // version-row taps this session; 7 reveals the Developer section
let notifOn = false; // last-read push subscription state, refreshed on render

// Badge for the current access level (DEV outranks BETA).
function badgeHtml() {
  const t = accessTier();
  if (t === "internal") return ' <span class="dev-badge">DEV</span>';
  if (t === "beta") return ' <span class="beta-badge">BETA</span>';
  return "";
}
// A themed on/off toggle switch (checkbox styled via .switch CSS).
function switchHtml(id, on) {
  return `<label class="switch"><input type="checkbox" id="${id}"${on ? " checked" : ""}><span class="slider"></span></label>`;
}

// Notification prefs controls (days/types/travel), shown under the enable toggle.
const NP_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function notifPrefsHtml() {
  const p = getNotifyPrefs();
  const day = (d) => `<button class="npday${p.days.includes(d) ? " active" : ""}" data-day="${d}">${d}</button>`;
  const type = (c) => `<button class="nptype${p.types.includes(c.label) ? " active" : ""}" data-type="${c.label}">${c.label}</button>`;
  return `
    <div class="np-lbl">Days</div>
    <div class="np-row">${NP_DAYS.map(day).join("")}</div>
    <div class="np-lbl">Session types</div>
    <div class="np-row">${COURSES.map(type).join("")}</div>
    <div class="np-lbl">Travel time</div>
    <div class="set-row"><span>Minutes to the lagoon</span>
      <select id="np-travel" class="set-select">${TRAVEL_OPTIONS.map(m => `<option value="${m}"${m === p.travelMins ? " selected" : ""}>${m} min</option>`).join("")}</select></div>`;
}

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () => navigator.standalone === true
  || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window;

// The Notifications section body: install guidance on iOS-not-installed, else the toggle (+prefs).
function notifBodyHtml() {
  if (!pushSupported() && isIOS() && !isStandalone()) {
    return `<div class="set-cap ios-install">To get spot alerts, add this app to your Home Screen:
      <span class="ios-step">1. Tap the Share button <b>⬆︎</b></span>
      <span class="ios-step">2. Tap <b>Add to Home Screen</b></span>
      <span class="ios-step">Then open it from the Home Screen and turn alerts on here.</span></div>`;
  }
  return `<div class="set-row"><span>Spot-opened alerts</span>${switchHtml("notif-toggle", notifOn)}</div>
    <div class="set-cap">Get a push when a spot opens. You'll be asked for permission.</div>
    ${notifOn ? notifPrefsHtml() : ""}`;
}

// APP_VERSION is stamped at deploy as "build <sha> · <date>" (just "dev" locally).
function buildParts() {
  const m = APP_VERSION.match(/^build (\S+) · (.+)$/);
  return { build: m ? m[1] : APP_VERSION, date: m ? m[2] : "" };
}

export function renderSettings(view, state, go) {
  const theme = getTheme();
  const { build, date } = buildParts();
  const seg = (val, label) =>
    `<button class="seg${val === theme ? " active" : ""}" data-theme="${val}">${label}</button>`;

  const landing = getDefaultLanding();
  const landingOptions = LANDING_OPTIONS
    .map(o => `<option value="${o.id}"${o.id === landing ? " selected" : ""}>${o.label}</option>`).join("");

  const settingsTab = `
    <div class="t">Appearance</div>
    <div class="segbar">${seg("system", "System")}${seg("light", "Light")}${seg("dark", "Dark")}</div>

    <div class="t" style="margin-top:18px">Default page</div>
    <div class="set-row"><span>Open the app on</span>
      <select id="landing" class="set-select">${landingOptions}</select></div>

    <div class="t" style="margin-top:18px">Calendar</div>
    <div class="set-row"><span>Default reminder time</span>
      <select id="reminder" class="set-select">
        ${REMINDER_OPTIONS.map(m => `<option value="${m}"${m === getReminderMinutes() ? " selected" : ""}>${m} min</option>`).join("")}
      </select></div>

    <div class="t" style="margin-top:18px">Notifications</div>
    ${notifBodyHtml()}

    ${getInternalOptIn() ? `<div class="t" style="margin-top:18px">Developer</div>
    <div class="set-row"><span>Internal features</span>${switchHtml("internal-toggle", getInternalOptIn())}</div>
    <div class="set-cap">Unreleased, in-progress features. Expect breakage. Includes beta features.</div>` : ""}

    ${state ? `<div class="t" style="margin-top:18px">Data</div>
    <div class="set-row"><span>Last refreshed</span><span class="muted" id="set-refreshed">${agoText(state.refreshedAt)}${state.stale ? " (saved)" : ""}</span></div>

    <button class="primary" id="logout" style="margin-top:18px">Log out</button>` : ""}

    <div class="t" style="margin-top:24px">Beta</div>
    <div class="set-row"><span>Beta features</span>${switchHtml("beta-toggle", getBetaOptIn())}</div>
    <div class="set-cap">Try in-progress features early. They may be rough or change.</div>`;

  const aboutTab = `
    <div class="t">About</div>
    <div class="about-box">
      <p>Shows live wakeboarding availability at Hove Lagoon, read straight from the
         Lagoon booking system each time you open the app — the same data the
         official site uses.</p>
      <p>Your sign-in goes directly to Lagoon. Only an access token is stored on this
         device to keep you signed in — your username and password are never saved.</p>
    </div>

    <div class="t" style="margin-top:16px">Version</div>
    <div class="set-row" id="ver-row"><span>Hove Lagoon${badgeHtml()}</span><span class="about-ver">
      <span>build ${build}</span>
      <span>${APP_RELEASE}</span>
      ${date ? `<span>${date}</span>` : ""}
    </span></div>

    <div class="t" style="margin-top:16px">Help</div>
    <button class="set-row set-btn" id="replay-intro"><span>Replay intro</span><span class="muted">›</span></button>

    <div class="t" style="margin-top:16px">Support</div>
    <a class="set-row support" href="mailto:dave@dave-smith.co.uk?subject=Lagoon%20App%20Support">
      <span>Email support</span><span class="muted">dave@dave-smith.co.uk ›</span></a>`;

  view.innerHTML = `
    <button class="link" id="back">‹ Back</button>
    <h2>Settings</h2>
    ${tabBarHtml([{ id: "settings", label: "Settings" }, { id: "about", label: "About" }], activeTab)}
    ${activeTab === "settings" ? settingsTab : aboutTab}`;

  view.querySelector("#back").addEventListener("click", () => go(state ? "agenda" : "login"));
  for (const t of view.querySelectorAll(".tab")) {
    t.addEventListener("click", () => { activeTab = t.dataset.tab; renderSettings(view, state, go); });
  }
  for (const b of view.querySelectorAll(".seg")) {
    b.addEventListener("click", () => { setTheme(b.dataset.theme); renderSettings(view, state, go); });
  }
  const rem = view.querySelector("#reminder");
  if (rem) rem.addEventListener("change", () => setReminderMinutes(parseInt(rem.value, 10)));
  const ld = view.querySelector("#landing");
  if (ld) ld.addEventListener("change", () => setDefaultLanding(ld.value));
  const lo = view.querySelector("#logout");
  if (lo) lo.addEventListener("click", () => logout());
  const ri = view.querySelector("#replay-intro");
  if (ri) ri.addEventListener("click", () => showIntro());
  const bt = view.querySelector("#beta-toggle");
  if (bt) bt.addEventListener("change", () => { setBetaOptIn(bt.checked); renderSettings(view, state, go); });
  const it = view.querySelector("#internal-toggle");
  if (it) it.addEventListener("change", () => { setInternalOptIn(it.checked); renderSettings(view, state, go); });
  const nt = view.querySelector("#notif-toggle");
  if (nt) {
    notifState().then((s) => {
      const on = s === "subscribed";
      nt.checked = on;
      // If we're actually subscribed but the prefs UI isn't showing yet (state settled
      // after the toggle's own render), reveal it. Never hide here — that's the toggle-off.
      if (on && !notifOn) { notifOn = true; renderSettings(view, state, go); }
    });
    nt.addEventListener("change", async () => {
      nt.disabled = true;
      try {
        if (nt.checked) { await subscribe(); notifOn = true; }
        else { await unsubscribe(); notifOn = false; }
      } catch { notifOn = false; nt.checked = false; }
      finally { nt.disabled = false; renderSettings(view, state, go); }
    });
  }
  const persist = (mut) => { const p = getNotifyPrefs(); mut(p); setNotifyPrefs(p); syncPrefs(); renderSettings(view, state, go); };
  for (const b of view.querySelectorAll(".npday")) b.addEventListener("click", () =>
    persist(p => { const d = b.dataset.day; p.days = p.days.includes(d) ? p.days.filter(x => x !== d) : [...p.days, d]; }));
  for (const b of view.querySelectorAll(".nptype")) b.addEventListener("click", () =>
    persist(p => { const t = b.dataset.type; p.types = p.types.includes(t) ? p.types.filter(x => x !== t) : [...p.types, t]; }));
  const tv = view.querySelector("#np-travel");
  if (tv) tv.addEventListener("change", () => { const p = getNotifyPrefs(); p.travelMins = Math.max(0, parseInt(tv.value, 10) || 0); setNotifyPrefs(p); syncPrefs(); });
  const ver = view.querySelector("#ver-row");
  if (ver) ver.addEventListener("click", () => {
    if (getInternalOptIn()) return;            // already unlocked
    if (++devTaps >= 7) { devTaps = 0; setInternalOptIn(true); renderSettings(view, state, go); }
  });
  injectTabStyles();
  injectSettingsStyles();
  // Keep the Data → Last refreshed value live too (no "Last refreshed" prefix here —
  // that's the row label). Self-clears on the About tab / pre-login (element absent).
  if (state) startRefreshedTicker("set-refreshed", () => `${agoText(state.refreshedAt)}${state.stale ? " (saved)" : ""}`);
}

function injectSettingsStyles() {
  if (document.getElementById("settings-css")) return;
  const s = document.createElement("style"); s.id = "settings-css";
  s.textContent = `
    .link{position:sticky;top:50px;z-index:5;display:inline-flex;align-items:center;
      background:var(--surface);border:1px solid var(--border);color:var(--accent);font-size:14px;
      padding:6px 14px;border-radius:20px;margin-bottom:10px;cursor:pointer;box-shadow:0 2px 8px var(--shadow)}
    .t{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:8px}
    .segbar{display:flex;gap:8px}
    .seg{flex:1;background:var(--surface);border:1px solid var(--border);color:var(--muted);
      border-radius:10px;padding:9px;font-size:13px;cursor:pointer}
    .seg.active{background:var(--accent);color:var(--accent-ink);border-color:var(--accent);font-weight:600}
    .set-row{display:flex;justify-content:space-between;align-items:center;background:var(--surface);
      border-radius:12px;padding:12px;font-size:14px}
    .set-select{background:var(--surface-2);color:var(--text);border:1px solid var(--border);
      border-radius:8px;padding:6px 10px;font-size:13px;cursor:pointer}
    .about-ver{display:flex;flex-direction:column;align-items:flex-end;gap:1px;
      color:var(--muted);font-size:12px;text-align:right;line-height:1.5}
    .about-box{background:var(--surface);border-radius:12px;padding:12px;
      font-size:13px;color:var(--muted);line-height:1.55}
    .about-box p{margin:0 0 8px}.about-box p:last-child{margin:0}
    .set-row.support{text-decoration:none;color:var(--text)}
    .set-row.support .muted{color:var(--accent)}
    .set-btn{width:100%;border:none;cursor:pointer;color:var(--text);font:inherit;text-align:left}
    .set-btn .muted{color:var(--accent)}
    .beta-badge{background:var(--accent);color:var(--accent-ink);font-size:9px;font-weight:700;
      letter-spacing:.05em;padding:2px 6px;border-radius:5px;vertical-align:middle;margin-left:6px}
    .dev-badge{background:#b7791f;color:#fff;font-size:9px;font-weight:700;
      letter-spacing:.05em;padding:2px 6px;border-radius:5px;vertical-align:middle;margin-left:6px}
    .set-cap{font-size:12px;color:var(--muted);margin:6px 2px 0;line-height:1.4}
    .switch{position:relative;display:inline-block;width:42px;height:24px;flex:none}
    .switch input{opacity:0;width:0;height:0}
    .slider{position:absolute;inset:0;background:var(--border);border-radius:24px;cursor:pointer;transition:background .15s}
    .slider::before{content:"";position:absolute;height:18px;width:18px;left:3px;top:3px;background:#fff;border-radius:50%;transition:transform .15s}
    .switch input:checked+.slider{background:var(--accent)}
    .switch input:checked+.slider::before{transform:translateX(18px)}
    .np-lbl{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:14px 2px 8px}
    .np-row{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:4px}
    .npday,.nptype{background:var(--surface);border:1px solid var(--border);color:var(--muted);border-radius:18px;padding:5px 13px;font-size:13px;cursor:pointer}
    .npday.active,.nptype.active{background:var(--accent);color:var(--accent-ink);border-color:var(--accent);font-weight:600}
    .ios-install{line-height:1.6}
    .ios-step{display:block;margin-top:4px;color:var(--text)}`;
  document.head.appendChild(s);
}
