import { getTheme, setTheme } from "../theme.js";
import { APP_VERSION, APP_RELEASE } from "../config.js";
import { logout } from "../app.js";
import { agoText } from "./format.js";
import { startRefreshedTicker } from "../refreshedTicker.js";
import { showIntro } from "../intro.js";
import { getReminderMinutes, setReminderMinutes, REMINDER_OPTIONS, getDefaultLanding, setDefaultLanding, LANDING_OPTIONS } from "../store.js";
import { isBetaUser } from "../features.js";
import { tabBarHtml, injectTabStyles } from "../tabs.js";

// Two tabs: Settings (appearance, reminder, data, log out) and About (what it is,
// version, help, support). The active tab persists for the session.
let activeTab = "settings";

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

    ${state ? `<div class="t" style="margin-top:18px">Data</div>
    <div class="set-row"><span>Last refreshed</span><span class="muted" id="set-refreshed">${agoText(state.refreshedAt)}${state.stale ? " (saved)" : ""}</span></div>

    <button class="primary" id="logout" style="margin-top:18px">Log out</button>` : ""}`;

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
    <div class="set-row"><span>Hove Lagoon${isBetaUser(state) ? ' <span class="beta-badge">BETA</span>' : ""}</span><span class="about-ver">
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
      letter-spacing:.05em;padding:2px 6px;border-radius:5px;vertical-align:middle;margin-left:6px}`;
  document.head.appendChild(s);
}
