// Keeps a "Last refreshed …" line live without re-fetching: every 10s it recomputes the
// element's text via `render()` (which uses agoText, so it ages "just now → 10s ago →
// 1 min ago → today at …"). `render()` may return null to skip an update — e.g. while a
// view is showing "Refreshing…". Only one such line is visible at a time, so a single
// shared timer suffices; it self-stops when the element is gone (view replaced).
let timer = null;
export function startRefreshedTicker(elId, render) {
  clearInterval(timer);
  timer = setInterval(() => {
    const el = document.getElementById(elId);
    if (!el) { clearInterval(timer); return; }   // navigated away — stop ticking
    const text = render();
    if (text != null) el.textContent = text;
  }, 10000);
}
