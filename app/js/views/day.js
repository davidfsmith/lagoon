import { wcEmoji, fmtDate } from "./format.js";
import { BOOKING_SITE } from "../config.js";

export function renderDay(view, state, date, go) {
  const day = (state.agenda || []).find(d => d.date === date);
  if (!day) { go("agenda"); return; }
  const w = day.summary;
  const head = w
    ? `${wcEmoji(w.code)} ${Math.round(w.tMin)}–${Math.round(w.tMax)}° · rain ${w.precipProb}% · wind ${Math.round(w.windMax)} (gust ${Math.round(w.gustMax)}) km/h · sunset ${(w.sunset || "").slice(11, 16)}`
    : "weather unavailable";

  const rows = day.slots.map(s => {
    const wx = s.weather ? `${wcEmoji(s.weather.code)} ${Math.round(s.weather.temp)}° · wind ${Math.round(s.weather.windSpeed)} · rain ${s.weather.precipProb}%` : "";
    const right = s.booked
      ? `<span class="tag">✓ You're booked</span>`
      : `<span class="free">${s.free} free</span>${s.freeWithMembership ? '<span class="mem">free w/ membership</span>' : ''}<a class="bk" target="_blank" rel="noopener" href="${BOOKING_SITE}">Book ↗</a>`;
    return `<div class="srow${s.booked ? " booked" : ""}">
      <div><div class="tm">${s.start.slice(11, 16)} <b>${s.label}</b></div><div class="muted small">${wx}</div></div>
      <div class="r">${right}</div></div>`;
  }).join("");

  view.innerHTML = `
    <button class="link" id="back">‹ Back</button>
    <h2>${fmtDate(date)}${day.weekend ? ' · weekend' : ''}</h2>
    <p class="muted small">${head}</p>
    <div class="lbl">Sessions</div>${rows}`;
  view.querySelector("#back").addEventListener("click", () => go("agenda"));
  injectDayStyles();
}

function injectDayStyles() {
  if (document.getElementById("day-css")) return;
  const s = document.createElement("style"); s.id = "day-css";
  s.textContent = `
    .link{background:none;border:none;color:#2dd4bf;padding:0;margin-bottom:4px;font-size:14px}
    .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;margin:14px 0 8px}
    .srow{display:flex;justify-content:space-between;align-items:center;background:#16181c;border-radius:12px;padding:11px 12px;margin-bottom:8px}
    .srow.booked{opacity:.7}.tm{font-weight:600}.tm b{color:#2dd4bf}
    .r{text-align:right;display:flex;flex-direction:column;gap:4px;align-items:flex-end}
    .free{color:#34d399;font-size:12px}.mem{color:#9aa0a6;font-size:10px}.tag{color:#fbbf24;font-size:12px}
    .bk{background:#2dd4bf;color:#06251f;border-radius:7px;padding:4px 12px;font-size:12px;font-weight:600;text-decoration:none}
    .small{font-size:11px}`;
  document.head.appendChild(s);
}
