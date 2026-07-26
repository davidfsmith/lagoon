import { test } from "node:test";
import assert from "node:assert/strict";

// node has no localStorage — back it with a Map (same pattern as features.test.js).
const mem = new Map();
global.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { activeCourses } = await import("../js/features.js");
const { setInternalOptIn, setDiscipline } = await import("../js/store.js");
const { COURSES, SUP_COURSES, FEATURES } = await import("../js/config.js");

test("supBooking flag is internal (dev-only)", () => {
  assert.equal(FEATURES.supBooking, "internal");
});

test("SUP_COURSES: 6 live types, all group 'paddle', all default-on", () => {
  assert.deepEqual(SUP_COURSES.map(c => c.id), [37, 38, 71, 72, 73, 415]);
  for (const c of SUP_COURSES) {
    assert.ok(c.label && c.label.length);
    assert.equal(c.group, "paddle");
    assert.ok(!c.extra, `${c.label} is default-on`);
  }
});

test("activeCourses: flag off → always wake, whatever the discipline", () => {
  mem.clear();
  setDiscipline("sup");                       // even asking for SUP...
  assert.equal(activeCourses(), COURSES);     // ...flag off → wake
});

test("activeCourses: flag on → follows the discipline", () => {
  mem.clear();
  setInternalOptIn(true);
  setDiscipline("wake");
  assert.equal(activeCourses(), COURSES);
  setDiscipline("sup");
  assert.equal(activeCourses(), SUP_COURSES);
});
