import { test } from "node:test";
import assert from "node:assert/strict";
import { remainingHold } from "../js/splash.js";

test("remainingHold returns time left in the minimum-visible window, clamped at 0", () => {
  assert.equal(remainingHold(1000, 1000, 600), 600);   // just booted → full hold
  assert.equal(remainingHold(1000, 1400, 600), 200);   // 400ms elapsed → 200 left
  assert.equal(remainingHold(1000, 1600, 600), 0);     // exactly met
  assert.equal(remainingHold(1000, 5000, 600), 0);     // long past → no wait (never negative)
});
