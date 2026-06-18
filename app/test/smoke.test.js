import { test } from "node:test";
import assert from "node:assert/strict";
import { COURSES } from "../js/config.js";

test("config exposes monitored courses", () => {
  assert.equal(COURSES.length, 2);
  assert.deepEqual(COURSES.map(c => c.id), [50, 51]);
});
