import { authedGet, getCourseRuns } from "./api.js";
import { fetchForecast } from "./weather.js";
import { buildAgenda } from "./agendaModel.js";
import { COURSES, HOVE, HORIZON_DAYS } from "./config.js";

export async function loadEverything(token, now = new Date()) {
  const [me, bookingsRes, memberships, packages, weather] = await Promise.all([
    authedGet("me", token),
    authedGet("me/bookings", token),
    authedGet("me/memberships", token),
    authedGet("me/packages", token),
    fetchForecast(HOVE.lat, HOVE.lon).catch(() => null), // weather best-effort
  ]);
  const meBookings = Array.isArray(bookingsRes) ? bookingsRes : (bookingsRes.data || []);
  // Fetch each course independently so one course erroring (the Lagoon API 500s
  // per-course at times) degrades to "that session type missing" rather than
  // blanking the whole agenda. Only a total failure falls back to cached data.
  const runsByCourse = {};
  const results = await Promise.all(COURSES.map(async (c) => {
    try { return { id: c.id, runs: await getCourseRuns(c.id), ok: true }; }
    catch { return { id: c.id, runs: [], ok: false }; }
  }));
  if (results.every(r => !r.ok)) throw new Error("courseRuns unavailable");
  for (const r of results) runsByCourse[r.id] = r.runs;
  const agenda = buildAgenda({ runsByCourse, courses: COURSES, meBookings, meMemberships: memberships, weather, now, horizonDays: HORIZON_DAYS });
  return { me, meBookings, memberships, packages, agenda, weather };
}
