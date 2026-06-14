import { test } from "node:test";
import assert from "node:assert/strict";
import { londonParts } from "../js/tz.js";

test("londonParts converts UTC to BST (+1h) in summer", () => {
  const p = londonParts("2026-06-16T17:30:00+00:00");
  assert.equal(p.time, "18:30");
  assert.equal(p.hourKey, "2026-06-16T18");
  assert.equal(p.date, "2026-06-16");
});

test("londonParts is GMT (+0) in winter", () => {
  const p = londonParts("2026-01-16T17:30:00+00:00");
  assert.equal(p.time, "17:30");
  assert.equal(p.hourKey, "2026-01-16T17");
});

test("londonParts keeps the same calendar date for daytime sessions", () => {
  // 15:30 UTC = 16:30 BST, still the 21st
  assert.equal(londonParts("2026-06-21T15:30:00+00:00").date, "2026-06-21");
  assert.equal(londonParts("2026-06-21T15:30:00+00:00").time, "16:30");
});
