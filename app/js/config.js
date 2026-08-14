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
  { id: 67, label: "Skills", group: "other", extra: true },
  { id: 78, label: "Tantrums", group: "other", extra: true },
  { id: 66, label: "Clinic", group: "other", extra: true },
];
export const FILTER_GROUPS = ["ride", "other"];

// Paddle boarding (SUP) session types — a separate discipline, shown via the header
// discipline switch. Verified as having scheduled runs on 2026-07-26. All group "paddle",
// all default-on (no `extra`) so switching to SUP shows everything.
// Availability + Book only — deliberately NOT wired into notifications (see settings.js).
export const SUP_COURSES = [
  { id: 37,  label: "Ready to Ride", group: "paddle" }, // 2026 SUP - Ready to Ride
  { id: 38,  label: "Touring",       group: "paddle" }, // 2026 SUP - Intro to Touring
  { id: 71,  label: "Sea Social",    group: "paddle" }, // 2026 Clinic SUP - Sea social and Improve
  { id: 72,  label: "Training",      group: "paddle" }, // 2026 Clinic SUP - Training/Race
  { id: 73,  label: "SUP Yoga",      group: "paddle" }, // 2026 Clinic - SUP Yoga
  { id: 415, label: "Private",       group: "paddle" }, // 2026 SUP - Private Lesson
];

// Feature flags → audience tier: "off" | "internal" | "beta" | "on".
//   internal = developer opt-in (hidden) · beta = internal or beta opt-in · on = everyone.
// Wrap a feature's UI in isOn("flagName"); promote the tier, then delete the flag once
// it's stable. NOTE: client-side soft gate — code still ships to everyone.
export const FEATURES = {
  cancelSuppress: "internal", // don't self-notify about a slot you just cancelled (dev-only while built out)
  rum: "internal", // first-party cookieless usage analytics (dev-only while validated)
  guestMode: "internal", // browse public availability without signing in (dev-only while built out)
};

export const BOOKING_LIMIT = 4; // max upcoming booked sessions per rider (approx — unconfirmed)
export const BOOKING_SITE = "https://booking.lagoon.co.uk";
// Canonical public URL of the app — hardcoded (not derived from location) so a shared link
// or QR generated on a locally-served dev build still points at production. share-qr.svg
// encodes this exact string; regenerate it if this changes.
export const APP_URL = "https://dave-smith.co.uk/lagoon";
// Guest WiFi at the Lagoon Café (public, shared on WhatsApp). Single source of truth —
// the Café tab shows these and wifi-qr.svg encodes the same values as WIFI:T:WPA;S:…;P:…;;.
// If you change ssid/password/security here, regenerate wifi-qr.svg to match.
export const CAFE_WIFI = { ssid: "HoveLagoonGuest", password: "topsecretgoonies", security: "WPA" };
// Web Push (see docs/superpowers/specs/2026-07-09-push-notifications-design.md).
// Public key is safe to ship; the matching private key lives only in SSM
// (/lagoon/push/vapid-private). PUSH_REGISTER_URL is a SAME-ORIGIN path: CloudFront routes
// /lagoon/push* to the registration Lambda's Function URL. Same-origin (vs the raw
// *.lambda-url.on.aws host) so content blockers don't kill the fetch and CORS is moot.
export const VAPID_PUBLIC_KEY = "BIpePuebyYxvD7WotLtp1RWVFAFv8FjwMFyhEsngulnRaKnN0Fbi0H90rXpxs7CxUrOeFKLgFEZobzTK6d9L8js";
export const PUSH_REGISTER_URL = "/lagoon/push";
export const APP_RELEASE = "v99"; // release/version — bump together with sw.js CACHE
export const APP_VERSION = "dev"; // overwritten at deploy with "build <sha> · <date>"
