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

// Overlay the roster's held bookings onto the availability slots so a session anyone on
// the account is booked on always shows — even when it's full and thus absent from the
// free-slot feed. Pure: the discipline filter, label resolver and current-user id are
// injected, so this needs no store/view imports.
//   slots        - free slots from runsToSlots (active discipline); mutated in place
//   meBookings   - raw /me/bookings (whole roster)
//   inDiscipline - (courseId) => bool: is this course in the shown discipline?
//   labelFor     - (courseId, courseName) => string: chip label (config label or prettyCourse)
//   meId         - logged-in contact id, rendered as "You"
// Existing slots the roster is booked on gain booked + riders; booked sessions with no
// availability row are synthesized as free:0 rows. Returns the combined list.
export function mergeBookings(slots, meBookings, { inDiscipline, labelFor, meId, now, horizonDays = 21 } = {}) {
  const start = now instanceof Date ? now : new Date(now);
  const horizon = new Date(start.getTime() + horizonDays * 86400000);
  const byKey = new Map(); // slotKey -> { courseId, runId, start, end, label, riders[], _ids:Set }
  for (const b of meBookings || []) {
    if (!bookingIsHeld(b)) continue;
    if (!countsTowardLimit(b)) continue;          // skip board-store / hire add-ons
    const cr = b.courseRun || {};
    const courseId = cr.course && cr.course.id;
    if (courseId == null || !cr.startDate) continue;
    if (!inDiscipline(courseId)) continue;        // wake vs SUP
    const s = new Date(cr.startDate);
    if (s < start || s > horizon) continue;       // upcoming, within horizon
    const key = slotKey(courseId, cr.startDate);
    let e = byKey.get(key);
    if (!e) {
      e = { courseId, runId: cr.id, start: cr.startDate, end: cr.endDate,
            label: labelFor(courseId, (cr.course || {}).name), riders: [], _ids: new Set() };
      byKey.set(key, e);
    }
    for (const p of activeParticipants(b)) {
      const cid = (p.contact || {}).id;
      if (cid != null && e._ids.has(cid)) continue;
      if (cid != null) e._ids.add(cid);
      const you = cid != null && cid === meId;
      e.riders.push({ name: you ? "You" : ((p.contact || {}).firstName || "Rider"), you });
    }
  }
  const ridersOf = (e) => [
    ...e.riders.filter(r => r.you).map(r => r.name),   // "You" first
    ...e.riders.filter(r => !r.you).map(r => r.name),  // then others, in encounter order
  ];
  const present = new Set();
  for (const slot of slots) {
    const e = byKey.get(slot.key);
    if (e) { slot.booked = true; slot.riders = ridersOf(e); present.add(slot.key); }
  }
  for (const [key, e] of byKey) {
    if (present.has(key)) continue;
    slots.push({ courseId: e.courseId, label: e.label, runId: e.runId,
      start: e.start, end: e.end, free: 0, capacity: null, key,
      booked: true, riders: ridersOf(e), freeWithMembership: false, weather: null });
  }
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

// After a cancellation, drop synthesized booked rows (free:0) that are no longer booked,
// so a cancelled-to-empty full session doesn't linger on Availability until the next
// reload. A real availability row always has free>0, so free===0 && !booked is uniquely
// a defunct booked row.
export function pruneDefunctBookedSlots(agenda) {
  for (const d of agenda || []) d.slots = (d.slots || []).filter(s => !(s.free === 0 && !s.booked));
  return agenda;
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
    if (s.free > 0 && (!prev.has(s.key) || s.free > prev.get(s.key))) out.add(s.key);
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

// The Europe/London calendar date ("YYYY-MM-DD") `days` after `now` (0 = today, 1 =
// tomorrow). Noon-local keeps the date stable across time zones + DST (same trick as
// groupByDay / comingWeekendDates); setDate handles month/year rollover.
function londonDatePlus(now, days) {
  const d = new Date(londonParts(now).date + "T12:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Free, not-yet-started sessions within a short-notice window, soonest first.
// window: "today" | "tomorrow" | "weekend". All dates compared in Europe/London (never
// raw UTC hours). `now` is a Date. Unknown windows fall back to "today".
export function sessionsInWindow(agenda, window, now) {
  const nowMs = now.getTime();
  const soon = (agenda || []).flatMap(d => d.slots || [])
    .filter(s => (s.free > 0 || s.booked) && new Date(s.start).getTime() > nowMs);
  let inWindow;
  if (window === "weekend") {
    const wknd = comingWeekendDates(now);
    inWindow = (s) => (londonDow(s.start) === 0 || londonDow(s.start) === 6) && wknd.has(londonParts(s.start).date);
  } else if (window === "tomorrow") {
    const tomorrow = londonDatePlus(now, 1);
    inWindow = (s) => londonParts(s.start).date === tomorrow;
  } else { // "today"
    const today = londonParts(now).date;
    inWindow = (s) => londonParts(s.start).date === today;
  }
  return soon.filter(inWindow).sort((a, b) => (a.start < b.start ? -1 : 1));
}

// Does this membership make the given course £0? (freeCourses lists covered course ids.)
export function coveringMembership(membership, courseId) {
  const free = (membership && membership.membershipType && membership.membershipType.freeCourses) || [];
  return free.some(c => c && c.id === courseId);
}

// Riders a membership makes £0 for this session, excluding anyone already booked on it or at the
// per-rider cap. Returns [{contactId, name, membershipId}] — empty means "not in-app bookable".
export function eligibleRidersFor(session, memberships, meBookings, meId, cap) {
  // per-rider count of active upcoming session bookings (for the cap)
  const counts = {};
  for (const b of meBookings || []) {
    if (!bookingIsHeld(b) || !countsTowardLimit(b)) continue;
    for (const p of activeParticipants(b)) { const c = (p.contact||{}).id; if (c!=null) counts[c] = (counts[c]||0)+1; }
  }
  const out = []; const seen = new Set();
  for (const m of memberships || []) {
    if ((m.status||"").toLowerCase() !== "active") continue;
    if (!coveringMembership(m, session.courseId)) continue;
    for (const mem of m.members || []) {
      const id = mem.id;
      if (id == null || seen.has(id)) continue;
      // already booked on THIS session? (courseId@startDate key)
      const onThis = (meBookings||[]).some(b => bookingIsHeld(b)
        && slotKey(((b.courseRun||{}).course||{}).id, (b.courseRun||{}).startDate) === session.key
        && activeParticipants(b).some(p => (p.contact||{}).id === id));
      if (onThis) continue;
      if ((counts[id] || 0) >= cap) continue;
      seen.add(id);
      out.push({ contactId: id, name: id === meId ? "You" : (mem.firstName || "Rider"), membershipId: m.id });
    }
  }
  return out;
}

export function buildParticipants(riders) {
  return (riders || []).map(r => ({ contact: { id: r.contactId }, membership: { id: r.membershipId } }));
}
