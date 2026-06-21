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
