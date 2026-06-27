import { wcEmoji, fmtWhen, fmtDate, agoText } from "./format.js";
import { londonParts } from "../tz.js";
import { BOOKING_SITE } from "../config.js";
import { presentTypes, getActiveTypes, filterBarHtml, wireFilterChips, injectFilterStyles } from "../filters.js";
import { getLastMinuteWindow, setLastMinuteWindow } from "../store.js";
import { sessionsInWindow } from "../model.js";
import { setLastMinuteIcon, isRefreshing } from "../app.js";
import { startRefreshedTicker } from "../refreshedTicker.js";

const WINDOWS = [
  { id: "today", label: "Today", prose: "today" },
  { id: "weekend", label: "Weekend", prose: "this weekend" },
  { id: "48h", label: "48h", prose: "in the next 48h" },
];

export function renderLastMinute(view, state, go) {
  const win = getLastMinuteWindow();
  const winDef = WINDOWS.find(w => w.id === win) || WINDOWS[0];

  const stale = state.stale
    ? `<div class="stale">Showing saved data from ${fmtWhen(state.refreshedAt)} — couldn't refresh.</div>`
    : "";

  // Same per-type filter as Availability, so the selection is consistent everywhere.
  const present = presentTypes((state.agenda || []).flatMap(d => d.slots));
  const active = getActiveTypes(present);
  const filterBar = filterBarHtml(present, active);

  const justOpened = state.justOpened || new Set();
  const slots = sessionsInWindow(state.agenda, win, new Date()).filter(s => active.has(s.label));

  const seg = WINDOWS.map(w =>
    `<button class="lmseg${w.id === win ? " active" : ""}" data-win="${w.id}">${w.label}</button>`
  ).join("");

  const rows = slots.length ? slots.map(s => {
    const lp = londonParts(s.start);
    const wx = s.weather
      ? `${wcEmoji(s.weather.code)} ${Math.round(s.weather.temp)}° · wind ${Math.round(s.weather.windSpeed)} · rain ${s.weather.precipProb}%`
      : "";
    const opened = justOpened.has(s.key) ? `<span class="lmnew">just opened ↑</span>` : "";
    const right = s.booked
      ? `<span class="tag">✓ You're booked</span>`
      : `<span class="free">${s.free} free</span><a class="bk" target="_blank" rel="noopener" href="${s.runId ? `${BOOKING_SITE}/book?courseRunId=${s.runId}` : BOOKING_SITE}">Book ↗</a>`;
    return `<div class="srow${s.booked ? " booked" : ""}">
      <div><div class="tm">${fmtDate(lp.date)} ${lp.time} <b>${s.label}</b> ${opened}</div>
        <div class="muted small">${wx}</div></div>
      <div class="r">${right}</div></div>`;
  }).join("")
    : `<p class="muted">Nothing free ${winDef.prose} right now — pull to refresh, or browse everything in <button class="linkish" id="lm-toagenda">Availability</button>.</p>`;

  view.innerHTML = `${stale}<h2>🔥 Last-minute</h2>
    <p class="refreshed" id="lm-refreshed">${isRefreshing() ? "Refreshing…" : `Last refreshed ${agoText(state.refreshedAt)}`}</p>
    <div class="lmsegbar">${seg}</div>
    ${filterBar}
    ${rows}`;

  for (const b of view.querySelectorAll(".lmseg")) {
    b.addEventListener("click", () => { setLastMinuteWindow(b.dataset.win); renderLastMinute(view, state, go); setLastMinuteIcon(); });
  }
  const toAgenda = view.querySelector("#lm-toagenda");
  if (toAgenda) toAgenda.addEventListener("click", () => go("agenda"));
  wireFilterChips(view, active, () => renderLastMinute(view, state, go));
  injectFilterStyles();
  injectLastMinuteStyles();
  startRefreshedTicker("lm-refreshed", () => isRefreshing() ? null : `Last refreshed ${agoText(state.refreshedAt)}`);
}

function injectLastMinuteStyles() {
  if (document.getElementById("lm-css")) return;
  const s = document.createElement("style"); s.id = "lm-css";
  s.textContent = `
    .refreshed{font-size:12px;color:var(--muted);margin:-6px 0 12px}
    .lmsegbar{display:flex;gap:8px;margin-bottom:12px}
    .lmseg{flex:1;background:var(--surface);border:1px solid var(--border);color:var(--muted);border-radius:10px;padding:9px;font-size:13px;cursor:pointer}
    .lmseg.active{background:var(--accent);color:var(--accent-ink);border-color:var(--accent);font-weight:600}
    .srow{display:flex;justify-content:space-between;align-items:center;background:var(--surface);border-radius:12px;padding:11px 12px;margin-bottom:8px}
    .srow.booked{opacity:.7}
    .tm{font-weight:600}.tm b{color:var(--accent)}
    .r{text-align:right;display:flex;flex-direction:column;gap:4px;align-items:flex-end}
    .free{color:var(--good);font-size:12px}.tag{color:var(--warn);font-size:12px}
    .bk{background:var(--accent);color:var(--accent-ink);border-radius:7px;padding:4px 12px;font-size:12px;font-weight:600;text-decoration:none;white-space:nowrap}
    .small{font-size:11px}
    .lmnew{background:var(--good);color:var(--accent-ink);font-size:10px;font-weight:700;letter-spacing:.03em;padding:2px 7px;border-radius:6px;margin-left:4px;white-space:nowrap}
    .linkish{background:none;border:none;color:var(--accent);font:inherit;cursor:pointer;padding:0;text-decoration:underline}`;
  document.head.appendChild(s);
}
