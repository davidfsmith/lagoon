// The History tab on the Bookings screen: a year-grouped list of past sessions plus a
// small stats strip. Gated by isOn("history") in account.js. Reads only data already in
// state (meBookings) — see historyModel.js for the pure derivation.
import { pastSessions } from "../historyModel.js";
import { fmtDate } from "./format.js";

const DAY_FULL = { Sun: "Sundays", Mon: "Mondays", Tue: "Tuesdays", Wed: "Wednesdays", Thu: "Thursdays", Fri: "Fridays", Sat: "Saturdays" };

export function renderHistory(state) {
  injectHistoryStyles();
  const { list, stats } = pastSessions(state.meBookings, state.me, new Date());

  if (!list.length) {
    return `<div class="histrow muted">No past sessions yet — they'll show here after you've ridden.</div>`;
  }

  const year = new Date().getFullYear();
  const strip = `
    <div class="hist-strip">
      <div class="hist-hero"><b>${stats.total}</b> ride${stats.total === 1 ? "" : "s"}
        <span class="hist-year">${stats.thisYear} in ${year}</span></div>
      ${stats.streak ? `<div class="hist-line hist-streak">🔥 ${stats.streak}-week streak</div>` : ""}
      ${stats.perRider.length ? `<div class="hist-line">${stats.perRider.map(r => `${r.name} ${r.count}`).join(" · ")}</div>` : ""}
      ${stats.favType ? `<div class="hist-line hist-fav">Most: ${stats.favType}${stats.favDay ? ` · ${DAY_FULL[stats.favDay]}` : ""}</div>` : ""}
    </div>`;

  // Year-grouped rows (list is already newest-first, so years descend naturally).
  let rows = "", curYear = null;
  for (const e of list) {
    if (e.year !== curYear) { curYear = e.year; rows += `<div class="hist-yr">${e.year}</div>`; }
    rows += `<div class="histrow">
      <span class="histwhen">${fmtDate(e.date)}</span>
      <span class="histtype">${e.typeLabel}</span>
      ${e.riders.length ? `<span class="histtag">${e.riders.join(" + ")}</span>` : ""}
    </div>`;
  }

  return `${strip}${rows}`;
}

function injectHistoryStyles() {
  if (document.getElementById("history-css")) return;
  const s = document.createElement("style"); s.id = "history-css";
  s.textContent = `
    .hist-strip{background:var(--surface);border-radius:12px;padding:12px 14px;margin-bottom:14px}
    .hist-hero{font-size:15px;color:var(--text);display:flex;align-items:baseline;justify-content:space-between;gap:8px}
    .hist-hero b{font-size:22px;font-weight:700;color:var(--accent)}
    .hist-year{font-size:12px;color:var(--muted)}
    .hist-line{font-size:13px;color:var(--muted);margin-top:6px}
    .hist-streak{color:var(--accent);font-weight:600}
    .hist-yr{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:14px 2px 6px}
    .histrow{display:flex;align-items:center;gap:10px;background:var(--surface);border-radius:10px;padding:10px 12px;font-size:14px;margin-bottom:6px}
    .histwhen{color:var(--muted);white-space:nowrap;min-width:84px}
    .histtype{color:var(--text);font-weight:600;flex:1}
    .histtag{background:var(--chip-bg);border:1px solid var(--chip-border);color:var(--accent);font-size:11px;font-weight:600;padding:3px 9px;border-radius:7px;white-space:nowrap}`;
  document.head.appendChild(s);
}
