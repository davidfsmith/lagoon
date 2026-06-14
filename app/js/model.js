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
      courseId, label,
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

export function bookingKeys(meBookings) {
  const set = new Set();
  for (const b of meBookings || []) {
    if (!isActiveBooking(b)) continue;
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
    const date = s.start.slice(0, 10);
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
