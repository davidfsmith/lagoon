import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAgenda } from "../js/agendaModel.js";

const now = new Date("2026-06-14T08:00:00+00:00");
const runsByCourse = {
  50: [{ startDate: "2026-06-20T13:00:00+00:00", endDate: "2026-06-20T13:30:00+00:00", maxNumbers: 2, participantsCount: 0 }],
  51: [{ startDate: "2026-06-20T15:00:00+00:00", endDate: "2026-06-20T15:30:00+00:00", maxNumbers: 2, participantsCount: 1 }],
};
const meBookings = [{ status: "confirmed", courseRun: { course: { id: 50 }, startDate: "2026-06-20T13:00:00+00:00" } }];
const meMemberships = [{ status: "active", membershipType: { freeCourses: [{ id: 50 }, { id: 51 }] } }];
const weather = {
  daily: { "2026-06-20": { tMax: 20, tMin: 15 } },
  hourly: [
    { time: "2026-06-20T14:00", temp: 18 }, // London hour for the 13:00 UTC tech slot (BST +1)
    { time: "2026-06-20T16:00", temp: 20 }, // London hour for the 15:00 UTC air slot
  ],
};

test("buildAgenda merges slots, weather, bookings and membership flags", () => {
  const days = buildAgenda({ runsByCourse, courses: [{ id: 50, label: "Tech 30" }, { id: 51, label: "Air 30" }],
    meBookings, meMemberships, weather, now, horizonDays: 21 });
  assert.equal(days.length, 1);
  const d = days[0];
  assert.equal(d.date, "2026-06-20");
  assert.equal(d.weekend, true);
  assert.equal(d.summary.tMax, 20);
  assert.equal(d.slots.length, 2);
  const tech = d.slots.find(s => s.courseId === 50);
  assert.equal(tech.booked, true);
  assert.equal(tech.freeWithMembership, true);
  assert.equal(tech.weather.temp, 18);
});
