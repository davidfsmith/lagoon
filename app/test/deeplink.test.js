import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDayHash } from "../js/deeplink.js";

test("parseDayHash extracts date + decoded key", () => {
  const key = "50@2026-07-11T17:00:00+00:00";
  const hash = "#day/2026-07-11/" + encodeURIComponent(key);
  assert.deepEqual(parseDayHash(hash), { date: "2026-07-11", key });
});

test("parseDayHash returns null for non-day hashes", () => {
  assert.equal(parseDayHash("#lastminute"), null);
  assert.equal(parseDayHash(""), null);
  assert.equal(parseDayHash(undefined), null);
});
