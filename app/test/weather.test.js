import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDaily, parseHourly, weatherAt, attachWeather, fetchForecast } from "../js/weather.js";

const sample = {
  daily: {
    time: ["2026-06-20"], weather_code: [3],
    temperature_2m_max: [20], temperature_2m_min: [15],
    precipitation_probability_max: [10], precipitation_sum: [0],
    wind_speed_10m_max: [20], wind_gusts_10m_max: [40], wind_direction_10m_dominant: [225],
    sunrise: ["2026-06-20T04:50"], sunset: ["2026-06-20T21:18"],
  },
  hourly: {
    time: ["2026-06-20T14:00", "2026-06-20T15:00", "2026-06-20T16:00", "2026-06-20T17:00"],
    temperature_2m: [19, 20, 19, 18], weather_code: [3, 1, 3, 1],
    wind_speed_10m: [24, 21, 19, 17], wind_gusts_10m: [44, 41, 39, 36],
    wind_direction_10m: [270, 270, 260, 250], precipitation_probability: [12, 6, 8, 5],
  },
};

test("parseDaily keys by date", () => {
  const d = parseDaily(sample);
  assert.equal(d["2026-06-20"].tMax, 20);
  assert.equal(d["2026-06-20"].gustMax, 40);
});

test("weatherAt matches the session's London hour (15:30 UTC = 16:30 BST -> 16:00)", () => {
  const hourly = parseHourly(sample);
  const wx = weatherAt(hourly, "2026-06-20T15:30:00+00:00");
  assert.equal(wx.temp, 19);       // the 16:00 London hour, not 15:00
  assert.equal(wx.windSpeed, 19);
});

test("attachWeather sets slot.weather at the London hour (16:00 UTC = 17:00 BST)", () => {
  const hourly = parseHourly(sample);
  const slots = [{ start: "2026-06-20T16:00:00+00:00", weather: null }];
  attachWeather(slots, hourly);
  assert.equal(slots[0].weather.temp, 18); // the 17:00 London hour
});

test("fetchForecast requests Hove daily+hourly and returns parsed shape", async () => {
  let calledUrl = "";
  const stubFetch = async (url) => {
    calledUrl = url;
    return { ok: true, json: async () => sample };
  };
  const out = await fetchForecast(50.827, -0.171, stubFetch);
  assert.match(calledUrl, /latitude=50.827/);
  assert.match(calledUrl, /hourly=/);
  assert.equal(out.daily["2026-06-20"].tMax, 20);
  assert.equal(out.hourly[1].temp, 20);
});
