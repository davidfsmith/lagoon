import { runsToSlots, mergeBookings, membershipFreeCourseIds, applyMembershipFree, groupByDay } from "./model.js";
import { inActiveDiscipline } from "./features.js";
import { prettyCourse } from "./views/format.js";
import { attachWeather } from "./weather.js";

export function buildAgenda({ runsByCourse, courses, meBookings, meMemberships, weather, now, horizonDays = 21, meId = null }) {
  let slots = [];
  for (const c of courses) {
    const runs = runsByCourse[c.id] || [];
    slots = slots.concat(runsToSlots(runs, c.id, c.label, now, horizonDays));
  }
  const courseLabels = new Map(courses.map(c => [c.id, c.label]));
  const labelFor = (id, name) => courseLabels.get(id) || prettyCourse(name);
  slots = mergeBookings(slots, meBookings, { inDiscipline: inActiveDiscipline, labelFor, meId, now, horizonDays });
  applyMembershipFree(slots, membershipFreeCourseIds(meMemberships));
  if (weather && weather.hourly) attachWeather(slots, weather.hourly);
  return groupByDay(slots, (weather && weather.daily) || {});
}
