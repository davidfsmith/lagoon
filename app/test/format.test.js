import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtWhen, agoText } from "../js/views/format.js";

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

test("agoText: 'just now' under 10s, then 10s steps within the first minute", () => {
  assert.equal(agoText(now, now), "just now");
  assert.equal(agoText(now - 9 * 1000, now), "just now");
  assert.equal(agoText(now - 10 * 1000, now), "10s ago");
  assert.equal(agoText(now - 25 * 1000, now), "20s ago");
  assert.equal(agoText(now - 59 * 1000, now), "50s ago");
});

test("agoText: rolls into minutes after a minute, and handles missing ts", () => {
  assert.equal(agoText(now - 60 * 1000, now), "1 min ago");
  assert.equal(agoText(now - 125 * 1000, now), "2 min ago");
  assert.equal(agoText(0, now), "never");
  assert.equal(agoText(null, now), "never");
});
