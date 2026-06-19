import { getTheme, setTheme } from "../theme.js";
import { APP_VERSION } from "../config.js";

export function renderSettings(view, state, go) {
  const theme = getTheme();
  const seg = (val, label) =>
    `<button class="seg${val === theme ? " active" : ""}" data-theme="${val}">${label}</button>`;

  view.innerHTML = `
    <button class="link" id="back">‹ Back</button>
    <h2>Settings</h2>

    <div class="t">Appearance</div>
    <div class="segbar">${seg("system", "System")}${seg("light", "Light")}${seg("dark", "Dark")}</div>

    <div class="t" style="margin-top:18px">About</div>
    <div class="set-row"><span>Hove Lagoon</span><span class="muted">${APP_VERSION}</span></div>`;

  view.querySelector("#back").addEventListener("click", () => go(state ? "agenda" : "login"));
  for (const b of view.querySelectorAll(".seg")) {
    b.addEventListener("click", () => { setTheme(b.dataset.theme); renderSettings(view, state, go); });
  }
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
      border-radius:12px;padding:12px;font-size:14px}`;
  document.head.appendChild(s);
}
