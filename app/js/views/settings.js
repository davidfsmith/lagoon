import { getTheme, setTheme } from "../theme.js";
import { APP_VERSION, APP_RELEASE } from "../config.js";
import { logout } from "../app.js";
import { fmtWhen } from "./format.js";
import { showIntro } from "../intro.js";

// APP_VERSION is stamped at deploy as "build <sha> · <date>" (just "dev" locally).
// Split it back into the build SHA and date for the stacked About display.
function buildParts() {
  const m = APP_VERSION.match(/^build (\S+) · (.+)$/);
  return { build: m ? m[1] : APP_VERSION, date: m ? m[2] : "" };
}

export function renderSettings(view, state, go) {
  const theme = getTheme();
  const { build, date } = buildParts();
  const seg = (val, label) =>
    `<button class="seg${val === theme ? " active" : ""}" data-theme="${val}">${label}</button>`;

  view.innerHTML = `
    <button class="link" id="back">‹ Back</button>
    <h2>Settings</h2>

    <div class="t">Appearance</div>
    <div class="segbar">${seg("system", "System")}${seg("light", "Light")}${seg("dark", "Dark")}</div>

    <div class="t" style="margin-top:18px">About</div>
    <div class="about-box">
      <p>Shows live wakeboarding availability at Hove Lagoon, read straight from the
         Lagoon booking system each time you open the app — the same data the
         official site uses.</p>
      <p>Your sign-in goes directly to Lagoon. Only an access token is stored on this
         device to keep you signed in — your username and password are never saved.</p>
    </div>

    <div class="t" style="margin-top:16px">Version</div>
    <div class="set-row"><span>Hove Lagoon</span><span class="about-ver">
      <span>build ${build}</span>
      <span>${APP_RELEASE}</span>
      ${date ? `<span>${date}</span>` : ""}
    </span></div>

    ${state ? `<div class="t" style="margin-top:16px">Data</div>
    <div class="set-row"><span>Last refreshed</span><span class="muted">${fmtWhen(state.refreshedAt)}${state.stale ? " (saved)" : ""}</span></div>` : ""}

    <div class="t" style="margin-top:16px">Help</div>
    <button class="set-row set-btn" id="replay-intro"><span>Replay intro</span><span class="muted">›</span></button>

    <div class="t" style="margin-top:16px">Support</div>
    <a class="set-row support" href="mailto:dave@dave-smith.co.uk?subject=Lagoon%20App%20Support">
      <span>Email support</span><span class="muted">dave@dave-smith.co.uk ›</span></a>
    ${state ? `<button class="primary" id="logout" style="margin-top:18px">Log out</button>` : ""}`;

  view.querySelector("#back").addEventListener("click", () => go(state ? "agenda" : "login"));
  for (const b of view.querySelectorAll(".seg")) {
    b.addEventListener("click", () => { setTheme(b.dataset.theme); renderSettings(view, state, go); });
  }
  const lo = view.querySelector("#logout");
  if (lo) lo.addEventListener("click", () => logout());
  view.querySelector("#replay-intro").addEventListener("click", () => showIntro());
  injectSettingsStyles();
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
    .about-ver{display:flex;flex-direction:column;align-items:flex-end;gap:1px;
      color:var(--muted);font-size:12px;text-align:right;line-height:1.5}
    .about-box{background:var(--surface);border-radius:12px;padding:12px;
      font-size:13px;color:var(--muted);line-height:1.55}
    .about-box p{margin:0 0 8px}.about-box p:last-child{margin:0}
    .set-row.support{text-decoration:none;color:var(--text)}
    .set-row.support .muted{color:var(--accent)}
    .set-btn{width:100%;border:none;cursor:pointer;color:var(--text);font:inherit;text-align:left}
    .set-btn .muted{color:var(--accent)}`;
  document.head.appendChild(s);
}
