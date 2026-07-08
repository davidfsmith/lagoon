import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtWhen, agoText, fmtDateLong, windDirLabel } from "../js/views/format.js";

const now = new Date("2026-06-20T14:30:00").getTime();

test("fmtWhen: just now / minutes / today / older", () => {
  assert.equal(fmtWhen(0), "never");
  assert.equal(fmtWhen(null), "never");
  assert.equal(fmtWhen(now - 30 * 1000, now), "just now");      // <1 min
  assert.equal(fmtWhen(now - 1 * 60000, now), "1 min ago");     // singular
  assert.equal(fmtWhen(now - 5 * 60000, now), "5 mins ago");    // plural
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
  assert.equal(agoText(now - 125 * 1000, now), "2 mins ago");
  assert.equal(agoText(0, now), "never");
  assert.equal(agoText(null, now), "never");
});

test("fmtDateLong: full date with year and ordinal day, no weekday", () => {
  assert.equal(fmtDateLong("2027-07-06"), "6th July 2027");
  assert.equal(fmtDateLong("2027-07-01"), "1st July 2027");
  assert.equal(fmtDateLong("2027-07-02"), "2nd July 2027");
  assert.equal(fmtDateLong("2027-07-03"), "3rd July 2027");
  assert.equal(fmtDateLong("2027-07-11"), "11th July 2027"); // 11/12/13 -> th
  assert.equal(fmtDateLong("2027-07-21"), "21st July 2027");
  assert.equal(fmtDateLong("2027-12-31"), "31st December 2027");
});

test("windDirLabel: degrees -> 8-point compass, '' when unknown", () => {
  assert.equal(windDirLabel(0), "N");
  assert.equal(windDirLabel(45), "NE");
  assert.equal(windDirLabel(180), "S");
  assert.equal(windDirLabel(225), "SW");
  assert.equal(windDirLabel(350), "N");   // wraps back to N
  assert.equal(windDirLabel(null), "");
  assert.equal(windDirLabel(undefined), "");
});
