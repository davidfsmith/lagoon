# Lagoon PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v1 read-only Lagoon wakeboarding companion PWA — login, your bookings/membership/ride-pass tokens, and an availability agenda with weather (per day and per session-hour), as a self-contained static web app.

**Architecture:** A static, no-build PWA (`app/`) of ES-module JavaScript. Pure logic (slot parsing, weather merge, booking cross-reference, agenda building) lives in dependency-free modules unit-tested with Node's built-in test runner. Thin fetch wrappers call the public Lagoon API and Open-Meteo directly from the browser (CORS is open). Views render DOM from the model output. Token in `localStorage`; service worker for offline/instant open.

**Tech Stack:** Vanilla JS (ES modules), Node 18+ built-in test runner (`node --test`), no dependencies, no build step. Reference pattern: `daves-adventures/site/static/compose`.

**Spec:** `docs/superpowers/specs/2026-06-14-lagoon-pwa-design.md`

---

## File Structure

```
app/
  index.html            # app shell: header, <main id="view">, bottom nav
  manifest.json         # PWA manifest (standalone, dark theme)
  sw.js                 # service worker (network-first HTML, cache-first assets)
  icon.svg              # app icon
  package.json          # type:module, test script (no deps)
  js/
    config.js           # constants: API base, courses, Hove coords, horizon
    api.js              # Lagoon client: login, authedGet, getCourseRuns
    weather.js          # Open-Meteo: parseDaily/parseHourly, weatherAt, attachWeather, fetchForecast
    model.js            # pure: runsToSlots, bookingKeys, markBooked, membership flags, groupByDay
    agendaModel.js      # pure: buildAgenda() — composes model + weather into DayGroup[]
    store.js            # token + cache in localStorage
    data.js             # loadEverything(token) — orchestrates fetches (browser only)
    app.js              # boot + tiny router + nav
    views/
      login.js
      agenda.js
      day.js
      account.js
  test/
    model.test.js
    weather.test.js
    api.test.js
    store.test.js
    agendaModel.test.js
```

**Data shapes (used consistently across tasks):**

```js
// Slot
{ courseId:50, label:"Tech 30", start:"2026-06-21T15:30:00+00:00", end:"...",
  free:2, capacity:2, key:"50@2026-06-21T15:30:00+00:00",
  booked:false, freeWithMembership:false, weather:null /* WeatherHour|null */ }

// WeatherDay (value in `daily` map, keyed by "YYYY-MM-DD")
{ code, tMin, tMax, precipProb, precipSum, windMax, gustMax, windDir, sunrise, sunset }

// WeatherHour (item in `hourly` array)
{ time:"2026-06-21T15:00", temp, code, windSpeed, windDir, gust, precipProb }

// DayGroup
{ date:"2026-06-21", weekend:true, summary:WeatherDay|null, slots:[Slot,...] }
```

**Key invariant:** the Lagoon API emits session times as UK wall-clock with a `+00:00` offset (even in BST); Open-Meteo returns offset-less local hours. Always match weather to a session by the literal `iso.slice(0,13)` (`"YYYY-MM-DDTHH"`) — never via `Date` parsing — or matches drift one hour in summer.

**Runnability note:** the automated unit tests (Tasks 2–10) are independent and pass as you build. The browser app, however, only loads end-to-end once **all four views exist** — `app.js` (Task 11) statically imports `login`/`agenda`/`day`/`account`, so a missing view breaks the module graph. Treat the "manual verify" steps in Tasks 12–15 as cumulative: they become runnable from **Task 15** onward, and Task 17 is the full acceptance pass. Don't expect a working UI between Tasks 11 and 14.

---

## Task 1: Scaffold & test runner

**Files:**
- Create: `app/package.json`
- Create: `app/js/config.js`
- Create: `app/test/smoke.test.js`

- [ ] **Step 1: Create `app/package.json`**

```json
{
  "name": "lagoon-app",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Create `app/js/config.js`**

```js
export const API_BASE = "https://api.lagoon.co.uk";
export const WX_URL = "https://api.open-meteo.com/v1/forecast";
export const HOVE = { lat: 50.827, lon: -0.171 };
export const HORIZON_DAYS = 21;
export const COURSES = [
  { id: 50, label: "Tech 30" },
  { id: 51, label: "Air 30" },
];
export const BOOKING_SITE = "https://booking.lagoon.co.uk";
```

- [ ] **Step 3: Create `app/test/smoke.test.js`**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { COURSES } from "../js/config.js";

test("config exposes monitored courses", () => {
  assert.equal(COURSES.length, 2);
  assert.deepEqual(COURSES.map(c => c.id), [50, 51]);
});
```

- [ ] **Step 4: Run tests**

