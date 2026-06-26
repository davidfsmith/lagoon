import { londonParts } from "./tz.js";

export function slotKey(courseId, startISO) {
  return `${courseId}@${startISO}`;
}

export function runsToSlots(runs, courseId, label, now, horizonDays = 21) {
  const start = now instanceof Date ? now : new Date(now);
  const horizon = new Date(start.getTime() + horizonDays * 86400000);
  const out = [];
  for (const r of runs) {
    const s = new Date(r.startDate);
    if (s < start || s > horizon) continue;
    const free = r.maxNumbers - r.participantsCount;
    if (free <= 0) continue;
    out.push({
      courseId, label, runId: r.id,
      start: r.startDate, end: r.endDate,
      free, capacity: r.maxNumbers,
      key: slotKey(courseId, r.startDate),
      booked: false, freeWithMembership: false, weather: null,
    });
  }
  return out;
}

const isActiveBooking = (b) => {
  const s = (b.status || "").toLowerCase();
  return s !== "cancelled" && s !== "expired";
};

const isActiveParticipant = (p) => {
  const s = (p.status || "").toLowerCase();
  return s !== "cancelled" && s !== "expired";
};

// Participants still on a booking after cancellations. Cancelling a participant
// can either drop them from the list or mark their status "cancelled"; both leave
// a booking that's still "confirmed" at the top level, so we must look per-rider.
export function activeParticipants(b) {
  return (b.participants || []).filter(isActiveParticipant);
}

// True if a booking should be treated as a real, held place: top-level active AND
// (when participants are listed) at least one still active. A booking cancelled
// down to zero riders is no longer a booking.
export function bookingIsHeld(b) {
  if (!isActiveBooking(b)) return false;
  if (Array.isArray(b.participants) && activeParticipants(b).length === 0) return false;
  return true;
}

// Equipment add-ons (e.g. "Wakeboard Board Store", board hire) are optional extras,
// not cable sessions, so they must NOT count toward the per-rider booking cap.
const NON_SESSION_RE = /board\s*store|board\s*hire|storage/i;
export function countsTowardLimit(b) {
  return !NON_SESSION_RE.test(((b.courseRun || {}).course || {}).name || "");
}

export function bookingKeys(meBookings) {
  const set = new Set();
  for (const b of meBookings || []) {
    if (!bookingIsHeld(b)) continue;
    const cr = b.courseRun || {};
    const cid = cr.course && cr.course.id;
    if (cid != null && cr.startDate) set.add(slotKey(cid, cr.startDate));
  }
  return set;
}

export function markBooked(slots, keys) {
  for (const s of slots) s.booked = keys.has(s.key);
  return slots;
}

export function membershipFreeCourseIds(meMemberships) {
  const ids = new Set();
  for (const m of meMemberships || []) {
    if ((m.status || "").toLowerCase() !== "active") continue;
    const fc = (m.membershipType && m.membershipType.freeCourses) || [];
    for (const c of fc) if (c && c.id != null) ids.add(c.id);
  }
  return ids;
}

export function applyMembershipFree(slots, freeIds) {
  for (const s of slots) s.freeWithMembership = freeIds.has(s.courseId);
  return slots;
}

export function groupByDay(slots, daily = {}) {
  const byDate = new Map();
  for (const s of slots) {
    const date = londonParts(s.start).date; // group by Europe/London date
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(s);
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, daySlots]) => {
      daySlots.sort((a, b) => (a.start < b.start ? -1 : 1));
      const dow = new Date(date + "T12:00:00").getDay(); // noon avoids tz date-shift
      return { date, weekend: dow === 0 || dow === 6, summary: daily[date] || null, slots: daySlots };
    });
}

// Slots that newly freed up since the previous snapshot: present now AND either
// absent before (was full — i.e. a cancellation, since the agenda only ever holds
// free>0 slots) or with a higher free count than before (one of several spots
// freed). Pure diff of two agendas ([{ slots:[{ key, free }] }]); prevAgenda may be
// null on the first ever load -> empty result.
// NOTE: this only sees changes between the user's OWN loads/refreshes. Detecting
// opens while the app is closed is Phase 2 (AWS watcher + Web Push) — not a bug.
export function justOpenedKeys(prevAgenda, curAgenda) {
  if (prevAgenda == null) return new Set(); // first load — no baseline to diff against
  const prev = new Map();
  for (const d of prevAgenda) for (const s of d.slots || []) prev.set(s.key, s.free);
  const out = new Set();
  for (const d of curAgenda || []) for (const s of d.slots || []) {
    if (!prev.has(s.key) || s.free > prev.get(s.key)) out.add(s.key);
  }
  return out;
}

// London day-of-week (0=Sun..6=Sat) for a UTC ISO timestamp. Noon-local avoids any
// tz date-shift when reading the day back (same trick as groupByDay).
function londonDow(iso) {
  return new Date(londonParts(iso).date + "T12:00:00").getDay();
}

// The two calendar dates ("YYYY-MM-DD") of the coming weekend, in Europe/London.
// From a weekday: the upcoming Sat+Sun. From Sat/Sun: that same weekend (Sat+Sun).
function comingWeekendDates(now) {
  const base = new Date(londonParts(now).date + "T12:00:00"); // local noon, dow-safe
  const dow = base.getDay();                  // 0 Sun .. 6 Sat
  const toSat = dow === 0 ? -1 : 6 - dow;      // Sunday: Saturday was yesterday
  const sat = new Date(base.getTime() + toSat * 86400000);
  const sun = new Date(sat.getTime() + 86400000);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return new Set([fmt(sat), fmt(sun)]);
}

// Free, not-yet-started sessions within a short-notice window, soonest first.
// window: "today" | "weekend" | "48h". All dates compared in Europe/London (never
// raw UTC hours). `now` is a Date.
export function sessionsInWindow(agenda, window, now) {
  const nowMs = now.getTime();
  const soon = (agenda || []).flatMap(d => d.slots || [])
    .filter(s => s.free > 0 && new Date(s.start).getTime() > nowMs);
  let inWindow;
  if (window === "weekend") {
    const wknd = comingWeekendDates(now);
    inWindow = (s) => (londonDow(s.start) === 0 || londonDow(s.start) === 6) && wknd.has(londonParts(s.start).date);
  } else if (window === "48h") {
    const limit = nowMs + 48 * 3600000;
    inWindow = (s) => new Date(s.start).getTime() <= limit;
  } else { // "today"
    const today = londonParts(now).date;
    inWindow = (s) => londonParts(s.start).date === today;
  }
  return soon.filter(inWindow).sort((a, b) => (a.start < b.start ? -1 : 1));
}
