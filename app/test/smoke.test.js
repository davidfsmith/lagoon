import { test } from "node:test";
import assert from "node:assert/strict";
import { COURSES } from "../js/config.js";

test("config exposes core + extra courses", () => {
  const core = COURSES.filter(c => !c.extra);
  const extra = COURSES.filter(c => c.extra);
  // Core (shown by default) are the two 30-min ride sessions.
  assert.deepEqual(core.map(c => c.id), [50, 51]);
  // Extras (hidden until filtered) are Taster, Jam, Drop-in.
  assert.deepEqual(extra.map(c => c.id), [9, 478, 586]);
  // Every course has a non-empty label for the filter chip.
  for (const c of COURSES) assert.ok(c.label && c.label.length);
});
