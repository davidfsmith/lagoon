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
