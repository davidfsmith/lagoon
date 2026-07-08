
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
