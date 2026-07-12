import { test } from "node:test";
import assert from "node:assert/strict";
import { pastSessions } from "../js/historyModel.js";

const me = { id: 9720, firstName: "David" };
const NOW = new Date("2026-07-15T12:00:00Z"); // Wed 15 Jul 2026 (BST); week Mon = 13 Jul

// A booking with only the fields the model reads.
function bk(startDate, { status = "confirmed", course = "2026 Wakeboard -Tech - Ride Session 30", riders = [{ id: 9720, firstName: "David" }] } = {}) {
  return {
    status,
    courseRun: { startDate, course: { name: course } },
    participants: riders.map(r => ({ status: "confirmed", contact: { id: r.id, firstName: r.firstName } })),
  };
}

test("past held only: excludes future, cancelled, pending, and zero-rider bookings", () => {
  const bookings = [
    bk("2026-07-05T15:00:00Z"),                          // past confirmed -> in
    bk("2026-08-01T15:00:00Z"),                          // future -> out
    bk("2026-07-01T15:00:00Z", { status: "cancelled" }), // out
    bk("2026-07-01T15:00:00Z", { status: "pending" }),   // out (confirmed only)
    { status: "confirmed", courseRun: { startDate: "2026-07-02T15:00:00Z", course: { name: "X" } },
      participants: [{ status: "cancelled", contact: { id: 9720, firstName: "David" } }] }, // 0 active -> out
  ];
  const { list, stats } = pastSessions(bookings, me, NOW);
  assert.equal(stats.total, 1);
  assert.equal(list.length, 1);
});

test("total and thisYear (London year)", () => {
  const { stats } = pastSessions([
    bk("2026-07-05T15:00:00Z"),
    bk("2026-02-10T15:00:00Z"),
    bk("2025-08-10T15:00:00Z"),
  ], me, NOW);
  assert.equal(stats.total, 3);
  assert.equal(stats.thisYear, 2);
});

test("per-rider counts; a two-rider booking counts for both", () => {
  const { stats } = pastSessions([
    bk("2026-07-05T15:00:00Z", { riders: [{ id: 9720, firstName: "David" }] }),
    bk("2026-07-06T15:00:00Z", { riders: [{ id: 48114, firstName: "Hamish" }] }),
    bk("2026-07-07T15:00:00Z", { riders: [{ id: 9720, firstName: "David" }, { id: 48114, firstName: "Hamish" }] }),
  ], me, NOW);
  const by = Object.fromEntries(stats.perRider.map(r => [r.name, r.count]));
  assert.equal(by["You"], 2);
  assert.equal(by["Hamish"], 2);
});

test("favType uses prettyCourse; favDay is the modal London weekday", () => {
  const { stats } = pastSessions([
    bk("2026-07-04T15:00:00Z", { course: "2026 Wakeboard -Tech - Ride Session 30" }), // Sat
    bk("2026-06-27T15:00:00Z", { course: "2026 Wakeboard -Tech - Ride Session 30" }), // Sat
    bk("2026-07-01T15:00:00Z", { course: "2026 Wakeboard -Air - Ride Session 30" }),  // Wed
  ], me, NOW);
  assert.equal(stats.favType, "Tech 30");
  assert.equal(stats.favDay, "Sat");
});

test("buckets by London date across the UTC day boundary (BST)", () => {
  // 23:30 UTC Sat 11 Jul = 00:30 Sun 12 Jul in London
  const { list } = pastSessions([bk("2026-07-11T23:30:00Z")], me, NOW);
  assert.equal(list[0].date, "2026-07-12");
});

test("list is newest-first", () => {
  const { list } = pastSessions([
    bk("2026-06-01T15:00:00Z"),
    bk("2026-07-05T15:00:00Z"),
    bk("2026-06-20T15:00:00Z"),
  ], me, NOW);
  assert.deepEqual(list.map(e => e.date), ["2026-07-05", "2026-06-20", "2026-06-01"]);
});

test("riders excludes you; tags others", () => {
  const { list } = pastSessions([
    bk("2026-07-05T15:00:00Z", { riders: [{ id: 9720, firstName: "David" }] }),
    bk("2026-07-06T15:00:00Z", { riders: [{ id: 48114, firstName: "Hamish" }] }),
  ], me, NOW);
  const by = Object.fromEntries(list.map(e => [e.date, e.riders]));
  assert.deepEqual(by["2026-07-05"], []);
  assert.deepEqual(by["2026-07-06"], ["Hamish"]);
});

test("streak: consecutive weeks, live when latest is last week (weekend rider mid-week)", () => {
  assert.equal(pastSessions([
    bk("2026-07-11T15:00:00Z"), // wk Mon 07-06 (last week rel. Wed 15th)
    bk("2026-07-05T15:00:00Z"), // wk Mon 06-29
    bk("2026-06-27T15:00:00Z"), // wk Mon 06-22
  ], me, NOW).stats.streak, 3);
});

test("streak: a one-week gap breaks it", () => {
  assert.equal(pastSessions([
    bk("2026-07-11T15:00:00Z"), // wk 07-06
    bk("2026-07-05T15:00:00Z"), // wk 06-29
    bk("2026-06-20T15:00:00Z"), // wk 06-15 (beyond the 06-22 gap)
  ], me, NOW).stats.streak, 2);
});

test("streak: stale (>1 week old) is not live -> 0", () => {
  assert.equal(pastSessions([bk("2026-06-28T15:00:00Z")], me, NOW).stats.streak, 0); // wk 06-22
});

test("streak: two rides in the same week count once", () => {
  assert.equal(pastSessions([
    bk("2026-07-11T15:00:00Z"), // wk 07-06
    bk("2026-07-12T15:00:00Z"), // wk 07-06 (same week)
    bk("2026-07-05T15:00:00Z"), // wk 06-29
  ], me, NOW).stats.streak, 2);
});

test("streak: a ride in the current week counts and is live", () => {
  assert.equal(pastSessions([bk("2026-07-14T10:00:00Z")], me, NOW).stats.streak, 1); // Tue 14th, current wk
});

test("empty input -> zeroed stats", () => {
  const { list, stats } = pastSessions([], me, NOW);
  assert.equal(list.length, 0);
  assert.equal(stats.total, 0);
  assert.equal(stats.thisYear, 0);
  assert.equal(stats.streak, 0);
  assert.deepEqual(stats.perRider, []);
  assert.equal(stats.favType, null);
  assert.equal(stats.favDay, null);
});
