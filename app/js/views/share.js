// "Share this app" section on the About tab: a native share-sheet button (where
// supported), a copy-link button, and a scannable QR of the app URL. Dev-only —
// gated by isOn("shareApp") at the call site (settings.js). shareSectionHtml() is
// pure (testable); wireShareSection() wires the buttons + injects CSS.
import { APP_URL } from "../config.js";

const canNativeShare = () => typeof navigator !== "undefined" && !!navigator.share;

export function shareSectionHtml() {
  return `
    <div class="t" style="margin-top:16px">Share this app</div>
    <div class="share-box">
      <p class="share-intro">Send the app to a friend at the lagoon.</p>
      <div class="share-btns">
        ${canNativeShare() ? `<button class="share-btn primary" id="share-native">Share…</button>` : ""}
        <button class="share-btn" id="share-copy" data-url="${APP_URL}">Copy link</button>
      </div>
      <div class="share-qr"><img src="share-qr.svg" alt="QR code linking to ${APP_URL}" width="180" height="180"></div>
      <p class="set-cap" style="text-align:center">Or scan to open it.</p>
    </div>`;
}

export function wireShareSection(view) {
  injectShareStyles();

  const nativeBtn = view.querySelector("#share-native");
  if (nativeBtn) nativeBtn.addEventListener("click", async () => {
    try { await navigator.share({ title: "Hove Lagoon", url: APP_URL }); }
    catch { /* user cancelled the share sheet, or it's unavailable — no-op */ }
  });

  const copyBtn = view.querySelector("#share-copy");
  if (copyBtn) copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(copyBtn.dataset.url);
      const prev = copyBtn.textContent;
      copyBtn.textContent = "Copied ✓";
      copyBtn.classList.add("ok");
      setTimeout(() => { copyBtn.textContent = prev; copyBtn.classList.remove("ok"); }, 1500);
    } catch { /* clipboard blocked — the link is on screen (QR) to use by hand */ }
  });
}

function injectShareStyles() {
  if (document.getElementById("share-css")) return;
  const s = document.createElement("style"); s.id = "share-css";
  s.textContent = `
    .share-box{background:var(--surface);border-radius:12px;padding:14px}
    .share-intro{font-size:13px;color:var(--muted);line-height:1.5;margin:0 0 12px}
    .share-btns{display:flex;gap:8px;margin-bottom:14px}
    .share-btn{flex:1;background:var(--surface-2);border:1px solid var(--border);color:var(--accent);
      border-radius:8px;padding:9px 14px;font-size:14px;font-weight:600;cursor:pointer}
    .share-btn.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
    .share-btn.ok{color:var(--accent-ink);background:var(--accent);border-color:var(--accent)}
    .share-qr{display:flex;justify-content:center;padding:12px 0 4px}
    .share-qr img{display:block;width:180px;height:180px;border-radius:8px}`;
  document.head.appendChild(s);
}
