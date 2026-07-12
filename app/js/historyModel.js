// Past-session history: derive a year-grouped list + summary stats from the bookings
// the app already loads (state.meBookings). Pure — no DOM, no wall-clock: `now` is
// injected so the streak's "live" check is deterministic in tests.
import { activeParticipants } from "./model.js";
import { londonParts } from "./tz.js";
import { prettyCourse } from "./views/format.js";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// Weekday of a "YYYY-MM-DD" (noon avoids any tz date-shift).
function weekday(date) { return new Date(date + "T12:00:00").getDay(); }
// The Monday of the (London) week containing a "YYYY-MM-DD" date, as a "YYYY-MM-DD" key.
function weekMondayKey(date) {
  const d = new Date(date + "T12:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // 0=Mon … 6=Sun
  return ymd(d);
}
function prevWeek(d) { const n = new Date(d); n.setDate(n.getDate() - 7); return n; }

// Most-frequent value (ties: first to reach the max). null for empty input.
function mode(values) {
  const counts = new Map();
  let best = null, bestN = 0;
  for (const v of values) {
    const n = (counts.get(v) || 0) + 1;
    counts.set(v, n);
    if (n > bestN) { bestN = n; best = v; }
  }
  return best;
}

// A real, past, held booking: confirmed, in the past, with at least one active rider.
function isPastHeld(b, now) {
  if ((b.status || "").toLowerCase() !== "confirmed" || b.cancelledAt) return false;
  const sd = b.courseRun && b.courseRun.startDate;
  if (!sd || new Date(sd) >= now) return false;
  if (Array.isArray(b.participants) && activeParticipants(b).length === 0) return false;
  return true;
}

// Consecutive Monday-anchored London weeks with ≥1 ride, counting back from the most
// recent ride — but only "live" if that ride is this week's or last week's Monday.
function computeStreak(dates, now) {
  if (!dates.length) return 0;
  const weeks = new Set(dates.map(weekMondayKey));
  const nowMonKey = weekMondayKey(londonParts(now.toISOString()).date);
  const lastMonKey = ymd(prevWeek(new Date(nowMonKey + "T12:00:00")));
  const sorted = [...weeks].sort();
  const latest = sorted[sorted.length - 1];
  if (latest !== nowMonKey && latest !== lastMonKey) return 0;
  let count = 0, cur = new Date(latest + "T12:00:00");
  while (weeks.has(ymd(cur))) { count++; cur = prevWeek(cur); }
  return count;
}

export function pastSessions(meBookings, me, now) {
  const meId = me && me.id;
  const held = (meBookings || []).filter(b => isPastHeld(b, now));

  const list = held.map(b => {
    const startDate = b.courseRun.startDate;
    const date = londonParts(startDate).date; // London calendar date
    const riders = (b.participants || [])
      .map(p => p.contact || {})
      .filter(c => c.id !== meId)
      .map(c => c.firstName)
      .filter(Boolean);
    return { year: Number(date.slice(0, 4)), date, startDate, typeLabel: prettyCourse((b.courseRun.course || {}).name), riders };
  }).sort((a, b) => (a.startDate < b.startDate ? 1 : -1)); // newest first

  const nowYear = Number(londonParts(now.toISOString()).date.slice(0, 4));
  const total = list.length;
  const thisYear = list.filter(e => e.year === nowYear).length;

  // Per-rider: count each contact once per booking ("You" for the logged-in rider).
  const riderCounts = new Map();
  for (const b of held) {
    const seen = new Set();
    for (const p of (b.participants || [])) {
      const c = p.contact || {};
      const key = c.id != null ? `id:${c.id}` : `n:${c.firstName || "?"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const name = c.id === meId ? "You" : (c.firstName || "Rider");
      riderCounts.set(name, (riderCounts.get(name) || 0) + 1);
    }
  }
  const perRider = [...riderCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const favType = mode(list.map(e => e.typeLabel));
  const favDay = mode(list.map(e => DAY_NAMES[weekday(e.date)]));
  const streak = computeStreak(list.map(e => e.date), now);

  return { list, stats: { total, thisYear, streak, perRider, favType, favDay } };
}
