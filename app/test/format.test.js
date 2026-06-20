import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtWhen } from "../js/views/format.js";

const now = new Date("2026-06-20T14:30:00").getTime();

test("fmtWhen: just now / minutes / today / older", () => {
  assert.equal(fmtWhen(0), "never");
  assert.equal(fmtWhen(null), "never");
  assert.equal(fmtWhen(now - 30 * 1000, now), "just now");      // <1 min
  assert.equal(fmtWhen(now - 5 * 60000, now), "5 min ago");     // minutes
  assert.equal(fmtWhen(now - 90 * 60000, now), "today at 13:00"); // same day, >1h
  const older = fmtWhen(now - 26 * 3600 * 1000, now);            // previous day
  assert.match(older, /^\w{3} \d{1,2} \w{3}, \d{2}:\d{2}$/);     // "Thu 19 Jun, 12:30"
});
