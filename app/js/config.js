export const API_BASE = "https://api.lagoon.co.uk";
export const API2_BASE = "https://api2.lagoon.co.uk/api";
export const WX_URL = "https://api.open-meteo.com/v1/forecast";
export const HOVE = { lat: 50.827, lon: -0.171 };
export const HORIZON_DAYS = 21;
// Sessions the app fetches. `extra: true` ones are hidden by default and revealed
// via the per-type filter chips on the agenda. `group` controls which filter row a
// chip sits on: "ride" (the cable ride sessions) on row 1, "other" on row 2.
// Order here is the chip order within each row. See views/agenda.js.
export const COURSES = [
  { id: 51, label: "Air 30", group: "ride" },
  { id: 50, label: "Tech 30", group: "ride" },
  { id: 713, label: "Air 15", group: "ride", extra: true },
  { id: 714, label: "Tech 15", group: "ride", extra: true },
  { id: 9, label: "Taster", group: "other", extra: true },
  { id: 478, label: "Jam", group: "other", extra: true },
  { id: 586, label: "Drop-in", group: "other", extra: true },
];
export const FILTER_GROUPS = ["ride", "other"];
export const BOOKING_LIMIT = 4; // max upcoming booked sessions per rider (approx — unconfirmed)
export const BOOKING_SITE = "https://booking.lagoon.co.uk";
export const APP_RELEASE = "v28"; // release/version — bump together with sw.js CACHE
export const APP_VERSION = "dev"; // overwritten at deploy with "build <sha> · <date>"
