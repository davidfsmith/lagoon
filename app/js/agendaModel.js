import { runsToSlots, bookingKeys, markBooked, membershipFreeCourseIds, applyMembershipFree, groupByDay } from "./model.js";
import { attachWeather } from "./weather.js";

export function buildAgenda({ runsByCourse, courses, meBookings, meMemberships, weather, now, horizonDays = 21 }) {
  let slots = [];
  for (const c of courses) {
    const runs = runsByCourse[c.id] || [];
    slots = slots.concat(runsToSlots(runs, c.id, c.label, now, horizonDays));
  }
  markBooked(slots, bookingKeys(meBookings));
  applyMembershipFree(slots, membershipFreeCourseIds(meMemberships));
  if (weather && weather.hourly) attachWeather(slots, weather.hourly);
  return groupByDay(slots, (weather && weather.daily) || {});
}
