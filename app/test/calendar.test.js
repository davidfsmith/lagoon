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

test("icsForBooking builds a valid VEVENT with UTC times", () => {
  const ics = icsForBooking(booking, new Date("2026-06-21T09:00:00Z"));
  assert.match(ics, /^BEGIN:VCALENDAR/);
  assert.match(ics, /DTSTART:20260623T153000Z/);   // 15:30 UTC = 16:30 BST, encoded as the UTC instant
  assert.match(ics, /DTEND:20260623T160000Z/);
  assert.match(ics, /SUMMARY:🏄 Tech 30 @ Hove Lagoon/);
  assert.match(ics, /UID:lagoon-123@/);
  assert.match(ics, /TRIGGER:-PT45M/);
  assert.ok(ics.endsWith("\r\n"), "CRLF line endings");
});

test("icsForBooking escapes commas in text fields (LOCATION)", () => {
  const ics = icsForBooking(booking, new Date("2026-06-21T09:00:00Z"));
  assert.match(ics, /LOCATION:Hove Lagoon\\, Kingsway\\, Hove BN3 4LX/);
});