Run: `cd app && node --test`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add app/package.json app/js/config.js app/test/smoke.test.js
git commit -m "feat(app): scaffold static PWA project + node test runner"
```

---

## Task 2: model — runsToSlots

**Files:**
- Create: `app/js/model.js`
- Create: `app/test/model.test.js`

- [ ] **Step 1: Write the failing test** (`app/test/model.test.js`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { runsToSlots, slotKey } from "../js/model.js";

const now = new Date("2026-06-14T12:00:00+00:00");

test("runsToSlots keeps upcoming runs with free space inside horizon", () => {
  const runs = [
    { startDate: "2026-06-10T15:00:00+00:00", endDate: "2026-06-10T15:30:00+00:00", maxNumbers: 2, participantsCount: 0 }, // past
    { startDate: "2026-06-14T15:30:00+00:00", endDate: "2026-06-14T16:00:00+00:00", maxNumbers: 2, participantsCount: 1 }, // free 1
    { startDate: "2026-06-15T17:00:00+00:00", endDate: "2026-06-15T17:30:00+00:00", maxNumbers: 2, participantsCount: 2 }, // full
    { startDate: "2026-09-01T10:00:00+00:00", endDate: "2026-09-01T10:30:00+00:00", maxNumbers: 2, participantsCount: 0 }, // beyond horizon
  ];
  const slots = runsToSlots(runs, 50, "Tech 30", now, 21);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].key, slotKey(50, "2026-06-14T15:30:00+00:00"));
  assert.equal(slots[0].free, 1);
  assert.equal(slots[0].capacity, 2);
  assert.equal(slots[0].label, "Tech 30");
  assert.equal(slots[0].booked, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && node --test test/model.test.js`
Expected: FAIL — cannot find module `../js/model.js`.

- [ ] **Step 3: Write minimal implementation** (`app/js/model.js`)

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && node --test test/model.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/js/model.js app/test/model.test.js
git commit -m "feat(app): model.runsToSlots — courseRuns to free upcoming slots"
```

---

## Task 3: model — booking cross-reference

**Files:**
- Modify: `app/js/model.js`
- Modify: `app/test/model.test.js`

- [ ] **Step 1: Add failing tests** (append to `app/test/model.test.js`)

```js
import { bookingKeys, markBooked } from "../js/model.js";

test("bookingKeys extracts active booking keys, skipping cancelled", () => {
  const meBookings = [
    { status: "confirmed", courseRun: { course: { id: 50 }, startDate: "2026-06-21T15:30:00+00:00" } },
    { status: "cancelled", courseRun: { course: { id: 51 }, startDate: "2026-06-22T15:30:00+00:00" } },
  ];
  const keys = bookingKeys(meBookings);
  assert.ok(keys.has("50@2026-06-21T15:30:00+00:00"));
  assert.equal(keys.has("51@2026-06-22T15:30:00+00:00"), false);
});

