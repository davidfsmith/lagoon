export const API_BASE = "https://api.lagoon.co.uk";
export const API2_BASE = "https://api2.lagoon.co.uk/api";
export const WX_URL = "https://api.open-meteo.com/v1/forecast";
export const HOVE = { lat: 50.827, lon: -0.171 };
export const HORIZON_DAYS = 21;
// Sessions the app fetches. `extra: true` ones are hidden by default and revealed
// via the per-type filter chips on the agenda (see views/agenda.js).
export const COURSES = [
  { id: 50, label: "Tech 30" },
  { id: 51, label: "Air 30" },
  { id: 9, label: "Taster", extra: true },
  { id: 478, label: "Jam", extra: true },
  { id: 586, label: "Drop-in", extra: true },
];
export const BOOKING_SITE = "https://booking.lagoon.co.uk";
export const APP_VERSION = "dev"; // overwritten at deploy with "build <sha> · <date>"
