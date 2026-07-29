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
const { setInternalOptIn, setBetaOptIn, setDiscipline } = await import("../js/store.js");
const { COURSES, SUP_COURSES, FEATURES } = await import("../js/config.js");

test("supBooking flag is beta (public opt-in)", () => {
  assert.equal(FEATURES.supBooking, "beta");
});

test("activeCourses: beta opt-in (not internal) enables SUP", () => {
  mem.clear();
  setBetaOptIn(true);                         // public beta toggle, no dev opt-in
  setDiscipline("sup");
  assert.equal(activeCourses(), SUP_COURSES);
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

test("isSupCourse: SUP ids yes, wake ids no", () => {
  assert.equal(isSupCourse(73), true);   // SUP Yoga
  assert.equal(isSupCourse(51), false);  // Air 30 (wake)
  assert.equal(isSupCourse(undefined), false);
});

test("inActiveDiscipline: flag off → everything shows (no filtering)", () => {
  mem.clear(); // no opt-in
  assert.equal(inActiveDiscipline(51), true);  // wake
  assert.equal(inActiveDiscipline(73), true);  // SUP booked on the website still shows
});

test("inActiveDiscipline: flag on → filters to the active discipline", () => {
  mem.clear();
  setInternalOptIn(true);
  setDiscipline("wake");
  assert.equal(inActiveDiscipline(51), true);   // wake shows wake
  assert.equal(inActiveDiscipline(73), false);  // wake hides SUP
  setDiscipline("sup");
  assert.equal(inActiveDiscipline(73), true);   // SUP shows SUP
  assert.equal(inActiveDiscipline(51), false);  // SUP hides wake
});
