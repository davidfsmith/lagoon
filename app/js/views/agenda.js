import { fmtDate, fmtWhen, agoText, dayWx } from "./format.js";
import { londonParts } from "../tz.js";
import { presentTypes, getActiveTypes, filterBarHtml, wireFilterChips, injectFilterStyles } from "../filters.js";
import { startRefreshedTicker } from "../refreshedTicker.js";
import { isOn } from "../features.js";
import { getDiscipline } from "../store.js";
import { switchDiscipline } from "../app.js";

// Dev-only discipline switch (wake ⇄ SUP). Absent unless isOn("supBooking"), so the
// wake-only view is unchanged for everyone else.
function disciplineBarHtml() {
  if (!isOn("supBooking")) return "";
  const d = getDiscipline();
  const seg = (val, label) => `<button class="disc${val === d ? " active" : ""}" data-disc="${val}">${label}</button>`;
  return `<div class="discbar">${seg("wake", "🏄 Wakeboard")}${seg("sup", "🏄‍♂️ SUP")}</div>`;
}

export function renderAgenda(view, state, go) {
  const days = state.agenda || [];
  const stale = state.stale
    ? `<div class="stale">Showing saved data from ${fmtWhen(state.refreshedAt)} — couldn't refresh.</div>`
    : "";

  const present = presentTypes(days.flatMap(d => d.slots));
  const active = getActiveTypes(present);
  const filterBar = filterBarHtml(present, active);

  const shownDays = days
    .map(d => ({ ...d, slots: d.slots.filter(s => active.has(s.label)) }))
    .filter(d => d.slots.length);

  const body = shownDays.length
    ? shownDays.map(d => {
        const wx = dayWx(d.summary);
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

  view.innerHTML = `${disciplineBarHtml()}${stale}<h2>Free sessions</h2>
    <p class="refreshed" id="ag-refreshed">Last refreshed ${agoText(state.refreshedAt)}</p>${filterBar}${body}`;

  for (const b of view.querySelectorAll(".disc")) b.addEventListener("click", () => {
    if (b.dataset.disc !== getDiscipline()) switchDiscipline(b.dataset.disc);
  });
  wireFilterChips(view, active, () => renderAgenda(view, state, go));
  for (const el of view.querySelectorAll(".day")) {
    el.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      go("day", { date: el.dataset.date, key: chip ? chip.dataset.key : null });
    });
  }
  injectFilterStyles();
  injectAgendaStyles();
  startRefreshedTicker("ag-refreshed", () => `Last refreshed ${agoText(state.refreshedAt)}`);
}

function injectAgendaStyles() {
  if (document.getElementById("agenda-css")) return;
  const s = document.createElement("style"); s.id = "agenda-css";
  s.textContent = `
    .discbar{display:flex;gap:8px;margin-bottom:14px}
    .disc{flex:1;background:var(--surface);border:1px solid var(--border);color:var(--muted);
      border-radius:10px;padding:9px;font-size:14px;cursor:pointer}
    .disc.active{background:var(--accent);color:var(--accent-ink);border-color:var(--accent);font-weight:600}
    .refreshed{font-size:12px;color:var(--muted);margin:-6px 0 14px}
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
