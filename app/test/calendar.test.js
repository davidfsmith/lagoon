import { test } from "node:test";
import assert from "node:assert/strict";
import { icsForBooking } from "../js/calendar.js";

const booking = {
  id: 123,
  courseRun: {
    startDate: "2026-06-23T15:30:00+00:00",
    endDate: "2026-06-23T16:00:00+00:00",
    course: { name: "2026 Wakeboard -Tech - Ride Session 30" },
  },
};

const NOW = new Date("2026-06-21T09:00:00Z");

test("icsForBooking builds a valid VEVENT with UTC times", () => {
  const ics = icsForBooking(booking, { now: NOW });
  assert.match(ics, /^BEGIN:VCALENDAR/);
  assert.match(ics, /DTSTART:20260623T153000Z/);   // 15:30 UTC = 16:30 BST, encoded as the UTC instant
  assert.match(ics, /DTEND:20260623T160000Z/);
  assert.match(ics, /SUMMARY:🏄 Tech 30 @ Hove Lagoon/);
  assert.match(ics, /UID:lagoon-123@/);
  assert.ok(ics.endsWith("\r\n"), "CRLF line endings");
});

test("icsForBooking escapes commas in text fields (LOCATION)", () => {
  assert.match(icsForBooking(booking, { now: NOW }), /LOCATION:Hove Lagoon\\, Kingsway\\, Hove BN3 4LX/);
});

test("reminder defaults to 20 min and honours an override", () => {
  assert.match(icsForBooking(booking, { now: NOW }), /TRIGGER:-PT20M/);
  assert.match(icsForBooking(booking, { now: NOW, reminderMin: 50 }), /TRIGGER:-PT50M/);
});
