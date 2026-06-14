import { test } from "node:test";
import assert from "node:assert/strict";
import { runsToSlots, slotKey, bookingKeys, markBooked, membershipFreeCourseIds, applyMembershipFree } from "../js/model.js";

const now = new Date("2026-06-14T12:00:00+00:00");

test("runsToSlots keeps upcoming runs with free space inside horizon", () => {
  const runs = [
    { startDate: "2026-06-10T15:00:00+00:00", endDate: "2026-06-10T15:30:00+00:00", maxNumbers: 2, participantsCount: 0 }, // past
    { startDate: "2026-06-14T15:30:00+00:00", endDate: "2026-06-14T16:00:00+00:00", maxNumbers: 2, participantsCount: 1 }, // free 1
    { startDate: "2026-06-15T17:00:00+00:00", endDate: "2026-06-15T17:30:00+00:00", maxNumbers: 2, participantsCount: 2 }, // full
    { startDate: "2026-09-01T10:00:00+00:00", endDate: "2026-09-01T10:30:00+00:00", maxNumbers: 2, participantsCount: 0 }, // beyond horizon
  ];
  const slots = runsToSlots(runs, 50, "Tech 30", now, 21);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].key, slotKey(50, "2026-06-14T15:30:00+00:00"));
  assert.equal(slots[0].free, 1);
  assert.equal(slots[0].capacity, 2);
  assert.equal(slots[0].label, "Tech 30");
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
