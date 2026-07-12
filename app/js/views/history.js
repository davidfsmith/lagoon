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

  // Group into years (list is newest-first, so years descend naturally), then render each
  // as a collapsible <details> banner. Most recent year open, older years collapsed.
  const years = [];
  for (const e of list) {
    let g = years[years.length - 1];
    if (!g || g.year !== e.year) { g = { year: e.year, rows: [] }; years.push(g); }
    g.rows.push(e);
  }
  const rowHtml = (e) => `<div class="histrow">
      <span class="histwhen">${fmtDate(e.date)}</span>
      <span class="histtype">${e.typeLabel}</span>
      ${e.riders.length ? `<span class="histtag">${e.riders.join(" + ")}</span>` : ""}
    </div>`;
  const groups = years.map((g, i) => `<details class="hist-yr-group"${i === 0 ? " open" : ""}>
    <summary class="hist-yr-banner">
      <span class="hist-chev">›</span>
      <span class="hist-yr-label">${g.year}</span>
      <span class="hist-yr-count">${g.rows.length} ride${g.rows.length === 1 ? "" : "s"}</span>
    </summary>
    ${g.rows.map(rowHtml).join("")}
  </details>`).join("");

  return `${strip}${groups}`;
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
    .hist-yr-group{margin-bottom:8px}
    .hist-yr-banner{display:flex;align-items:center;gap:10px;background:var(--surface);border-radius:10px;
      padding:12px;font-size:14px;cursor:pointer;list-style:none;user-select:none}
    .hist-yr-banner::-webkit-details-marker{display:none}
    .hist-yr-label{font-weight:600;color:var(--text)}
    .hist-yr-count{color:var(--muted);font-size:12px;margin-left:auto}
    .hist-chev{color:var(--muted);font-size:16px;line-height:1;transition:transform .15s;display:inline-block}
    .hist-yr-group[open] .hist-chev{transform:rotate(90deg)}
    .hist-yr-group > .histrow:first-of-type{margin-top:6px}
    .histrow{display:flex;align-items:center;gap:10px;background:var(--surface);border-radius:10px;padding:10px 12px;font-size:14px;margin-bottom:6px}
    .histwhen{color:var(--muted);white-space:nowrap;min-width:84px}
    .histtype{color:var(--text);font-weight:600;flex:1}
    .histtag{background:var(--chip-bg);border:1px solid var(--chip-border);color:var(--accent);font-size:11px;font-weight:600;padding:3px 9px;border-radius:7px;white-space:nowrap}`;
  document.head.appendChild(s);
}
