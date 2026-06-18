import { wcEmoji, fmtDate } from "./format.js";
import { londonParts } from "../tz.js";
import { BOOKING_SITE } from "../config.js";

export function renderDay(view, state, arg, go) {
  // arg is either a date string (e.g. nav within the app) or { date, key }
  // where key identifies the session tapped on the agenda, to jump to.
  const date = typeof arg === "string" ? arg : arg.date;
  const targetKey = (arg && typeof arg === "object") ? arg.key : null;
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
    return `<div class="srow${s.booked ? " booked" : ""}" data-key="${s.key}">
      <div><div class="tm">${londonParts(s.start).time} <b>${s.label}</b></div><div class="muted small">${wx}</div></div>
      <div class="r">${right}</div></div>`;
  }).join("");

  view.innerHTML = `
    <button class="link" id="back">‹ Back</button>
    <h2>${fmtDate(date)}${day.weekend ? ' · weekend' : ''}</h2>
    <p class="muted small">${head}</p>
    <div class="lbl">Sessions</div>${rows}`;
  view.querySelector("#back").addEventListener("click", () => go("agenda"));
  injectDayStyles();

  // Jump to the session tapped on the agenda, if any.
  if (targetKey) {
    const row = [...view.querySelectorAll(".srow")].find(r => r.dataset.key === targetKey);
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.classList.add("flash");
      setTimeout(() => row.classList.remove("flash"), 1600);
    }
  }
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
    .small{font-size:11px}
    .srow.flash{outline:2px solid #2dd4bf;animation:flashbg 1.6s ease-out}
    @keyframes flashbg{0%{background:#1c3a35}100%{background:#16181c}}`;
  document.head.appendChild(s);
}
