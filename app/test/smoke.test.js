import { test } from "node:test";
import assert from "node:assert/strict";
import { COURSES, FILTER_GROUPS } from "../js/config.js";

test("config exposes core + extra courses", () => {
  const core = COURSES.filter(c => !c.extra);
  const extra = COURSES.filter(c => c.extra);
  // Core (selected by default) are the two 30-min ride sessions, Air before Tech.
  assert.deepEqual(core.map(c => c.id), [51, 50]);
  // Extras (hidden until filtered): 15-min solo sessions, Taster, Jam, Drop-in.
  assert.deepEqual(extra.map(c => c.id), [713, 714, 9, 478, 586]);
  // Every course has a non-empty label and a known filter-row group.
  for (const c of COURSES) {
    assert.ok(c.label && c.label.length);
    assert.ok(FILTER_GROUPS.includes(c.group), `${c.label} has a valid group`);
  }
});

test("filter row 1 is the four ride sessions, row 2 the rest", () => {
  const row = (g) => COURSES.filter(c => c.group === g).map(c => c.label);
  assert.deepEqual(row("ride"), ["Air 30", "Tech 30", "Air 15", "Tech 15"]);
  assert.deepEqual(row("other"), ["Taster", "Jam", "Drop-in"]);
});
