import { WX_URL } from "./config.js";

export function parseDaily(json) {
  const d = json.daily, out = {};
  d.time.forEach((date, i) => {
    out[date] = {
      code: d.weather_code[i],
      tMin: d.temperature_2m_min[i], tMax: d.temperature_2m_max[i],
      precipProb: d.precipitation_probability_max[i], precipSum: d.precipitation_sum[i],
      windMax: d.wind_speed_10m_max[i], gustMax: d.wind_gusts_10m_max[i],
      windDir: d.wind_direction_10m_dominant[i],
      sunrise: d.sunrise[i], sunset: d.sunset[i],
    };
  });
  return out;
}

export function parseHourly(json) {
  const h = json.hourly;
  return h.time.map((t, i) => ({
    time: t, temp: h.temperature_2m[i], code: h.weather_code[i],
    windSpeed: h.wind_speed_10m[i], gust: h.wind_gusts_10m[i],
    windDir: h.wind_direction_10m[i], precipProb: h.precipitation_probability[i],
  }));
}

// Match on literal "YYYY-MM-DDTHH" — never Date parsing (BST drift). 15:30 -> 15.
export function weatherAt(hourly, iso) {
  const key = iso.slice(0, 13);
  return hourly.find(h => h.time.slice(0, 13) === key) || null;
}

export function attachWeather(slots, hourly) {
  for (const s of slots) s.weather = weatherAt(hourly, s.start);
  return slots;
}

export async function fetchForecast(lat, lon, fetchImpl = fetch) {
  const params = new URLSearchParams({
    latitude: lat, longitude: lon, timezone: "Europe/London", forecast_days: "16",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,sunrise,sunset",
    hourly: "temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation_probability",
  });
  const res = await fetchImpl(`${WX_URL}?${params}`);
  if (!res.ok) throw new Error("weather " + res.status);
  const json = await res.json();
  return { daily: parseDaily(json), hourly: parseHourly(json) };
}
