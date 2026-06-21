// Add a booking to the user's calendar via a downloadable .ics file — universal
// (Apple Calendar, Google, Outlook), no backend, no deps. On phones, tapping the
// downloaded file opens the native "Add to Calendar" sheet.
import { prettyCourse } from "./views/format.js";

const LOCATION = "Hove Lagoon, Kingsway, Hove BN3 4LX";

// ISO instant -> ICS UTC basic format YYYYMMDDTHHMMSSZ. The Lagoon API serialises
// times as UTC (+00:00), so the calendar event lands at the correct wall-clock.
function icsTime(iso) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
const esc = (t) => String(t || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

// Build a VCALENDAR string for one booking (a single VEVENT + a 45-min reminder).
export function icsForBooking(b, now = new Date()) {
  const cr = b.courseRun || {};
  const title = `🏄 ${prettyCourse((cr.course || {}).name)} @ Hove Lagoon`;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hove Lagoon//app//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:lagoon-${b.id || icsTime(cr.startDate)}@dave-smith.co.uk`,
    `DTSTAMP:${icsTime(now.toISOString())}`,
    `DTSTART:${icsTime(cr.startDate)}`,
    `DTEND:${icsTime(cr.endDate || cr.startDate)}`,
    `SUMMARY:${esc(title)}`,
    `LOCATION:${esc(LOCATION)}`,
    `DESCRIPTION:${esc("Wakeboarding session at Hove Lagoon. Arrive ~20 min early.")}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc("Wakeboarding at Hove Lagoon — leave time to get there")}`,
    "TRIGGER:-PT45M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n") + "\r\n";
}

// Trigger a download of the .ics for a booking.
export function downloadIcsForBooking(b) {
  const blob = new Blob([icsForBooking(b)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hove-lagoon-${((b.courseRun || {}).startDate || "").slice(0, 10)}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
