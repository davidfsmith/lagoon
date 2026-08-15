import { test } from "node:test";
import assert from "node:assert/strict";
import { runsToSlots, slotKey, bookingKeys, activeParticipants, bookingIsHeld, countsTowardLimit, markBooked, membershipFreeCourseIds, applyMembershipFree, groupByDay, justOpenedKeys, sessionsInWindow, mergeBookings, pruneDefunctBookedSlots, coveringMembership, eligibleRidersFor, buildParticipants } from "../js/model.js";

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

test("sessionsInWindow 'tomorrow' keeps only next-London-day future slots", () => {
  const now = new Date("2026-06-25T09:00:00+00:00"); // Thu, London date 2026-06-25
  const agenda = agendaOf(
    "2026-06-25T16:00:00+00:00", // today                        -> excluded
    "2026-06-25T23:30:00+00:00", // 00:30 BST -> London 2026-06-26 (tomorrow) -> included
    "2026-06-26T16:00:00+00:00", // tomorrow                     -> included
    "2026-06-26T23:30:00+00:00", // 00:30 BST -> London 2026-06-27 -> excluded
    "2026-06-27T11:00:00+00:00", // day after tomorrow           -> excluded
  );
  const out = sessionsInWindow(agenda, "tomorrow", now);
  assert.deepEqual(out.map(s => s.start),
    ["2026-06-25T23:30:00+00:00", "2026-06-26T16:00:00+00:00"]);
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

test("slotKey matches the watcher's key format (courseId@startISO) — self-cancel suppression relies on this", () => {
  // The AWS watcher keys slots as f"{course_id}@{start.isoformat()}"; the API serialises
  // startDate with a +00:00 offset which Python's isoformat() reproduces byte-for-byte. If this
  // assertion ever fails (API format drift), self-cancel suppression silently no-ops.
  assert.equal(slotKey(50, "2026-07-15T15:30:00+00:00"), "50@2026-07-15T15:30:00+00:00");
});

// ---- mergeBookings ----
const mb = (slots, bookings, opts = {}) => mergeBookings(slots, bookings, {
  inDiscipline: () => true,                                  // wake-everything by default
  labelFor: (id, name) => ({ 50: "Tech 30", 51: "Air 30" }[id] || `pretty:${name}`),
  meId: 100, now: new Date("2026-06-14T12:00:00+00:00"), horizonDays: 21, ...opts,
});
const bk = (courseId, startDate, participants, extra = {}) => ({
  status: "confirmed", participants,
  courseRun: { id: 900 + courseId, startDate, endDate: startDate, course: { id: courseId, name: `Course ${courseId}` }, ...extra },
});
const rider = (id, firstName) => ({ id, status: "confirmed", contact: { id, firstName } });

test("mergeBookings annotates an existing free slot the roster is booked on", () => {
  const slots = [{ courseId: 50, label: "Tech 30", key: slotKey(50, "2026-06-20T13:00:00+00:00"), free: 2, booked: false }];
  const out = mb(slots, [bk(50, "2026-06-20T13:00:00+00:00", [rider(100, "Dave")])]);
  assert.equal(out.length, 1);
  assert.equal(out[0].booked, true);
  assert.deepEqual(out[0].riders, ["You"]);
});

test("mergeBookings synthesizes a free:0 row for a full/absent booked session", () => {
  const out = mb([], [bk(66, "2026-06-18T17:00:00+00:00", [rider(100, "Dave")])], { labelFor: () => "Clinic" });
  assert.equal(out.length, 1);
  assert.equal(out[0].free, 0);
  assert.equal(out[0].booked, true);
  assert.equal(out[0].label, "Clinic");
  assert.equal(out[0].key, slotKey(66, "2026-06-18T17:00:00+00:00"));
  assert.equal(out[0].capacity, null);
  assert.equal(out[0].weather, null);
  assert.equal(out[0].freeWithMembership, false);
});

test("mergeBookings skips malformed bookings (missing course id or startDate)", () => {
  const noCourse = { status: "confirmed", participants: [rider(100, "Dave")],
    courseRun: { id: 1, startDate: "2026-06-18T17:00:00+00:00", course: {} } };
  const noStart = { status: "confirmed", participants: [rider(100, "Dave")],
    courseRun: { id: 2, course: { id: 66, name: "Clinic" } } };
  assert.equal(mb([], [noCourse, noStart]).length, 0);
});

test("mergeBookings labels an untracked course via labelFor fallback", () => {
  const out = mb([], [bk(415, "2026-06-19T10:00:00+00:00", [rider(100, "Dave")])]);
  assert.equal(out[0].label, "pretty:Course 415");
});

test("mergeBookings excludes the wrong discipline", () => {
  const out = mb([], [bk(66, "2026-06-18T17:00:00+00:00", [rider(100, "Dave")])], { inDiscipline: (id) => id === 999 });
  assert.equal(out.length, 0);
});

test("mergeBookings excludes past and beyond-horizon bookings", () => {
  const past = bk(66, "2026-06-10T17:00:00+00:00", [rider(100, "Dave")]);
  const far = bk(66, "2026-09-01T17:00:00+00:00", [rider(100, "Dave")]);
  assert.equal(mb([], [past, far]).length, 0);
});

test("mergeBookings excludes non-held and board-store add-ons", () => {
  const cancelled = { status: "cancelled", courseRun: { course: { id: 66 }, startDate: "2026-06-18T17:00:00+00:00" } };
  const emptied = bk(66, "2026-06-18T17:00:00+00:00", []); // held check: participants present but empty -> not held
  const store = bk(50, "2026-06-18T17:00:00+00:00", [rider(100, "Dave")], { course: { id: 50, name: "Wakeboard Board Store" } });
  assert.equal(mb([], [cancelled, emptied, store]).length, 0);
});

test("mergeBookings merges riders across bookings, You first, de-duped", () => {
  const b1 = bk(66, "2026-06-18T17:00:00+00:00", [rider(200, "Hamish")]);
  const b2 = bk(66, "2026-06-18T17:00:00+00:00", [rider(100, "Dave"), rider(200, "Hamish")]);
  const out = mb([], [b1, b2]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].riders, ["You", "Hamish"]);
});

test("mergeBookings names other riders when You are not on the session", () => {
  const out = mb([], [bk(66, "2026-06-18T17:00:00+00:00", [rider(200, "Hamish"), rider(300, "Immy")])]);
  assert.deepEqual(out[0].riders, ["Hamish", "Immy"]);
});

test("sessionsInWindow includes booked-full rows in the window, still excludes past", () => {
  const t = (h) => `2026-06-14T${h}:00:00+00:00`;
  const agenda = [{ date: "2026-06-14", slots: [
    { key: "a", start: t("18"), free: 0, booked: true, label: "Clinic" }, // full, booked, future
    { key: "b", start: t("07"), free: 0, booked: true, label: "Jam" },    // booked but already passed
    { key: "c", start: t("19"), free: 2, booked: false, label: "Air 30" },
  ] }];
  const out = sessionsInWindow(agenda, "today", new Date("2026-06-14T12:00:00+00:00"));
  assert.deepEqual(out.map(s => s.key), ["a", "c"]);
});

test("justOpenedKeys ignores newly-present free:0 booked rows", () => {
  const prev = [{ slots: [{ key: "x", free: 1 }] }];
  const cur = [{ slots: [{ key: "x", free: 1 }, { key: "booked", free: 0 }] }];
  const out = justOpenedKeys(prev, cur);
  assert.equal(out.has("booked"), false);
});

test("pruneDefunctBookedSlots drops free:0 unbooked rows, keeps the rest", () => {
  const agenda = [{ date: "d", slots: [
    { key: "ghost", free: 0, booked: false },  // cancelled-to-empty synthetic row
    { key: "still", free: 0, booked: true },   // still booked
    { key: "free", free: 2, booked: false },   // real availability
  ] }];
  pruneDefunctBookedSlots(agenda);
  assert.deepEqual(agenda[0].slots.map(s => s.key), ["still", "free"]);
});

// ---- in-app booking eligibility ----
const membership = (id, memberIds, freeCourseIds) => ({
  id, status: "active",
  membershipType: { freeCourses: freeCourseIds.map(c => ({ id: c })) },
  members: memberIds.map(m => ({ id: m.id, firstName: m.name })),
});
const sessionFor = (courseId, start) => ({ courseId, start, key: slotKey(courseId, start) });

test("coveringMembership: true only when the course is in freeCourses", () => {
  const m = membership(1125, [{id:9720,name:"You"}], [51, 50]);
  assert.equal(coveringMembership(m, 51), true);
  assert.equal(coveringMembership(m, 66), false);
});

test("eligibleRidersFor: members covered for the course, not already booked, under cap", () => {
  const m = membership(1125, [{id:9720,name:"Dave"},{id:48114,name:"Hamish"}], [51]);
  const s = sessionFor(51, "2026-08-20T17:00:00+00:00");
  // Hamish already booked on this exact session
  const meBookings = [{ status:"confirmed",
    participants:[{ id:1, status:"confirmed", contact:{ id:48114 } }],
    courseRun:{ course:{ id:51 }, startDate:"2026-08-20T17:00:00+00:00" } }];
  const out = eligibleRidersFor(s, [m], meBookings, 9720, 4);
  assert.deepEqual(out.map(r=>r.contactId), [9720]);          // Hamish excluded (already on it)
  assert.equal(out[0].membershipId, 1125);
});

test("eligibleRidersFor: empty when the membership doesn't cover the course", () => {
  const m = membership(1125, [{id:9720,name:"Dave"}], [50]); // covers 50, not 51
  const s = sessionFor(51, "2026-08-20T17:00:00+00:00");
  assert.deepEqual(eligibleRidersFor(s, [m], [], 9720, 4), []);
});

test("eligibleRidersFor: excludes a rider at the per-rider cap", () => {
  const m = membership(1125, [{id:9720,name:"Dave"}], [51]);
  const s = sessionFor(51, "2026-08-20T17:00:00+00:00");
  const capped = Array.from({length:4}, (_,i) => ({ status:"confirmed",
    participants:[{ id:i+1, status:"confirmed", contact:{ id:9720 } }],
    courseRun:{ course:{ id:51 }, startDate:`2026-08-21T${10+i}:00:00+00:00` } }));
  assert.deepEqual(eligibleRidersFor(s, [m], capped, 9720, 4), []);
});

test("eligibleRidersFor: a rider in two covering memberships appears once (first membership)", () => {
  const m1 = membership(1125, [{id:9720,name:"Dave"}], [51]);
  const m2 = membership(2200, [{id:9720,name:"Dave"}], [51]);
  const s = sessionFor(51, "2026-08-20T17:00:00+00:00");
  const out = eligibleRidersFor(s, [m1, m2], [], 9720, 4);
  assert.equal(out.length, 1);
  assert.equal(out[0].contactId, 9720);
  assert.equal(out[0].membershipId, 1125); // first-encountered membership wins
});

test("buildParticipants shapes the API payload", () => {
  assert.deepEqual(buildParticipants([{contactId:9720, membershipId:1125}]),
    [{ contact:{ id:9720 }, membership:{ id:1125 } }]);
});
