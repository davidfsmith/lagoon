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

// GROUND TRUTH (verified 2026-06-20 against the live API + lagoon.co.uk).
// lagoon.co.uk/course/wakeboarding/ride-the-cables advertises the Wednesday
// "Jam Sessions" as 6pm & 7pm UK local. The public API returns those same
// Wednesday runs (course 478) stamped 17:00 and 18:00 "+00:00" — proving the
// API offset is TRUE UTC and London is +1h in summer, NOT already-local time.
// If this fails, either our conversion broke or the API changed its convention:
// re-run `python3 verify_data.py` (see docs/data-accuracy.md) before "fixing" it.
test("jam-session ground truth: advertised 6pm/7pm = API 17:00/18:00 UTC (summer)", () => {
  assert.equal(londonParts("2026-06-24T17:00:00+00:00").time, "18:00"); // advertised 6pm
  assert.equal(londonParts("2026-06-24T18:00:00+00:00").time, "19:00"); // advertised 7pm
});
