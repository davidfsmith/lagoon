import { authedGet, getCourseRuns } from "./api.js";
import { fetchForecast } from "./weather.js";
import { buildAgenda } from "./agendaModel.js";
import { HOVE, HORIZON_DAYS } from "./config.js";
import { activeCourses } from "./features.js";

// Fetch course runs (public) for the active discipline + weather, degrading per-course so
// one failing course doesn't blank the agenda. Shared by both the signed-in and guest paths.
async function loadRunsAndWeather() {
  const courses = activeCourses();
  const [weather, results] = await Promise.all([
    fetchForecast(HOVE.lat, HOVE.lon).catch(() => null), // best-effort
    Promise.all(courses.map(async (c) => {
      try { return { id: c.id, runs: await getCourseRuns(c.id), ok: true }; }
      catch { return { id: c.id, runs: [], ok: false }; }
    })),
  ]);
  if (results.every(r => !r.ok)) throw new Error("courseRuns unavailable");
  const runsByCourse = {};
  for (const r of results) runsByCourse[r.id] = r.runs;
  return { courses, runsByCourse, weather };
}

export async function loadEverything(token, now = new Date()) {
  // Guest (no token): public availability only — no personal calls.
  if (!token) {
    const { courses, runsByCourse, weather } = await loadRunsAndWeather();
    const agenda = buildAgenda({ runsByCourse, courses, meBookings: [], meMemberships: [], weather, now, horizonDays: HORIZON_DAYS, meId: null });
    return { me: null, meBookings: [], memberships: [], packages: [], agenda, weather };
  }
  // Signed in: personal data + public availability.
  const [me, bookingsRes, memberships, packages] = await Promise.all([
    authedGet("me", token),
    authedGet("me/bookings", token),
    authedGet("me/memberships", token),
    authedGet("me/packages", token),
  ]);
  const meBookings = Array.isArray(bookingsRes) ? bookingsRes : (bookingsRes.data || []);
  const { courses, runsByCourse, weather } = await loadRunsAndWeather();
  const agenda = buildAgenda({ runsByCourse, courses, meBookings, meMemberships: memberships, weather, now, horizonDays: HORIZON_DAYS, meId: me && me.id });
  return { me, meBookings, memberships, packages, agenda, weather };
}
