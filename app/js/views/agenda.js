import { wcEmoji, fmtDate } from "./format.js";

export function renderAgenda(view, state, go) {
  const days = state.agenda || [];
  const stale = state.stale ? `<div class="stale">Showing saved data — couldn't refresh.</div>` : "";
  if (!days.length) {
    view.innerHTML = `${stale}<h2>Agenda</h2><p class="muted">No free sessions in the next 21 days.</p>`;
    return;
  }
  view.innerHTML = `${stale}<h2>Free sessions</h2>` + days.map(d => {
    const bookable = d.slots.filter(s => !s.booked);
    const w = d.summary;
    const wx = w ? `${wcEmoji(w.code)} ${Math.round(w.tMin)}–${Math.round(w.tMax)}° · ☔${w.precipProb}% · 🌬${Math.round(w.windMax)}(${Math.round(w.gustMax)})` : "";
    const chips = d.slots.map(s =>
      `<span class="chip${s.booked ? " booked" : ""}">${s.start.slice(11, 16)} ${s.label}${s.booked ? " ✓" : ` <b>${s.free}</b>`}</span>`
    ).join("");
    return `<button class="day" data-date="${d.date}">
      <div class="day-hd"><span>${fmtDate(d.date)}${d.weekend ? ' <em>WKND</em>' : ''}</span><span class="muted">${wx}</span></div>
      <div class="chips">${chips}</div>
      ${bookable.length ? "" : '<div class="muted small">all booked / full</div>'}
    </button>`;
  }).join("");
  for (const el of view.querySelectorAll(".day")) {
    el.addEventListener("click", () => go("day", el.dataset.date));
  }
  injectAgendaStyles();
}

function injectAgendaStyles() {
  if (document.getElementById("agenda-css")) return;
  const s = document.createElement("style"); s.id = "agenda-css";
  s.textContent = `
    .day{display:block;width:100%;text-align:left;background:#16181c;border:none;border-radius:14px;padding:12px;margin-bottom:10px;color:inherit}
    .day-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-weight:600}
    .day-hd em{color:#2dd4bf;font-size:10px;font-style:normal}
    .chips{display:flex;flex-wrap:wrap;gap:6px}
    .chip{background:#13241f;border:1px solid #2dd4bf44;color:#cfeee7;border-radius:8px;padding:4px 8px;font-size:12px}
    .chip b{color:#fff}.chip.booked{background:#1a1d22;border-color:#333;color:#9aa0a6}
    .small{font-size:11px;margin-top:6px}`;
  document.head.appendChild(s);
}
