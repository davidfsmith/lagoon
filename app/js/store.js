
const TOKEN_KEY = "lagoon.token";
const CACHE_KEY = "lagoon.cache";

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); }

export function saveCache(data) {
  localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
}
export function loadCache() {
  const raw = localStorage.getItem(CACHE_KEY);
  return raw ? JSON.parse(raw) : null;
}

// Default calendar-reminder lead time (minutes before the session), used by the
// "Add to calendar" .ics. Settable in Settings; defaults to 20.
const REMINDER_KEY = "lagoon.reminderMin";
export const REMINDER_OPTIONS = [10, 20, 30, 40, 50, 60];
export const TRAVEL_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90]; // notify travel-time minutes
const REMINDER_DEFAULT = 20;

export function getReminderMinutes() {
  const v = parseInt(localStorage.getItem(REMINDER_KEY), 10);
  return REMINDER_OPTIONS.includes(v) ? v : REMINDER_DEFAULT;
}
export function setReminderMinutes(m) { localStorage.setItem(REMINDER_KEY, String(m)); }

// Which screen the app opens on. "lastminute" is offered only to gated users; for
// everyone else (and for a stale "lastminute" read after the flag is turned off) it
// falls back to Availability.
const LANDING_KEY = "lagoon.defaultLanding";
export const LANDING_OPTIONS = [
  { id: "lastminute", label: "Last minute" },
  { id: "agenda", label: "Availability" },
  { id: "account", label: "Bookings" },
];
export function setDefaultLanding(id) { localStorage.setItem(LANDING_KEY, id); }
export function getDefaultLanding() {
  const raw = localStorage.getItem(LANDING_KEY);
  const valid = LANDING_OPTIONS.some(o => o.id === raw);
  return valid ? raw : "agenda"; // no stored choice -> open on Availability
}

// Last-minute view's window selector: "today" | "tomorrow" | "weekend" (default today;
// a stale "48h" from before falls back to today via the validation below).
const LM_WINDOW_KEY = "lagoon.lastMinuteWindow";
const LM_WINDOWS = ["today", "tomorrow", "weekend"];
export function getLastMinuteWindow() {
  const v = localStorage.getItem(LM_WINDOW_KEY);
  return LM_WINDOWS.includes(v) ? v : "today";
}
export function setLastMinuteWindow(w) { localStorage.setItem(LM_WINDOW_KEY, w); }

// Beta opt-in: the public "try in-progress features" toggle (Settings). Soft,
// client-side — see features.js. Stored "1"/"0"; any non-"1" reads as off.
const BETA_OPTIN_KEY = "lagoon.betaOptIn";
export function getBetaOptIn() {
  try { return localStorage.getItem(BETA_OPTIN_KEY) === "1"; } catch { return false; }
}
export function setBetaOptIn(on) {
  try { localStorage.setItem(BETA_OPTIN_KEY, on ? "1" : "0"); } catch {}
}

// Internal opt-in: the hidden developer level (revealed by the version-tap gesture),
// for features that are still being built. Superset of beta — see features.js.
const INTERNAL_OPTIN_KEY = "lagoon.internalOptIn";
export function getInternalOptIn() {
  try { return localStorage.getItem(INTERNAL_OPTIN_KEY) === "1"; } catch { return false; }
}
export function setInternalOptIn(on) {
  try { localStorage.setItem(INTERNAL_OPTIN_KEY, on ? "1" : "0"); } catch {}
}

// Push-notification prefs (days/types/travel-time filter): cached locally for the
// Settings UI and sent to the server by push.js, which applies them server-side.
const NOTIFY_PREFS_KEY = "lagoon.notifyPrefs";
const DEFAULT_NOTIFY_PREFS = {
  days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  types: ["Air 30", "Tech 30"],
  travelMins: 30,
};
export function getNotifyPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(NOTIFY_PREFS_KEY) || "null");
    const merged = p && typeof p === "object" ? { ...DEFAULT_NOTIFY_PREFS, ...p } : { ...DEFAULT_NOTIFY_PREFS };
    // normalise days to weekday order (Mon→Sun), deduped, invalid dropped
    if (Array.isArray(merged.days)) merged.days = DEFAULT_NOTIFY_PREFS.days.filter(d => merged.days.includes(d));
    return merged;
  } catch { return { ...DEFAULT_NOTIFY_PREFS }; }
}
export function setNotifyPrefs(prefs) {
  try { localStorage.setItem(NOTIFY_PREFS_KEY, JSON.stringify(prefs)); } catch {}
}