test("markBooked flags slots whose key is in the booking set", () => {
  const slots = [
    { key: "50@2026-06-21T15:30:00+00:00", booked: false },
    { key: "51@2026-06-22T15:30:00+00:00", booked: false },
  ];
  markBooked(slots, new Set(["50@2026-06-21T15:30:00+00:00"]));
  assert.equal(slots[0].booked, true);
  assert.equal(slots[1].booked, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && node --test test/model.test.js`
Expected: FAIL — `bookingKeys`/`markBooked` not exported.

- [ ] **Step 3: Implement** (append to `app/js/model.js`)

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && node --test test/model.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/js/model.js app/test/model.test.js
git commit -m "feat(app): model booking cross-reference (bookingKeys, markBooked)"
```

---

## Task 4: model — membership free-course flags

**Files:**
- Modify: `app/js/model.js`
- Modify: `app/test/model.test.js`

- [ ] **Step 1: Add failing tests**

```js
import { membershipFreeCourseIds, applyMembershipFree } from "../js/model.js";

test("membershipFreeCourseIds collects freeCourses ids from active memberships", () => {
  const meMemberships = [
    { status: "active", membershipType: { freeCourses: [{ id: 50 }, { id: 51 }, { id: 66 }] } },
    { status: "expired", membershipType: { freeCourses: [{ id: 99 }] } },
  ];
  const ids = membershipFreeCourseIds(meMemberships);
  assert.ok(ids.has(50) && ids.has(51));
  assert.equal(ids.has(99), false);
});

test("applyMembershipFree flags slots whose course is free", () => {
  const slots = [{ courseId: 50, freeWithMembership: false }, { courseId: 99, freeWithMembership: false }];
  applyMembershipFree(slots, new Set([50]));
  assert.equal(slots[0].freeWithMembership, true);
  assert.equal(slots[1].freeWithMembership, false);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd app && node --test test/model.test.js`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement** (append to `app/js/model.js`)

```js
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
```

- [ ] **Step 4: Run to verify pass**

Run: `cd app && node --test test/model.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/js/model.js app/test/model.test.js
git commit -m "feat(app): model membership free-course flags"
```

---

## Task 5: model — groupByDay

**Files:**
- Modify: `app/js/model.js`
- Modify: `app/test/model.test.js`

- [ ] **Step 1: Add failing test**

```js
import { groupByDay } from "../js/model.js";

test("groupByDay groups slots by date, sorts, flags weekends, attaches summary", () => {
  const slots = [
    { start: "2026-06-21T15:30:00+00:00", key: "a" }, // Sunday
    { start: "2026-06-20T13:00:00+00:00", key: "b" }, // Saturday
    { start: "2026-06-20T11:00:00+00:00", key: "c" }, // Saturday earlier
  ];
  const daily = { "2026-06-20": { tMax: 20 } };
  const days = groupByDay(slots, daily);
  assert.deepEqual(days.map(d => d.date), ["2026-06-20", "2026-06-21"]);
  assert.equal(days[0].weekend, true);
  assert.deepEqual(days[0].slots.map(s => s.key), ["c", "b"]); // sorted by time
  assert.deepEqual(days[0].summary, { tMax: 20 });
  assert.equal(days[1].summary, null);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd app && node --test test/model.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement** (append to `app/js/model.js`)

```js
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
```

- [ ] **Step 4: Run to verify pass**

Run: `cd app && node --test test/model.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/js/model.js app/test/model.test.js
git commit -m "feat(app): model groupByDay with weekend flag + day summary"
```

---

## Task 6: weather — parse & per-hour lookup

**Files:**
- Create: `app/js/weather.js`
- Create: `app/test/weather.test.js`

- [ ] **Step 1: Write failing test** (`app/test/weather.test.js`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDaily, parseHourly, weatherAt, attachWeather } from "../js/weather.js";

const sample = {
  daily: {
    time: ["2026-06-20"], weather_code: [3],
    temperature_2m_max: [20], temperature_2m_min: [15],
    precipitation_probability_max: [10], precipitation_sum: [0],
    wind_speed_10m_max: [20], wind_gusts_10m_max: [40], wind_direction_10m_dominant: [225],
    sunrise: ["2026-06-20T04:50"], sunset: ["2026-06-20T21:18"],
  },
  hourly: {
    time: ["2026-06-20T14:00", "2026-06-20T15:00", "2026-06-20T16:00"],
    temperature_2m: [19, 20, 19], weather_code: [3, 1, 3],
    wind_speed_10m: [24, 21, 19], wind_gusts_10m: [44, 41, 39],
    wind_direction_10m: [270, 270, 260], precipitation_probability: [12, 6, 8],
  },
};

test("parseDaily keys by date", () => {
  const d = parseDaily(sample);
  assert.equal(d["2026-06-20"].tMax, 20);
  assert.equal(d["2026-06-20"].gustMax, 40);
});

test("weatherAt matches by literal YYYY-MM-DDTHH (15:30 -> 15:00 hour)", () => {
  const hourly = parseHourly(sample);
  const wx = weatherAt(hourly, "2026-06-20T15:30:00+00:00");
  assert.equal(wx.temp, 20);
  assert.equal(wx.windSpeed, 21);
});

test("attachWeather sets slot.weather", () => {
  const hourly = parseHourly(sample);
  const slots = [{ start: "2026-06-20T16:00:00+00:00", weather: null }];
  attachWeather(slots, hourly);
  assert.equal(slots[0].weather.temp, 19);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd app && node --test test/weather.test.js`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** (`app/js/weather.js`)

```js
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
```

- [ ] **Step 4: Run to verify pass**

Run: `cd app && node --test test/weather.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/js/weather.js app/test/weather.test.js
git commit -m "feat(app): weather parse + literal-hour matching"
```

---

## Task 7: weather — fetchForecast

**Files:**
- Modify: `app/js/weather.js`
- Modify: `app/test/weather.test.js`

- [ ] **Step 1: Add failing test** (uses a stub fetch — no network)

```js
import { fetchForecast } from "../js/weather.js";

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
```

- [ ] **Step 2: Run to verify fail**

Run: `cd app && node --test test/weather.test.js`
Expected: FAIL — `fetchForecast` not exported.

- [ ] **Step 3: Implement** (append to `app/js/weather.js`)

```js
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
```

- [ ] **Step 4: Run to verify pass**

Run: `cd app && node --test test/weather.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/js/weather.js app/test/weather.test.js
git commit -m "feat(app): weather.fetchForecast (Open-Meteo, injectable fetch)"
```

---

## Task 8: api — login, authedGet, getCourseRuns

**Files:**
- Create: `app/js/api.js`
- Create: `app/test/api.test.js`

- [ ] **Step 1: Write failing test** (stub fetch)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { login, authedGet, getCourseRuns } from "../js/api.js";

test("login posts {email,password} and returns token", async () => {
  let body, url;
  const stub = async (u, opts) => { url = u; body = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ status: "ok", token: "JWT123" }) }; };
  const token = await login("a@b.com", "pw", stub);
  assert.match(url, /\/login$/);
  assert.deepEqual(body, { email: "a@b.com", password: "pw" });
  assert.equal(token, "JWT123");
});

test("authedGet sends bearer header and throws coded error on 401", async () => {
  const stub = async (u, opts) => {
    assert.equal(opts.headers.Authorization, "Bearer JWT123");
    return { status: 401, ok: false };
  };
  await assert.rejects(() => authedGet("me", "JWT123", stub), (e) => e.code === 401);
});

