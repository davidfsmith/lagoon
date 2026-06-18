import { authedGet, getCourseRuns } from "./api.js";
import { fetchForecast } from "./weather.js";
import { buildAgenda } from "./agendaModel.js";
import { COURSES, HOVE, HORIZON_DAYS } from "./config.js";

export async function loadEverything(token, now = new Date()) {
  const horizonISO = new Date(now.getTime() + HORIZON_DAYS * 86400000).toISOString();
  const [me, bookingsRes, memberships, packages, weather] = await Promise.all([
    authedGet("me", token),
    authedGet("me/bookings", token),
    authedGet("me/memberships", token),
    authedGet("me/packages", token),
    fetchForecast(HOVE.lat, HOVE.lon).catch(() => null), // weather best-effort
  ]);
  const meBookings = Array.isArray(bookingsRes) ? bookingsRes : (bookingsRes.data || []);
  const runsByCourse = {};
  await Promise.all(COURSES.map(async (c) => { runsByCourse[c.id] = await getCourseRuns(c.id, horizonISO); }));
  const agenda = buildAgenda({ runsByCourse, courses: COURSES, meBookings, meMemberships: memberships, weather, now, horizonDays: HORIZON_DAYS });
  return { me, meBookings, memberships, packages, agenda };
}
