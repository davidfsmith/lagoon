// Shared per-type session filter, used by both the agenda and the day view so they
// always show the same selection. One toggle chip per session type; core types
// (30-min ride sessions) are on by default, `extra` types are off until tapped.
// Selection persists in localStorage under one key, so it's consistent everywhere.
import { activeCourses } from "./features.js";
import { getDiscipline } from "./store.js";

// Selection persists PER DISCIPLINE, so wake and SUP chip selections don't clobber each
// other (switching discipline swaps the whole course set). Labels/groups come from the
// ACTIVE discipline's courses, computed at call-time (not module load) so the discipline
// switch applies live.
// Wake keeps the legacy key (so existing users' selections survive the SUP change);
// SUP gets its own so the two disciplines don't clobber each other.
const typesKey = () => getDiscipline() === "sup" ? "lagoon.types.sup" : "lagoon.types";
const allLabels = () => activeCourses().map(c => c.label);
const defaultLabels = () => activeCourses().filter(c => !c.extra).map(c => c.label);

// Labels present in a list of slots, returned in config (chip) order.
export function presentTypes(slots) {
  const set = new Set((slots || []).map(s => s.label));
  return allLabels().filter(l => set.has(l));
}

// The set of currently-active type labels, limited to those present in the data.
export function getActiveTypes(present) {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(typesKey()) || "null"); } catch { stored = null; }
  const base = Array.isArray(stored) ? stored.filter(l => allLabels().includes(l)) : defaultLabels();
  const active = new Set(base.filter(l => present.includes(l)));
  if (!active.size && !Array.isArray(stored)) {            // first run → core defaults
    for (const l of defaultLabels()) if (present.includes(l)) active.add(l);
  }
  return active;
}

const setActiveTypes = (set) => localStorage.setItem(typesKey(), JSON.stringify([...set]));

// Two-row chip bar HTML: "ride" sessions on row 1, "other" on row 2. Empty when
// there's only one (or no) type present — nothing to filter.
// Show a chip for EVERY configured type so riders always see the full set the app tracks;
// a type with no sessions in the loaded (21-day) agenda renders disabled ("supported, none
// available now") rather than vanishing — so it's clear the app *does* offer it.
export function filterBarHtml(present, active) {
  const chip = (l) => {
    const avail = present.includes(l);
    return `<button class="filterbtn${active.has(l) ? " active" : ""}" data-type="${l}"${avail ? "" : " disabled"}>${l}</button>`;
  };
  const courses = activeCourses();
  const groups = [...new Set(courses.map(c => c.group))]; // ride/other for wake, paddle for SUP
  const rows = groups.map(g => {
    const labels = courses.filter(c => c.group === g).map(c => c.label);
    return labels.length ? `<div class="filterbar">${labels.map(chip).join("")}</div>` : "";
  }).join("");
  return `<div class="filters">${rows}</div>`;
}

// Wire chip clicks within `view`: toggle the type, persist, then call rerender().
export function wireFilterChips(view, active, rerender) {
  for (const btn of view.querySelectorAll(".filterbtn")) {
    btn.addEventListener("click", () => {
      const l = btn.dataset.type;
      if (active.has(l)) active.delete(l); else active.add(l);
      setActiveTypes(active);
      rerender();
    });
  }
}

export function injectFilterStyles() {
  if (document.getElementById("filter-css")) return;
  const s = document.createElement("style"); s.id = "filter-css";
  s.textContent = `
    .filters{margin-bottom:12px}
    .filterbar{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px}
    .filterbar:last-child{margin-bottom:0}
    .filterbtn{background:var(--surface);border:1px solid var(--border);color:var(--muted);border-radius:18px;padding:5px 15px;font-size:13px;cursor:pointer}
    .filterbtn.active{background:var(--accent);color:var(--accent-ink);border-color:var(--accent);font-weight:600}
    .filterbtn:disabled{opacity:.4;cursor:default}`;
  document.head.appendChild(s);
}