test("getCourseRuns paginates until past horizon", async () => {
  const page1 = { meta: { itemsPerPage: 2, filteredCount: 4 },
    data: [{ startDate: "2026-06-14T10:00:00+00:00" }, { startDate: "2026-06-15T10:00:00+00:00" }] };
  const page2 = { meta: { itemsPerPage: 2, filteredCount: 4 },
    data: [{ startDate: "2026-06-16T10:00:00+00:00" }, { startDate: "2026-09-01T10:00:00+00:00" }] };
  const stub = async (u) => ({ ok: true, json: async () => (u.includes("page=2") ? page2 : page1) });
  const runs = await getCourseRuns(50, "2026-07-05T00:00:00+00:00", stub);
  assert.equal(runs.length, 4); // stops after page 2 (last run beyond horizon)
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd app && node --test test/api.test.js`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** (`app/js/api.js`)

```js
import { API_BASE } from "./config.js";

export async function login(email, password, fetchImpl = fetch) {
  const res = await fetchImpl(`${API_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error("login " + res.status);
  const data = await res.json();
  if (data.status !== "ok" || !data.token) throw new Error("login rejected");
  return data.token;
}

export async function authedGet(path, token, fetchImpl = fetch) {
  const res = await fetchImpl(`${API_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) { const e = new Error("unauthorized"); e.code = 401; throw e; }
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

// Paginate ascending runs until we pass horizonISO or exhaust results.
export async function getCourseRuns(courseId, horizonISO, fetchImpl = fetch) {
  let page = 1; const all = [];
  for (;;) {
    const res = await fetchImpl(`${API_BASE}/public/courseRuns?course=${courseId}&itemsPerPage=100&page=${page}`);
    if (!res.ok) throw new Error("courseRuns " + res.status);
    const json = await res.json();
    const data = json.data || [];
    all.push(...data);
    const meta = json.meta || {};
    const last = data[data.length - 1];
    if (!data.length) break;
    if (last && last.startDate > horizonISO) break;
    if (page * (meta.itemsPerPage || 100) >= (meta.filteredCount || 0)) break;
    page++;
  }
  return all;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd app && node --test test/api.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/js/api.js app/test/api.test.js
git commit -m "feat(app): api client — login, authedGet, paginated getCourseRuns"
```

---

## Task 9: store — token & cache

**Files:**
- Create: `app/js/store.js`
- Create: `app/test/store.test.js`

- [ ] **Step 1: Write failing test** (with a `localStorage` shim)

```js
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

beforeEach(() => {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
});

test("token round-trips and clears", async () => {
  const { getToken, setToken, clearToken } = await import("../js/store.js");
  assert.equal(getToken(), null);
  setToken("JWT");
  assert.equal(getToken(), "JWT");
  clearToken();
  assert.equal(getToken(), null);
});

test("cache saves and loads JSON", async () => {
  const { saveCache, loadCache } = await import("../js/store.js");
  saveCache({ hi: 1 });
  assert.deepEqual(loadCache().data, { hi: 1 });
  assert.equal(typeof loadCache().at, "number");
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd app && node --test test/store.test.js`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** (`app/js/store.js`)

```js
const TOKEN_KEY = "lagoon.token";
const CACHE_KEY = "lagoon.cache";

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); }

export function saveCache(data) {
  localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
}
export function loadCache() {
  const raw = localStorage.getItem(CACHE_KEY);
  return raw ? JSON.parse(raw) : null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd app && node --test test/store.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/js/store.js app/test/store.test.js
git commit -m "feat(app): store — token + cached payloads in localStorage"
```

---

## Task 10: agendaModel — buildAgenda (compose everything, pure)

**Files:**
- Create: `app/js/agendaModel.js`
- Create: `app/test/agendaModel.test.js`

- [ ] **Step 1: Write failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAgenda } from "../js/agendaModel.js";

const now = new Date("2026-06-14T08:00:00+00:00");
const runsByCourse = {
  50: [{ startDate: "2026-06-20T13:00:00+00:00", endDate: "2026-06-20T13:30:00+00:00", maxNumbers: 2, participantsCount: 0 }],
  51: [{ startDate: "2026-06-20T15:00:00+00:00", endDate: "2026-06-20T15:30:00+00:00", maxNumbers: 2, participantsCount: 1 }],
};
const meBookings = [{ status: "confirmed", courseRun: { course: { id: 50 }, startDate: "2026-06-20T13:00:00+00:00" } }];
const meMemberships = [{ status: "active", membershipType: { freeCourses: [{ id: 50 }, { id: 51 }] } }];
const weather = {
  daily: { "2026-06-20": { tMax: 20, tMin: 15 } },
  hourly: [
    { time: "2026-06-20T13:00", temp: 18 },
    { time: "2026-06-20T15:00", temp: 20 },
  ],
};

test("buildAgenda merges slots, weather, bookings and membership flags", () => {
  const days = buildAgenda({ runsByCourse, courses: [{ id: 50, label: "Tech 30" }, { id: 51, label: "Air 30" }],
    meBookings, meMemberships, weather, now, horizonDays: 21 });
  assert.equal(days.length, 1);
  const d = days[0];
  assert.equal(d.date, "2026-06-20");
  assert.equal(d.weekend, true);
  assert.equal(d.summary.tMax, 20);
  assert.equal(d.slots.length, 2);
  const tech = d.slots.find(s => s.courseId === 50);
  assert.equal(tech.booked, true);
  assert.equal(tech.freeWithMembership, true);
  assert.equal(tech.weather.temp, 18);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd app && node --test test/agendaModel.test.js`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** (`app/js/agendaModel.js`)

```js
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
```

- [ ] **Step 4: Run to verify pass**

Run: `cd app && node --test test/agendaModel.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/js/agendaModel.js app/test/agendaModel.test.js
git commit -m "feat(app): buildAgenda — compose slots+weather+bookings+membership"
```

---

## Task 11: data orchestration + app shell + router

**Files:**
- Create: `app/js/data.js`
- Create: `app/index.html`
- Create: `app/js/app.js`

- [ ] **Step 1: Create `app/js/data.js`** (browser-only orchestration; not unit-tested)

```js
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
```

- [ ] **Step 2: Create `app/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Hove Lagoon</title>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#0d0d0d">
  <link rel="manifest" href="manifest.json">
  <link rel="apple-touch-icon" href="icon.svg">
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin:0; background:#0d0d0d; color:#e8eaed; font-family:-apple-system,Roboto,system-ui,sans-serif; }
    header { padding:14px 16px; font-weight:600; font-size:17px; border-bottom:1px solid #23262c; position:sticky; top:0; background:#0d0d0d; }
    header .accent { color:#2dd4bf; }
    main { padding:14px 14px 80px; max-width:560px; margin:0 auto; }
    nav { position:fixed; bottom:0; left:0; right:0; display:flex; background:#111418; border-top:1px solid #23262c; }
    nav button { flex:1; background:none; border:none; color:#9aa0a6; padding:12px; font-size:13px; }
    nav button.active { color:#2dd4bf; }
    .stale { background:#3a2a12; color:#fbbf24; font-size:12px; padding:6px 10px; border-radius:8px; margin-bottom:10px; }
    .muted { color:#9aa0a6; } .err { color:#f87171; }
    button.primary { background:#2dd4bf; color:#06251f; border:none; border-radius:8px; padding:10px 14px; font-weight:600; }
    input { width:100%; padding:11px; border-radius:8px; border:1px solid #2a2d33; background:#16181c; color:#e8eaed; margin-bottom:10px; }
  </style>
</head>
<body>
  <header>🏄 <span class="accent">Hove Lagoon</span></header>
  <main id="view"></main>
  <nav id="nav" hidden>
    <button data-route="agenda" class="active">Agenda</button>
    <button data-route="account">Account</button>
  </nav>
  <script type="module" src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create `app/js/app.js`**

```js
import { getToken, clearToken, saveCache, loadCache } from "./store.js";
import { loadEverything } from "./data.js";
import { renderLogin } from "./views/login.js";
import { renderAgenda } from "./views/agenda.js";
import { renderDay } from "./views/day.js";
import { renderAccount } from "./views/account.js";

const view = document.getElementById("view");
const nav = document.getElementById("nav");
let state = null; // { me, meBookings, memberships, packages, agenda, stale }

function setActiveNav(route) {
  nav.hidden = false;
  for (const b of nav.querySelectorAll("button")) b.classList.toggle("active", b.dataset.route === route);
}

export function go(route, arg) {
  if (route === "login") { nav.hidden = true; renderLogin(view, onLoggedIn); return; }
  if (!state) return;
  if (route === "agenda") { setActiveNav("agenda"); renderAgenda(view, state, go); }
  else if (route === "day") { setActiveNav("agenda"); renderDay(view, state, arg, go); }
  else if (route === "account") { setActiveNav("account"); renderAccount(view, state, go); }
}

nav.addEventListener("click", (e) => { const r = e.target.dataset.route; if (r) go(r); });

async function onLoggedIn() { await loadAndRender(); }

export function logout() { clearToken(); state = null; go("login"); }

async function loadAndRender() {
  view.innerHTML = `<p class="muted">Loading…</p>`;
  const token = getToken();
  try {
    const data = await loadEverything(token);
    state = { ...data, stale: false };
    saveCache(data);
    go("agenda");
  } catch (e) {
    if (e.code === 401) { logout(); return; }
    const cached = loadCache();
    if (cached) { state = { ...cached.data, stale: true }; go("agenda"); }
    else view.innerHTML = `<p class="err">Couldn't load: ${e.message}</p>`;
  }
}

// boot
if (getToken()) loadAndRender(); else go("login");
```

- [ ] **Step 4: Manual smoke (deferred to Task 16)** — no automated test for DOM here.

Run: `cd app && python3 -m http.server 8077` then open `http://localhost:8077` — expect the login screen (Task 12 implements it; until then the view stays blank, which is fine at this step).

- [ ] **Step 5: Commit**

```bash
git add app/js/data.js app/index.html app/js/app.js
git commit -m "feat(app): data orchestration + app shell + router"
```

---

## Task 12: view — login

**Files:**
- Create: `app/js/views/login.js`

- [ ] **Step 1: Implement** (`app/js/views/login.js`)

```js
import { login } from "../api.js";
import { setToken } from "../store.js";

export function renderLogin(view, onLoggedIn) {
  view.innerHTML = `
    <h2>Sign in</h2>
    <p class="muted">Your Lagoon account. Only a token is stored on this device.</p>
    <input id="email" type="email" placeholder="Email" autocomplete="username">
    <input id="password" type="password" placeholder="Password" autocomplete="current-password">
    <button class="primary" id="signin">Sign in</button>
    <p id="err" class="err"></p>`;
  const err = view.querySelector("#err");
  view.querySelector("#signin").addEventListener("click", async () => {
    err.textContent = "";
    const email = view.querySelector("#email").value.trim();
    const password = view.querySelector("#password").value;
    if (!email || !password) { err.textContent = "Enter email and password."; return; }
    try {
      const token = await login(email, password);
      setToken(token);
      await onLoggedIn();
    } catch (e) { err.textContent = "Sign-in failed. Check your details."; }
  });
}
```

- [ ] **Step 2: Manual verify**

Run: `cd app && python3 -m http.server 8077`, open `http://localhost:8077`, sign in with real Lagoon credentials.
Expected: on success, the agenda loads (Task 13). On bad credentials, "Sign-in failed" shows.

- [ ] **Step 3: Commit**

```bash
git add app/js/views/login.js
git commit -m "feat(app): login view"
```

---

## Task 13: view — agenda

**Files:**
- Create: `app/js/views/agenda.js`

- [ ] **Step 1: Implement** (`app/js/views/agenda.js`)

```js
import { wcEmoji, fmtDate } from "./format.js";

export function renderAgenda(view, state, go) {
  const days = state.agenda || [];
  const stale = state.stale ? `<div class="stale">Showing saved data — couldn't refresh.</div>` : "";
  if (!days.length) {
    view.innerHTML = `${stale}<h2>Agenda</h2><p class="muted">No free sessions in the next 21 days.</p>`;
    return;
  }
  view.innerHTML = `${stale}<h2>Free sessions</h2>` + days.map(d => {
    const bookable = d.slots.filter(s => !s.booked);
    const w = d.summary;
    const wx = w ? `${wcEmoji(w.code)} ${Math.round(w.tMin)}–${Math.round(w.tMax)}° · ☔${w.precipProb}% · 🌬${Math.round(w.windMax)}(${Math.round(w.gustMax)})` : "";
    const chips = d.slots.map(s =>
      `<span class="chip${s.booked ? " booked" : ""}">${s.start.slice(11, 16)} ${s.label}${s.booked ? " ✓" : ` <b>${s.free}</b>`}</span>`
    ).join("");
    return `<button class="day" data-date="${d.date}">
      <div class="day-hd"><span>${fmtDate(d.date)}${d.weekend ? ' <em>WKND</em>' : ''}</span><span class="muted">${wx}</span></div>
      <div class="chips">${chips}</div>
      ${bookable.length ? "" : '<div class="muted small">all booked / full</div>'}
    </button>`;
  }).join("");
  for (const el of view.querySelectorAll(".day")) {
    el.addEventListener("click", () => go("day", el.dataset.date));
  }
  injectAgendaStyles();
}

function injectAgendaStyles() {
  if (document.getElementById("agenda-css")) return;
  const s = document.createElement("style"); s.id = "agenda-css";
  s.textContent = `
    .day{display:block;width:100%;text-align:left;background:#16181c;border:none;border-radius:14px;padding:12px;margin-bottom:10px;color:inherit}
    .day-hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-weight:600}
    .day-hd em{color:#2dd4bf;font-size:10px;font-style:normal}
    .chips{display:flex;flex-wrap:wrap;gap:6px}
    .chip{background:#13241f;border:1px solid #2dd4bf44;color:#cfeee7;border-radius:8px;padding:4px 8px;font-size:12px}
    .chip b{color:#fff}.chip.booked{background:#1a1d22;border-color:#333;color:#9aa0a6}
    .small{font-size:11px;margin-top:6px}`;
  document.head.appendChild(s);
}
```

- [ ] **Step 2: Create `app/js/views/format.js`** (shared formatters)

```js
export function fmtDate(date) {
  return new Date(date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
// WMO weather code -> emoji (coarse buckets)
export function wcEmoji(code) {
  if (code === 0) return "☀️";
  if (code <= 2) return "🌤";
  if (code === 3) return "☁️";
  if (code <= 48) return "🌫";
  if (code <= 67) return "🌦";
  if (code <= 77) return "🌨";
  if (code <= 82) return "🌧";
  return "⛈";
}
```

- [ ] **Step 3: Manual verify**

Run: refresh `http://localhost:8077` while logged in.
Expected: a scroll of day cards with weather summaries and session chips; weekends tagged; booked sessions greyed with ✓.

- [ ] **Step 4: Commit**

```bash
git add app/js/views/agenda.js app/js/views/format.js
git commit -m "feat(app): agenda view + shared formatters"
```

---

## Task 14: view — day detail

**Files:**
- Create: `app/js/views/day.js`

- [ ] **Step 1: Implement** (`app/js/views/day.js`)

```js
import { wcEmoji, fmtDate } from "./format.js";
import { BOOKING_SITE } from "../config.js";

export function renderDay(view, state, date, go) {
  const day = (state.agenda || []).find(d => d.date === date);
  if (!day) { go("agenda"); return; }
  const w = day.summary;
  const head = w
    ? `${wcEmoji(w.code)} ${Math.round(w.tMin)}–${Math.round(w.tMax)}° · rain ${w.precipProb}% · wind ${Math.round(w.windMax)} (gust ${Math.round(w.gustMax)}) km/h · sunset ${(w.sunset || "").slice(11, 16)}`
    : "weather unavailable";

  const rows = day.slots.map(s => {
    const wx = s.weather ? `${wcEmoji(s.weather.code)} ${Math.round(s.weather.temp)}° · wind ${Math.round(s.weather.windSpeed)} · rain ${s.weather.precipProb}%` : "";
    const right = s.booked
      ? `<span class="tag">✓ You're booked</span>`
      : `<span class="free">${s.free} free</span>${s.freeWithMembership ? '<span class="mem">free w/ membership</span>' : ''}<a class="bk" target="_blank" rel="noopener" href="${BOOKING_SITE}">Book ↗</a>`;
    return `<div class="srow${s.booked ? " booked" : ""}">
      <div><div class="tm">${s.start.slice(11, 16)} <b>${s.label}</b></div><div class="muted small">${wx}</div></div>
      <div class="r">${right}</div></div>`;
  }).join("");

  view.innerHTML = `
    <button class="link" id="back">‹ Back</button>
    <h2>${fmtDate(date)}${day.weekend ? ' · weekend' : ''}</h2>
    <p class="muted small">${head}</p>
    <div class="lbl">Sessions</div>${rows}`;
  view.querySelector("#back").addEventListener("click", () => go("agenda"));
  injectDayStyles();
}

function injectDayStyles() {
  if (document.getElementById("day-css")) return;
  const s = document.createElement("style"); s.id = "day-css";
  s.textContent = `
    .link{background:none;border:none;color:#2dd4bf;padding:0;margin-bottom:4px;font-size:14px}
    .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;margin:14px 0 8px}
    .srow{display:flex;justify-content:space-between;align-items:center;background:#16181c;border-radius:12px;padding:11px 12px;margin-bottom:8px}
    .srow.booked{opacity:.7}.tm{font-weight:600}.tm b{color:#2dd4bf}
    .r{text-align:right;display:flex;flex-direction:column;gap:4px;align-items:flex-end}
    .free{color:#34d399;font-size:12px}.mem{color:#9aa0a6;font-size:10px}.tag{color:#fbbf24;font-size:12px}
    .bk{background:#2dd4bf;color:#06251f;border-radius:7px;padding:4px 12px;font-size:12px;font-weight:600;text-decoration:none}
    .small{font-size:11px}`;
  document.head.appendChild(s);
}
```

- [ ] **Step 2: Manual verify**

Tap a day in the agenda.
Expected: day summary, per-session rows with weather-at-time, "free w/ membership" where applicable, Book ↗ opening the booking site in a new tab, booked sessions greyed.

- [ ] **Step 3: Commit**

```bash
git add app/js/views/day.js
git commit -m "feat(app): day-detail view with per-session weather"
```

---

## Task 15: view — account

**Files:**
- Create: `app/js/views/account.js`

- [ ] **Step 1: Implement** (`app/js/views/account.js`)

```js
import { fmtDate } from "./format.js";
import { logout } from "../app.js";

export function renderAccount(view, state) {
  const m = (state.memberships || [])[0];
  const memHtml = m
    ? `<div class="card"><div class="t">Membership</div>
        <div>${(m.membershipType && m.membershipType.name) || "Member"} · <b>${m.status}</b></div>
        <div class="muted small">expires ${m.expiryDate ? fmtDate(m.expiryDate.slice(0,10)) : "—"}</div></div>`
    : `<div class="card muted">No membership found.</div>`;

  const passes = (state.packages || []).filter(p => (p.remainTokens || 0) > 0);
  const passHtml = passes.length
    ? `<div class="card"><div class="t">Ride passes</div>` + passes.map(p =>
        `<div>${(p.package && p.package.title) || "Pass"} — <b>${p.remainTokens}</b>/${p.totalTokens} left</div>`).join("") + `</div>`
    : `<div class="card muted">No ride-pass tokens remaining.</div>`;

  const upcoming = (state.meBookings || [])
    .filter(b => (b.status || "").toLowerCase() === "confirmed" && b.courseRun && b.courseRun.startDate >= new Date().toISOString())
    .sort((a, b) => a.courseRun.startDate < b.courseRun.startDate ? -1 : 1);
  const bkHtml = `<div class="card"><div class="t">Your upcoming bookings</div>` + (upcoming.length
    ? upcoming.map(b => `<div>${fmtDate(b.courseRun.startDate.slice(0,10))} ${b.courseRun.startDate.slice(11,16)} — ${(b.courseRun.course && b.courseRun.course.name) || ""}</div>`).join("")
    : `<div class="muted">None.</div>`) + `</div>`;

  view.innerHTML = `<h2>Account</h2>${memHtml}${passHtml}${bkHtml}
    <button class="primary" id="logout" style="margin-top:14px">Log out</button>`;
  view.querySelector("#logout").addEventListener("click", () => logout());
  injectAccountStyles();
}

function injectAccountStyles() {
  if (document.getElementById("acct-css")) return;
  const s = document.createElement("style"); s.id = "acct-css";
  s.textContent = `.card{background:#16181c;border-radius:14px;padding:12px;margin-bottom:10px}
    .card .t{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;margin-bottom:6px}
    .small{font-size:11px}`;
  document.head.appendChild(s);
}
```

- [ ] **Step 2: Manual verify against ground truth (2026-06-14)**

Tap **Account**.
Expected: membership active, expiry 06 Jul 2026; ride passes "Package – Learn to Wakeboard — 2/6 left"; upcoming bookings include Mon 15 Air, Tue 16 Tech, Fri 19 Skills Clinic, Sun 21 Tech.

- [ ] **Step 3: Commit**

```bash
git add app/js/views/account.js
git commit -m "feat(app): account view (membership, passes, bookings)"
```

---

## Task 16: PWA manifest, service worker, icon

**Files:**
- Create: `app/manifest.json`
- Create: `app/sw.js`
- Create: `app/icon.svg`
- Modify: `app/index.html` (register the service worker)

- [ ] **Step 1: Create `app/manifest.json`**

```json
{
  "name": "Hove Lagoon",
  "short_name": "Lagoon",
  "description": "Wakeboarding availability, your bookings and the weather at Hove Lagoon",
  "start_url": "./",
  "display": "standalone",
  "background_color": "#0d0d0d",
  "theme_color": "#0d0d0d",
  "icons": [
    { "src": "icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" }
  ]
}
```

- [ ] **Step 2: Create `app/icon.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#0d0d0d"/>
  <path d="M64 340c40 0 40 28 80 28s40-28 80-28 40 28 80 28 40-28 80-28 40 28 64 28" fill="none" stroke="#2dd4bf" stroke-width="22" stroke-linecap="round"/>
  <rect x="150" y="150" width="212" height="54" rx="27" transform="rotate(28 256 177)" fill="#2dd4bf"/>
</svg>
```

- [ ] **Step 3: Create `app/sw.js`**

```js
const CACHE = "lagoon-v1";
const ASSETS = ["./", "./index.html", "./manifest.json", "./icon.svg",
  "./js/app.js", "./js/config.js", "./js/api.js", "./js/weather.js", "./js/model.js",
  "./js/agendaModel.js", "./js/store.js", "./js/data.js",
  "./js/views/login.js", "./js/views/agenda.js", "./js/views/day.js", "./js/views/account.js", "./js/views/format.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.hostname.endsWith("lagoon.co.uk") || url.hostname.endsWith("open-meteo.com")) return; // never cache API
  if (url.pathname.endsWith("/") || url.pathname.endsWith(".html")) {
    e.respondWith(fetch(e.request).then(res => { const c = res.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return res; }).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(c => c || fetch(e.request)));
});
```

- [ ] **Step 4: Register SW in `app/index.html`** — add before the closing `</body>`, after the existing module script:

```html
  <script>if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js");</script>
```

- [ ] **Step 5: Manual verify**

Run: `cd app && python3 -m http.server 8077`, open in Chrome, DevTools → Application → Service Workers shows it active; offline reload still renders the shell + last cached data.

- [ ] **Step 6: Commit**

```bash
git add app/manifest.json app/sw.js app/icon.svg app/index.html
git commit -m "feat(app): PWA manifest, service worker, icon"
```

---

## Task 17: Full-run acceptance + README

**Files:**
- Create: `app/README.md`

- [ ] **Step 1: Run the whole test suite**

Run: `cd app && node --test`
Expected: PASS across `model`, `weather`, `api`, `store`, `agendaModel`, `smoke`.

- [ ] **Step 2: End-to-end manual acceptance**

Run: `cd app && python3 -m http.server 8077`, open `http://localhost:8077`:
1. Sign in with real credentials → agenda loads.
2. Agenda shows free Tech/Air 30 days with weather + chips; weekends tagged.
3. A day you're booked into shows the slot greyed with ✓ (cross-check Account → bookings: Mon 15 Air, Tue 16 Tech, Sun 21 Tech).
4. Tap a day → per-session weather + Book ↗ opens the booking site.
5. Account shows membership (expires 06 Jul 2026) + pass tokens (2/6).
6. DevTools offline → reload still renders cached agenda with a "saved data" badge.
7. Log out → returns to login; reload stays on login.

- [ ] **Step 3: Create `app/README.md`**

```markdown
# Hove Lagoon — PWA

Read-only companion: your bookings, membership, ride-pass tokens, and a weather-aware
availability agenda for Tech/Air 30 wakeboarding sessions. Static, no build step.

## Run
    cd app && python3 -m http.server 8077
    # open http://localhost:8077, sign in with your Lagoon account

## Test
    cd app && node --test

## Design
See ../docs/superpowers/specs/2026-06-14-lagoon-pwa-design.md

Booking is deep-linked to booking.lagoon.co.uk in v1; in-app (no-payment) booking is a
later phase. No card payments, ever.
```

- [ ] **Step 4: Commit**

```bash
git add app/README.md
git commit -m "docs(app): README + acceptance checklist"
```

---

## Self-review notes (addressed)

- **Spec coverage:** login (T12), bookings/membership/passes (T8/T15), availability agenda (T13), day-detail with hourly weather (T14), weather source (T6/T7), caching + offline (T16), error/401 + stale (T11), booking deep-link (T14), testing (T2–T10, T17). All spec sections map to tasks.
- **Type consistency:** `slotKey`/`key`, `Slot`/`WeatherHour`/`WeatherDay`/`DayGroup` shapes used identically across `model.js`, `weather.js`, `agendaModel.js`, and views. `authedGet` 401 → `e.code===401` handled in `app.js`.
- **No placeholders:** every code step is complete and runnable.
- **Known risk noted:** booking↔slot key match assumes identical `startDate` serialization between `me/bookings` and `public/courseRuns` (same backend, expected identical). Verified at acceptance step (T17.3).
```
