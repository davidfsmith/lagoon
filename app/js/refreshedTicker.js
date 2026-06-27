// Keeps a "Last refreshed …" line live without re-fetching: every 10s it rewrites the
// element's text from the (fixed) refresh timestamp, so it ages "just now → 10s ago →
// 1 min ago → today at …" (see agoText). Only one line is visible at a time, so a single
// shared timer is enough; it self-stops when the element is gone (view replaced).
// `skip()` (optional) freezes updates, e.g. while a view is showing "Refreshing…".
import { agoText } from "./views/format.js";

let timer = null;
export function startRefreshedTicker(elId, refreshedAt, skip) {
  clearInterval(timer);
  timer = setInterval(() => {
    const el = document.getElementById(elId);
    if (!el) { clearInterval(timer); return; }                 // navigated away — stop ticking
    if (!(skip && skip())) el.textContent = `Last refreshed ${agoText(refreshedAt)}`;
  }, 10000);
}
