import { wcEmoji, fmtDate } from "./format.js";
import { londonParts } from "../tz.js";

const FILTER_KEY = "lagoon.cable";
const cableOf = (s) => (s.label || "").split(" ")[0]; // "Tech 30" -> "Tech"
const getFilter = () => localStorage.getItem(FILTER_KEY) || "all";
const setFilter = (v) => localStorage.setItem(FILTER_KEY, v);

export function renderAgenda(view, state, go) {
  const days = state.agenda || [];
  const stale = state.stale ? `<div class="stale">Showing saved data — couldn't refresh.</div>` : "";

  // Cables present in the data (e.g. Tech, Air) drive the filter, so enabling
  // more courses later extends it automatically.
  const cables = [...new Set(days.flatMap(d => d.slots.map(cableOf)))].sort();
  let filter = getFilter();
  if (filter !== "all" && !cables.includes(filter)) filter = "all";

  const match = (s) => filter === "all" || cableOf(s) === filter;
  const shownDays = days
    .map(d => ({ ...d, slots: d.slots.filter(match) }))
    .filter(d => d.slots.length);

  const filterBar = cables.length > 1
    ? `<div class="filterbar">` + ["all", ...cables].map(c =>
        `<button class="filterbtn${c === filter ? " active" : ""}" data-cable="${c}">${c === "all" ? "All" : c}</button>`
      ).join("") + `</div>`
    : "";

  const body = shownDays.length
    ? shownDays.map(d => {
        const w = d.summary;
        const wx = w ? `${wcEmoji(w.code)} ${Math.round(w.tMin)}–${Math.round(w.tMax)}° · ☔${w.precipProb}% · 🌬${Math.round(w.windMax)}(${Math.round(w.gustMax)})${w.uvMax != null ? ` · UV ${Math.round(w.uvMax)}` : ""}` : "";
        const bookable = d.slots.filter(s => !s.booked);
        const chips = d.slots.map(s =>
          `<span class="chip${s.booked ? " booked" : ""}" data-key="${s.key}">${londonParts(s.start).time} ${s.label}${s.booked ? " ✓" : ` <b>${s.free}</b>`}</span>`
        ).join("");
        return `<button class="day" data-date="${d.date}">
          <div class="day-hd"><span>${fmtDate(d.date)}${d.weekend ? ' <span class="wknd-tag">WEEKEND</span>' : ''}</span><span class="muted">${wx}</span></div>
          <div class="chips">${chips}</div>
          ${bookable.length ? "" : '<div class="muted small">all booked / full</div>'}
        </button>`;
      }).join("")
    : `<p class="muted">No ${filter === "all" ? "" : filter + " "}free sessions in the next 21 days.</p>`;

  view.innerHTML = `${stale}<h2>Free sessions</h2>${filterBar}${body}`;

  for (const btn of view.querySelectorAll(".filterbtn")) {
    btn.addEventListener("click", () => { setFilter(btn.dataset.cable); renderAgenda(view, state, go); });
  }
  for (const el of view.querySelectorAll(".day")) {
    el.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      go("day", { date: el.dataset.date, key: chip ? chip.dataset.key : null });
    });
  }
  injectAgendaStyles();
}

function injectAgendaStyles() {
  if (document.getElementById("agenda-css")) return;
  const s = document.createElement("style"); s.id = "agenda-css";
  s.textContent = `
    .filterbar{display:flex;gap:8px;margin-bottom:12px}
    .filterbtn{background:var(--surface);border:1px solid var(--border);color:var(--muted);border-radius:18px;padding:5px 15px;font-size:13px;cursor:pointer}
    .filterbtn.active{background:var(--accent);color:var(--accent-ink);border-color:var(--accent);font-weight:600}
    .day{display:block;width:100%;text-align:left;background:var(--surface);border:none;border-radius:14px;padding:12px;margin-bottom:10px;color:inherit}
    .day-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-weight:600}
    .wknd-tag{background:var(--accent);color:var(--accent-ink);font-size:11px;font-weight:700;letter-spacing:.04em;padding:2px 8px;border-radius:6px;margin-left:8px}
    .chips{display:flex;flex-wrap:wrap;gap:6px}
    .chip{background:var(--chip-bg);border:1px solid var(--chip-border);color:var(--chip-text);border-radius:8px;padding:4px 8px;font-size:12px}
    .chip b{color:var(--text)}.chip.booked{background:var(--surface-2);border-color:var(--border);color:var(--muted)}
    .small{font-size:11px;margin-top:6px}`;
  document.head.appendChild(s);
}
