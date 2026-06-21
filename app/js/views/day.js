import { wcEmoji, fmtDate } from "./format.js";
import { londonParts } from "../tz.js";
import { BOOKING_SITE } from "../config.js";
import { presentTypes, getActiveTypes, filterBarHtml, wireFilterChips, injectFilterStyles } from "../filters.js";

export function renderDay(view, state, arg, go) {
  // arg is either a date string (e.g. nav within the app) or { date, key }
  // where key identifies the session tapped on the agenda, to jump to.
  const date = typeof arg === "string" ? arg : arg.date;
  const targetKey = (arg && typeof arg === "object") ? arg.key : null;
  const day = (state.agenda || []).find(d => d.date === date);
  if (!day) { go("agenda"); return; }
  const w = day.summary;
  const head = w
    ? `${wcEmoji(w.code)} ${Math.round(w.tMin)}–${Math.round(w.tMax)}° · rain ${w.precipProb}% · wind ${Math.round(w.windMax)} (gust ${Math.round(w.gustMax)}) km/h${w.uvMax != null ? ` · UV ${Math.round(w.uvMax)}` : ""} · sunset ${(w.sunset || "").slice(11, 16)}`
    : "weather unavailable";

  // Same per-type filter as the agenda: show the full chip set (types present
  // anywhere in the agenda, not just this day) with the same active selection, so
  // the two pages always agree. Then filter this day's slots by the active types.
  const present = presentTypes((state.agenda || []).flatMap(d => d.slots));
  const active = getActiveTypes(present);
  const filterBar = filterBarHtml(present, active);
  const slots = day.slots.filter(s => active.has(s.label));

  const rows = slots.length ? slots.map(s => {
    const wx = s.weather ? `${wcEmoji(s.weather.code)} ${Math.round(s.weather.temp)}° · wind ${Math.round(s.weather.windSpeed)} · rain ${s.weather.precipProb}%${s.weather.uv != null ? ` · UV ${Math.round(s.weather.uv)}` : ""}` : "";
    const right = s.booked
      ? `<span class="tag">✓ You're booked</span>`
      : `<span class="free">${s.free} free</span>${s.freeWithMembership ? '<span class="mem">free w/ membership</span>' : ''}<a class="bk" target="_blank" rel="noopener" href="${s.runId ? `${BOOKING_SITE}/book?courseRunId=${s.runId}` : BOOKING_SITE}">Book ↗</a>`;
    return `<div class="srow${s.booked ? " booked" : ""}" data-key="${s.key}">
      <div><div class="tm">${londonParts(s.start).time} <b>${s.label}</b></div><div class="muted small">${wx}</div></div>
      <div class="r">${right}</div></div>`;
  }).join("")
    : `<p class="muted small">${active.size ? "No sessions in the selected types." : "Tap a session type above to show sessions."}</p>`;

  view.innerHTML = `
    <button class="link" id="back">‹ Back</button>
    <h2>${fmtDate(date)}${day.weekend ? ' <span class="wknd-tag">WEEKEND</span>' : ''}</h2>
    <p class="muted small">${head}</p>
    ${filterBar}
    <div class="lbl">Sessions</div>${rows}`;
  view.querySelector("#back").addEventListener("click", () => go("agenda"));
  // Re-render on filter change. Pass the date only (drop the jump key) so toggling
  // a chip doesn't re-scroll to the originally-tapped session.
  wireFilterChips(view, active, () => renderDay(view, state, date, go));
  injectFilterStyles();
  injectDayStyles();

  // Jump to the session tapped on the agenda, if any.
  if (targetKey) {
    const row = [...view.querySelectorAll(".srow")].find(r => r.dataset.key === targetKey);
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.classList.add("selected"); // persistent highlight while on this page
    }
  }
}

function injectDayStyles() {
  if (document.getElementById("day-css")) return;
  const s = document.createElement("style"); s.id = "day-css";
  s.textContent = `
    .link{position:sticky;top:50px;z-index:5;display:inline-flex;align-items:center;
      background:var(--surface);border:1px solid var(--border);color:var(--accent);font-size:14px;
      padding:6px 14px;border-radius:20px;margin-bottom:10px;cursor:pointer;
      box-shadow:0 2px 8px var(--shadow)}
    .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:14px 0 8px}
    .srow{display:flex;justify-content:space-between;align-items:center;background:var(--surface);border-radius:12px;padding:11px 12px;margin-bottom:8px}
    .srow.booked{opacity:.7}.tm{font-weight:600}.tm b{color:var(--accent)}
    .r{text-align:right;display:flex;flex-direction:column;gap:4px;align-items:flex-end}
    .free{color:var(--good);font-size:12px}.mem{color:var(--muted);font-size:10px}.tag{color:var(--warn);font-size:12px}
    .bk{background:var(--accent);color:var(--accent-ink);border-radius:7px;padding:4px 12px;font-size:12px;font-weight:600;text-decoration:none}
    .small{font-size:11px}
    .srow.selected{outline:2px solid var(--accent);background:var(--selected-bg)}
    .wknd-tag{background:var(--accent);color:var(--accent-ink);font-size:11px;font-weight:700;letter-spacing:.04em;padding:2px 8px;border-radius:6px;vertical-align:middle;margin-left:8px}`;
  document.head.appendChild(s);
}
