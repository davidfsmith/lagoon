import { wcEmoji, fmtDate, fmtWhen } from "./format.js";
import { londonParts } from "../tz.js";
import { COURSES, FILTER_GROUPS } from "../config.js";

// Per-type filter: one toggle chip per session type. Core types are on by default;
// `extra` types (Taster, Jam, Drop-in) are hidden until the user taps their chip.
const TYPES_KEY = "lagoon.types";
const ALL_LABELS = COURSES.map(c => c.label);
const DEFAULT_LABELS = COURSES.filter(c => !c.extra).map(c => c.label);

function getActiveTypes(present) {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(TYPES_KEY) || "null"); } catch { stored = null; }
  const base = Array.isArray(stored) ? stored.filter(l => ALL_LABELS.includes(l)) : DEFAULT_LABELS;
  const active = new Set(base.filter(l => present.includes(l)));
  if (!active.size && !Array.isArray(stored)) {            // first run → core defaults
    for (const l of DEFAULT_LABELS) if (present.includes(l)) active.add(l);
  }
  return active;
}
const setActiveTypes = (set) => localStorage.setItem(TYPES_KEY, JSON.stringify([...set]));

export function renderAgenda(view, state, go) {
  const days = state.agenda || [];
  const stale = state.stale
    ? `<div class="stale">Showing saved data from ${fmtWhen(state.refreshedAt)} — couldn't refresh.</div>`
    : "";

  // Types present in the data, in config order (core first, then extras).
  const presentSet = new Set(days.flatMap(d => d.slots.map(s => s.label)));
  const present = ALL_LABELS.filter(l => presentSet.has(l));
  const active = getActiveTypes(present);

  const match = (s) => active.has(s.label);
  const shownDays = days
    .map(d => ({ ...d, slots: d.slots.filter(match) }))
    .filter(d => d.slots.length);

  // Chips render in two rows: "ride" sessions (30/15) on row 1, "other" on row 2.
  const chip = (l) => `<button class="filterbtn${active.has(l) ? " active" : ""}" data-type="${l}">${l}</button>`;
  const rows = FILTER_GROUPS.map(g => {
    const labels = COURSES.filter(c => c.group === g && present.includes(c.label)).map(c => c.label);
    return labels.length ? `<div class="filterbar">${labels.map(chip).join("")}</div>` : "";
  }).join("");
  const filterBar = present.length > 1 ? `<div class="filters">${rows}</div>` : "";

  const body = shownDays.length
    ? shownDays.map(d => {
        const w = d.summary;
        const wx = w ? `${wcEmoji(w.code)} ${Math.round(w.tMin)}–${Math.round(w.tMax)}° · ☔${w.precipProb}% · 🌬${Math.round(w.windMax)}(${Math.round(w.gustMax)})${w.uvMax != null ? ` · UV ${Math.round(w.uvMax)}` : ""}` : "";
        const bookable = d.slots.filter(s => !s.booked);
        const chips = d.slots.map(s =>
          `<span class="chip${s.booked ? " booked" : ""}" data-key="${s.key}">${londonParts(s.start).time} ${s.label}${s.booked ? " ✓" : ` <b>${s.free}</b>`}</span>`
        ).join("");
        return `<button class="day" data-date="${d.date}">
          <div class="day-hd"><span>${fmtDate(d.date)}</span>${d.weekend ? '<span class="wknd-tag">WEEKEND</span>' : ''}</div>
          ${wx ? `<div class="day-wx muted">${wx}</div>` : ""}
          <div class="chips">${chips}</div>
          ${bookable.length ? "" : '<div class="muted small">all booked / full</div>'}
        </button>`;
      }).join("")
    : `<p class="muted">${active.size ? "No free sessions in the selected types in the next 21 days." : "Tap a session type above to show sessions."}</p>`;

  view.innerHTML = `${stale}<h2>Free sessions</h2>
    <p class="refreshed">Last refreshed ${fmtWhen(state.refreshedAt)}</p>${filterBar}${body}`;

  for (const btn of view.querySelectorAll(".filterbtn")) {
    btn.addEventListener("click", () => {
      const l = btn.dataset.type;
      if (active.has(l)) active.delete(l); else active.add(l);
      setActiveTypes(active);
      renderAgenda(view, state, go);
    });
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
    .refreshed{font-size:12px;color:var(--muted);margin:-6px 0 14px}
    .filters{margin-bottom:12px}
    .filterbar{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px}
    .filterbar:last-child{margin-bottom:0}
    .filterbtn{background:var(--surface);border:1px solid var(--border);color:var(--muted);border-radius:18px;padding:5px 15px;font-size:13px;cursor:pointer}
    .filterbtn.active{background:var(--accent);color:var(--accent-ink);border-color:var(--accent);font-weight:600}
    .day{display:block;width:100%;text-align:left;background:var(--surface);border:none;border-radius:14px;padding:12px;margin-bottom:10px;color:inherit}
    .day-hd{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;font-weight:600}
    .day-wx{font-size:12px;font-weight:400;margin:-2px 0 8px}
    .wknd-tag{background:var(--accent);color:var(--accent-ink);font-size:11px;font-weight:700;letter-spacing:.04em;padding:2px 8px;border-radius:6px}
    .chips{display:flex;flex-wrap:wrap;gap:6px}
    .chip{background:var(--chip-bg);border:1px solid var(--chip-border);color:var(--chip-text);border-radius:8px;padding:4px 8px;font-size:12px}
    .chip b{color:var(--text)}.chip.booked{background:var(--surface-2);border-color:var(--border);color:var(--muted)}
    .small{font-size:11px;margin-top:6px}`;
  document.head.appendChild(s);
}
