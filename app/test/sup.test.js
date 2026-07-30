import { test } from "node:test";
import assert from "node:assert/strict";

// node has no localStorage — back it with a Map (same pattern as features.test.js).
const mem = new Map();
global.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { activeCourses, isSupCourse, inActiveDiscipline } = await import("../js/features.js");
const { setDiscipline } = await import("../js/store.js");
const { COURSES, SUP_COURSES } = await import("../js/config.js");

test("SUP_COURSES: 6 live types, all group 'paddle', all default-on", () => {
  assert.deepEqual(SUP_COURSES.map(c => c.id), [37, 38, 71, 72, 73, 415]);
  for (const c of SUP_COURSES) {
    assert.ok(c.label && c.label.length);
    assert.equal(c.group, "paddle");
    assert.ok(!c.extra, `${c.label} is default-on`);
  }
});

// GA: SUP is on for everyone (no opt-in), so the course set just follows the discipline.
test("activeCourses: follows the discipline with no opt-in", () => {
  mem.clear();
  setDiscipline("wake");
  assert.equal(activeCourses(), COURSES);
  setDiscipline("sup");
  assert.equal(activeCourses(), SUP_COURSES);
});

test("isSupCourse: SUP ids yes, wake ids no", () => {
  assert.equal(isSupCourse(73), true);   // SUP Yoga
  assert.equal(isSupCourse(51), false);  // Air 30 (wake)
  assert.equal(isSupCourse(undefined), false);
});

// GA: Bookings/History filter to the active discipline for everyone (no opt-in).
test("inActiveDiscipline: filters to the active discipline", () => {
  mem.clear();
  setDiscipline("wake");
  assert.equal(inActiveDiscipline(51), true);   // wake shows wake
  assert.equal(inActiveDiscipline(73), false);  // wake hides SUP
  setDiscipline("sup");
  assert.equal(inActiveDiscipline(73), true);   // SUP shows SUP
  assert.equal(inActiveDiscipline(51), false);  // SUP hides wake
});
