// The Café tab of the Settings page: guest WiFi details for people working from the
// Lagoon Café. Copy-to-tap SSID/password, a scannable WiFi QR, and manual steps.
// cafeTabHtml() is pure (testable); wireCafeTab() wires the copy buttons + injects CSS.
import { CAFE_WIFI } from "../config.js";

// A labelled value row with a tap-to-copy button. data-copy carries the raw value.
function copyRow(label, value) {
  return `<div class="cafe-row">
      <div class="cafe-field"><span class="cafe-lbl">${label}</span><span class="cafe-val">${value}</span></div>
      <button class="cafe-copy" data-copy="${value}" aria-label="Copy ${label}">Copy</button>
    </div>`;
}

export function cafeTabHtml() {
  const { ssid, password } = CAFE_WIFI;
  return `
    <div class="t">Café WiFi</div>
    <p class="cafe-intro">Work from the Lagoon Café — hop on the guest WiFi.</p>
    ${copyRow("Network", ssid)}
    ${copyRow("Password", password)}

    <div class="t" style="margin-top:18px">Scan to join</div>
    <div class="cafe-qr"><img src="wifi-qr.svg" alt="WiFi QR code for ${ssid}" width="200" height="200"></div>
    <p class="set-cap" style="text-align:center">Fastest way — point your camera at this.</p>

    <div class="t" style="margin-top:18px">Or connect manually</div>
    <ol class="cafe-steps">
      <li>Open your phone's WiFi settings.</li>
      <li>Pick <b>${ssid}</b> from the list.</li>
      <li>Enter the password above (tap Copy to paste it).</li>
    </ol>`;
}

export function wireCafeTab(view) {
  injectCafeStyles();
  for (const b of view.querySelectorAll(".cafe-copy")) {
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copy);
        const prev = b.textContent;
        b.textContent = "Copied ✓";
        b.classList.add("ok");
        setTimeout(() => { b.textContent = prev; b.classList.remove("ok"); }, 1500);
      } catch { /* clipboard blocked — the value is on screen to copy by hand */ }
    });
  }
}

function injectCafeStyles() {
  if (document.getElementById("cafe-css")) return;
  const s = document.createElement("style"); s.id = "cafe-css";
  s.textContent = `
    .cafe-intro{font-size:13px;color:var(--muted);line-height:1.5;margin:0 2px 14px}
    .cafe-row{display:flex;justify-content:space-between;align-items:center;background:var(--surface);
      border-radius:12px;padding:12px;margin-bottom:8px}
    .cafe-field{display:flex;flex-direction:column;gap:2px;min-width:0}
    .cafe-lbl{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
    .cafe-val{font-size:15px;font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
      overflow-wrap:anywhere}
    .cafe-copy{flex:none;background:var(--surface-2);border:1px solid var(--border);color:var(--accent);
      border-radius:8px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer;margin-left:12px}
    .cafe-copy.ok{color:var(--accent-ink);background:var(--accent);border-color:var(--accent)}
    .cafe-qr{display:flex;justify-content:center;padding:14px;background:var(--surface);border-radius:12px}
    .cafe-qr img{display:block;width:200px;height:200px;border-radius:8px}
    .cafe-steps{margin:8px 2px 0;padding-left:20px;font-size:13px;color:var(--text);line-height:1.7}`;
  document.head.appendChild(s);
}
