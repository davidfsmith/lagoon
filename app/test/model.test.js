import { test } from "node:test";
import assert from "node:assert/strict";
import { runsToSlots, slotKey, bookingKeys, activeParticipants, bookingIsHeld, markBooked, membershipFreeCourseIds, applyMembershipFree, groupByDay } from "../js/model.js";

const now = new Date("2026-06-14T12:00:00+00:00");

test("runsToSlots keeps upcoming runs with free space inside horizon", () => {
  const runs = [
    { startDate: "2026-06-10T15:00:00+00:00", endDate: "2026-06-10T15:30:00+00:00", maxNumbers: 2, participantsCount: 0 }, // past
    { id: 98612, startDate: "2026-06-14T15:30:00+00:00", endDate: "2026-06-14T16:00:00+00:00", maxNumbers: 2, participantsCount: 1 }, // free 1
    { startDate: "2026-06-15T17:00:00+00:00", endDate: "2026-06-15T17:30:00+00:00", maxNumbers: 2, participantsCount: 2 }, // full
    { startDate: "2026-09-01T10:00:00+00:00", endDate: "2026-09-01T10:30:00+00:00", maxNumbers: 2, participantsCount: 0 }, // beyond horizon
  ];
  const slots = runsToSlots(runs, 50, "Tech 30", now, 21);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].key, slotKey(50, "2026-06-14T15:30:00+00:00"));
  assert.equal(slots[0].free, 1);
  assert.equal(slots[0].capacity, 2);
  assert.equal(slots[0].label, "Tech 30");
  assert.equal(slots[0].runId, 98612);
  assert.equal(slots[0].booked, false);
});

test("bookingKeys extracts active booking keys, skipping cancelled", () => {
  const meBookings = [
    { status: "confirmed", courseRun: { course: { id: 50 }, startDate: "2026-06-21T15:30:00+00:00" } },
    { status: "cancelled", courseRun: { course: { id: 51 }, startDate: "2026-06-22T15:30:00+00:00" } },
  ];
  const keys = bookingKeys(meBookings);
  assert.ok(keys.has("50@2026-06-21T15:30:00+00:00"));
  assert.equal(keys.has("51@2026-06-22T15:30:00+00:00"), false);
});

test("a confirmed booking cancelled down to no active riders is not held", () => {
  // single-participant booking, participant's place cancelled -> empty list
  const emptied = { status: "confirmed", participants: [],
    courseRun: { course: { id: 50 }, startDate: "2026-06-23T17:00:00+00:00" } };
  // ...or the participant is kept but marked cancelled
  const markedCancelled = { status: "confirmed", participants: [{ id: 1, status: "cancelled" }],
    courseRun: { course: { id: 50 }, startDate: "2026-06-23T17:00:00+00:00" } };
  assert.equal(bookingIsHeld(emptied), false);
  assert.equal(bookingIsHeld(markedCancelled), false);
  // a real held booking still counts; bookingKeys excludes the cancelled one
  const held = { status: "confirmed", participants: [{ id: 2, status: "confirmed" }],
    courseRun: { course: { id: 51 }, startDate: "2026-06-23T16:30:00+00:00" } };
  assert.equal(bookingIsHeld(held), true);
  const keys = bookingKeys([emptied, markedCancelled, held]);
  assert.equal(keys.has("50@2026-06-23T17:00:00+00:00"), false);
  assert.ok(keys.has("51@2026-06-23T16:30:00+00:00"));
});

test("activeParticipants drops cancelled/expired riders, keeps status-less ones", () => {
  const b = { participants: [
    { id: 1, status: "confirmed" }, { id: 2, status: "cancelled" },
    { id: 3, status: "expired" }, { id: 4 }, // no status -> treated active
  ] };
  assert.deepEqual(activeParticipants(b).map(p => p.id), [1, 4]);
});

test("markBooked flags slots whose key is in the booking set", () => {
  const slots = [
    { key: "50@2026-06-21T15:30:00+00:00", booked: false },
    { key: "51@2026-06-22T15:30:00+00:00", booked: false },
  ];
  markBooked(slots, new Set(["50@2026-06-21T15:30:00+00:00"]));
  assert.equal(slots[0].booked, true);
  assert.equal(slots[1].booked, false);
});

test("membershipFreeCourseIds collects freeCourses ids from active memberships", () => {
  const meMemberships = [
    { status: "active", membershipType: { freeCourses: [{ id: 50 }, { id: 51 }, { id: 66 }] } },
    { status: "expired", membershipType: { freeCourses: [{ id: 99 }] } },
  ];
  const ids = membershipFreeCourseIds(meMemberships);
  assert.ok(ids.has(50) && ids.has(51));
  assert.equal(ids.has(99), false);
});

test("applyMembershipFree flags slots whose course is free", () => {
  const slots = [{ courseId: 50, freeWithMembership: false }, { courseId: 99, freeWithMembership: false }];
  applyMembershipFree(slots, new Set([50]));
  assert.equal(slots[0].freeWithMembership, true);
  assert.equal(slots[1].freeWithMembership, false);
});

test("groupByDay groups slots by date, sorts, flags weekends, attaches summary", () => {
  const slots = [
    { start: "2026-06-21T15:30:00+00:00", key: "a" }, // Sunday
    { start: "2026-06-20T13:00:00+00:00", key: "b" }, // Saturday
    { start: "2026-06-20T11:00:00+00:00", key: "c" }, // Saturday earlier
  ];
  const daily = { "2026-06-20": { tMax: 20 } };
  const days = groupByDay(slots, daily);
  assert.deepEqual(days.map(d => d.date), ["2026-06-20", "2026-06-21"]);
  assert.equal(days[0].weekend, true);
  assert.deepEqual(days[0].slots.map(s => s.key), ["c", "b"]); // sorted by time
  assert.deepEqual(days[0].summary, { tMax: 20 });
  assert.equal(days[1].summary, null);
});
