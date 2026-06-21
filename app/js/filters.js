// Shared per-type session filter, used by both the agenda and the day view so they
// always show the same selection. One toggle chip per session type; core types
// (30-min ride sessions) are on by default, `extra` types are off until tapped.
// Selection persists in localStorage under one key, so it's consistent everywhere.
import { COURSES, FILTER_GROUPS } from "./config.js";

const TYPES_KEY = "lagoon.types";
const ALL_LABELS = COURSES.map(c => c.label);
const DEFAULT_LABELS = COURSES.filter(c => !c.extra).map(c => c.label);

// Labels present in a list of slots, returned in config (chip) order.
export function presentTypes(slots) {
  const set = new Set((slots || []).map(s => s.label));
  return ALL_LABELS.filter(l => set.has(l));
}

// The set of currently-active type labels, limited to those present in the data.
export function getActiveTypes(present) {
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

// Two-row chip bar HTML: "ride" sessions on row 1, "other" on row 2. Empty when
// there's only one (or no) type present — nothing to filter.
export function filterBarHtml(present, active) {
  const chip = (l) => `<button class="filterbtn${active.has(l) ? " active" : ""}" data-type="${l}">${l}</button>`;
  const rows = FILTER_GROUPS.map(g => {
    const labels = COURSES.filter(c => c.group === g && present.includes(c.label)).map(c => c.label);
    return labels.length ? `<div class="filterbar">${labels.map(chip).join("")}</div>` : "";
  }).join("");
  return present.length > 1 ? `<div class="filters">${rows}</div>` : "";
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
    .filterbtn.active{background:var(--accent);color:var(--accent-ink);border-color:var(--accent);font-weight:600}`;
  document.head.appendChild(s);
}
