// Feature gating for in-flight work. Soft, client-side: this controls what's shown by
// default, not security — the code still ships to everyone. Gate a feature with
// isOn("flagName"); flags live in config.js. Two opt-in levels (both localStorage):
//   internal = developer opt-in (hidden, version-tap) — features mid-build
//   beta     = public opt-in (Settings toggle) — features that work but aren't GA
// internal sees everything beta does.
import { FEATURES, COURSES, SUP_COURSES } from "./config.js";
import { getBetaOptIn, getInternalOptIn, getDiscipline } from "./store.js";

// Whether an audience tier is allowed for this user. Exported for testing.
export function tierAllows(tier) {
  switch (tier) {
    case "on": return true;
    case "beta": return getBetaOptIn() || getInternalOptIn();
    case "internal": return getInternalOptIn();
    default: return false; // "off", undefined, or unknown → safe default
  }
}

// Is a given feature flag enabled for this user?
export function isOn(flag) {
  return tierAllows(FEATURES[flag]);
}

// The course set the availability pipeline should load, per the active discipline:
// SUP when the user has switched to it, otherwise the wake courses.
export function activeCourses() {
  return getDiscipline() === "sup" ? SUP_COURSES : COURSES;
}

// Is this course id one of the paddle-boarding sessions?
export function isSupCourse(id) {
  return SUP_COURSES.some(c => c.id === id);
}

// Does a booking/session of this course id belong to the currently-shown discipline?
// Used to filter Bookings + History app-wide: in wake mode SUP sessions are hidden (and
// vice-versa), so a SUP session booked on the website shows under the SUP switch.
export function inActiveDiscipline(courseId) {
  return getDiscipline() === "sup" ? isSupCourse(courseId) : !isSupCourse(courseId);
}

// Boot routing decision (pure): signed in → full personal+public load; else if guest mode
// is enabled → public-only load; else the classic login wall. Kept pure for testing; the
// caller passes getToken()-presence and isOn("guestMode").
export function bootMode(hasToken, guestEnabled) {
  if (hasToken) return "full";
  return guestEnabled ? "public" : "login";
}

// Does this user have any beta access at all?
export function isBetaUser() {
  return getBetaOptIn() || getInternalOptIn();
}

// Highest active level, for the badge: "internal" | "beta" | null.
export function accessTier() {
  if (getInternalOptIn()) return "internal";
  if (getBetaOptIn()) return "beta";
  return null;
}
