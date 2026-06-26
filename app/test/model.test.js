import { test } from "node:test";
import assert from "node:assert/strict";
import { runsToSlots, slotKey, bookingKeys, activeParticipants, bookingIsHeld, countsTowardLimit, markBooked, membershipFreeCourseIds, applyMembershipFree, groupByDay, justOpenedKeys, sessionsInWindow } from "../js/model.js";

test("countsTowardLimit excludes equipment add-ons (board store), counts real sessions", () => {
  const session = { courseRun: { course: { name: "2026 Wakeboard -Tech - Ride Session 30" } } };
  const store = { courseRun: { course: { name: "Wakeboard Board Store" } } };
  assert.equal(countsTowardLimit(session), true);
  assert.equal(countsTowardLimit(store), false);
});

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

test("justOpenedKeys flags newly-present and free-risen slots, ignores unchanged/dropped", () => {
  const prev = [{ slots: [
    { key: "a", free: 1 }, // unchanged
    { key: "b", free: 2 }, // will drop
    { key: "c", free: 1 }, // will rise
  ] }];
  const cur = [{ slots: [
    { key: "a", free: 1 }, // unchanged -> not flagged
    { key: "b", free: 1 }, // dropped   -> not flagged
    { key: "c", free: 2 }, // rose      -> flagged
    { key: "d", free: 1 }, // new        -> flagged (was full/absent)
  ] }];
  assert.deepEqual([...justOpenedKeys(prev, cur)].sort(), ["c", "d"]);
});

test("justOpenedKeys returns empty when there is no previous snapshot", () => {
  const cur = [{ slots: [{ key: "a", free: 1 }] }];
  assert.equal(justOpenedKeys(null, cur).size, 0);
});

test("justOpenedKeys returns empty for identical agendas", () => {
  const a = [{ slots: [{ key: "a", free: 1 }, { key: "b", free: 3 }] }];
  assert.equal(justOpenedKeys(a, a).size, 0);
});

// Helper to build a one-slot day list keyed by start time.
const slot = (start, extra = {}) => ({ start, key: start, free: 1, label: "Air 30", ...extra });
const agendaOf = (...starts) => [{ slots: starts.map(s => slot(s)) }];

test("sessionsInWindow 'today' keeps same-London-date future slots only", () => {
  const now = new Date("2026-06-25T09:00:00+00:00"); // Thu 10:00 BST -> London 2026-06-25
  const agenda = agendaOf(
    "2026-06-25T08:00:00+00:00", // already started -> excluded
    "2026-06-25T16:00:00+00:00", // today, future   -> included
    "2026-06-25T23:30:00+00:00", // 00:30 BST next day -> London 2026-06-26 -> excluded
    "2026-06-26T16:00:00+00:00", // tomorrow         -> excluded
  );
  const out = sessionsInWindow(agenda, "today", now);
  assert.deepEqual(out.map(s => s.start), ["2026-06-25T16:00:00+00:00"]);
});

test("sessionsInWindow '48h' includes slots within 48h, excludes beyond", () => {
  const now = new Date("2026-06-25T09:00:00+00:00"); // +48h = 2026-06-27T09:00Z
  const agenda = agendaOf(
    "2026-06-26T16:00:00+00:00", // within 48h -> included
    "2026-06-27T08:59:00+00:00", // just within -> included
    "2026-06-27T11:00:00+00:00", // beyond 48h  -> excluded
  );
  const out = sessionsInWindow(agenda, "48h", now);
  assert.deepEqual(out.map(s => s.start),
    ["2026-06-26T16:00:00+00:00", "2026-06-27T08:59:00+00:00"]);
});

test("sessionsInWindow 'weekend' from a weekday = the coming Sat+Sun only", () => {
  const now = new Date("2026-06-25T09:00:00+00:00"); // Thursday
  const agenda = agendaOf(
    "2026-06-26T16:00:00+00:00", // Fri        -> excluded
    "2026-06-27T11:00:00+00:00", // Sat        -> included
    "2026-06-28T11:00:00+00:00", // Sun        -> included
    "2026-07-04T11:00:00+00:00", // next Sat   -> excluded
  );
  const out = sessionsInWindow(agenda, "weekend", now);
  assert.deepEqual(out.map(s => s.start),
    ["2026-06-27T11:00:00+00:00", "2026-06-28T11:00:00+00:00"]);
});

test("sessionsInWindow 'weekend' from a Saturday keeps the rest of this weekend", () => {
  const now = new Date("2026-06-27T08:00:00+00:00"); // Sat 09:00 BST
  const agenda = agendaOf(
    "2026-06-27T07:00:00+00:00", // earlier Sat -> already started -> excluded
    "2026-06-27T14:00:00+00:00", // Sat future  -> included
    "2026-06-28T11:00:00+00:00", // Sun         -> included
    "2026-07-04T11:00:00+00:00", // next Sat    -> excluded
  );
  const out = sessionsInWindow(agenda, "weekend", now);
  assert.deepEqual(out.map(s => s.start),
    ["2026-06-27T14:00:00+00:00", "2026-06-28T11:00:00+00:00"]);
});

test("sessionsInWindow sorts soonest-first and drops full slots", () => {
  const now = new Date("2026-06-25T09:00:00+00:00");
  const agenda = [{ slots: [
    slot("2026-06-25T18:00:00+00:00"),
    slot("2026-06-25T16:00:00+00:00"),
    slot("2026-06-25T17:00:00+00:00", { free: 0 }), // full -> excluded
  ] }];
  const out = sessionsInWindow(agenda, "today", now);
  assert.deepEqual(out.map(s => s.start),
    ["2026-06-25T16:00:00+00:00", "2026-06-25T18:00:00+00:00"]);
});
