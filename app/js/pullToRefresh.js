// Pull-to-refresh: drag down at the top of the page to reload data, so users get
// fresh availability without force-quitting the PWA. Drives a small indicator that
// descends from under the sticky header; triggers `onRefresh` once past threshold.
//
// `onRefresh` is an async function (awaited). `canPull` returns whether a pull
// should engage right now (e.g. logged in, not already loading).

const THRESHOLD = 70;   // px of pull (after resistance) needed to trigger
const MAX = 100;        // clamp so the indicator can't run away
const RESIST = 0.5;     // finger travel -> indicator travel

export function initPullToRefresh({ onRefresh, canPull }) {
  injectStyles();
  // <main id="view"> is the scroll container (the document itself no longer scrolls — see
  // the app-shell note in index.html), so "am I at the top?" reads its scrollTop, not window.
  const scroller = document.getElementById("view");
  const atTop = () => (scroller ? scroller.scrollTop : window.scrollY) <= 0;
  const el = document.createElement("div");
  el.id = "ptr";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `<div class="ptr-icon">↓</div>`;
  document.body.appendChild(el);
  const icon = el.querySelector(".ptr-icon");

  let startY = 0, pulling = false, dist = 0, refreshing = false;

  const place = (px) => { el.style.transform = `translateY(${px}px)`; };
  const reset = () => {
    pulling = false; dist = 0;
    el.classList.remove("ready", "spin", "show");
    icon.textContent = "↓"; icon.style.transform = "";
    place(0);
  };
  reset();

  document.addEventListener("touchstart", (e) => {
    if (refreshing || !canPull() || !atTop() || e.touches.length !== 1) return;
    startY = e.touches[0].clientY;
    pulling = true;
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (!pulling || refreshing) return;
    if (!atTop()) { reset(); return; }
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0) { reset(); return; }
    e.preventDefault();                 // take over from native rubber-band
    dist = Math.min(dy * RESIST, MAX);
    el.classList.add("show");
    place(dist);
    const ready = dist >= THRESHOLD;
    el.classList.toggle("ready", ready);
    icon.style.transform = `rotate(${ready ? 180 : 0}deg)`;
  }, { passive: false });

  document.addEventListener("touchend", async () => {
    if (!pulling || refreshing) return;
    const trigger = dist >= THRESHOLD;
    pulling = false;
    if (!trigger) { reset(); return; }
    refreshing = true;
    el.classList.remove("ready");
    el.classList.add("show", "spin");
    icon.textContent = ""; icon.style.transform = "";  // CSS draws a ring spinner
    place(THRESHOLD);
    try { await onRefresh(); }
    finally { refreshing = false; reset(); }
  }, { passive: true });
}

function injectStyles() {
  if (document.getElementById("ptr-css")) return;
  const s = document.createElement("style"); s.id = "ptr-css";
  s.textContent = `
    #ptr{position:fixed;top:52px;left:50%;margin-left:-18px;transform:translateY(0);z-index:9;
      width:36px;height:36px;border-radius:50%;display:flex;align-items:center;
      justify-content:center;background:var(--surface);border:1px solid var(--border);
      box-shadow:0 2px 10px var(--shadow);opacity:0;pointer-events:none;
      transition:opacity .15s}
    #ptr.show{opacity:1}
    #ptr .ptr-icon{color:var(--muted);font-size:18px;line-height:1;transition:transform .15s}
    #ptr.ready{border-color:var(--accent)} #ptr.ready .ptr-icon{color:var(--accent)}
    /* Spin state: a symmetric border ring (not a glyph) so it rotates true to centre. */
    #ptr.spin .ptr-icon{width:18px;height:18px;border:2px solid var(--border);
      border-top-color:var(--accent);border-radius:50%;animation:ptr-spin .6s linear infinite}
    @keyframes ptr-spin{to{transform:rotate(360deg)}}`;
  document.head.appendChild(s);
}
