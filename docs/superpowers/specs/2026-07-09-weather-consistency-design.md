# Consistent weather rendering — design

**Date:** 2026-07-09
**Status:** approved, ready for implementation plan
**Area:** `app/` (PWA)

## Problem

The weather readout is inconsistent across views. Five inline variants exist for what
are really just **two** display shapes:

**Per-session line** (one hour, from `s.weather` / hourly forecast):
- `day.js` session rows — `🌤 18° · wind NE 15 · rain 20% · UV 4`
- `account.js` (Bookings) — same, via a local `wxLine` helper
- `lastminute.js` — same **but missing UV**

**Per-day summary line** (a min–max range, from `d.summary` / daily forecast):
- `agenda.js` list — `🌤 12–18° · ☔20% · 🌬NE 15(28) · UV 4` (emoji labels, wind dir, gust)
- `day.js` header — `🌤 12–18° · rain 20% · wind 15 (gust 28) km/h · UV 4 · sunset 21:14`
  (word labels, **no** wind dir, has sunset)

So neither shape is rendered the same way everywhere: sessions disagree on UV/gust, and
the two day summaries disagree on labels, wind direction, and sunset.

## Goal

One canonical format per shape, in two shared helpers, so every view shows the **same
level** of weather info **in the same manner** — and five inline variants collapse to two
helper calls (the "nice code optimisation").

## Decisions (from brainstorming)

- **Keep two shapes, not one.** A day summary is a range across the whole day; a session
  line is a single hour. They show genuinely different data, so they stay distinct — but
  each is rendered identically everywhere.
- **Emoji labels** for both (matches the current Availability list): `🌬` wind, `☔` rain,
  `🌇` sunset.
- **Session line gains wind gust and UV** everywhere (Last-minute was missing UV; no
  session line showed gust).
- **Day summary gains wind direction and sunset** on the Availability list, and switches
  the Day header from word labels to the emoji style.
- **UV labelled `UV n`, not `☀️UVn`** — a leading ☀️ collides with the sunny weather-code
  emoji (`wcEmoji(0)` is `☀️`), which would render two suns on a clear day.

## Canonical formats

**Session** — `sessionWx(w)` where `w` is an hourly-shaped object
(`code, temp, windSpeed, gust, windDir, precipProb, uv`):

```
🌤 18° · 🌬NE 15(28) · ☔20% · UV 4
```

`wcEmoji(code)` · `round(temp)°` · `🌬<dir> <round(windSpeed)>(<round(gust)>)` ·
`☔<precipProb>%` · `UV <round(uv)>`.
Wind direction prefix omitted when `windDirLabel` returns `""`; the `· UV n` segment
omitted when `uv == null`.

**Day** — `dayWx(w)` where `w` is a daily-shaped summary
(`code, tMin, tMax, precipProb, windMax, gustMax, windDir, uvMax, sunset`):

```
🌤 12–18° · 🌬NE 15(28) · ☔20% · UV 4 · 🌇21:14
```

`wcEmoji(code)` · `round(tMin)–round(tMax)°` · `🌬<dir> <round(windMax)>(<round(gustMax)>)` ·
`☔<precipProb>%` · `UV <round(uvMax)>` · `🌇<sunset HH:MM>`.
The `· UV n` segment omitted when `uvMax == null`; the `· 🌇HH:MM` segment omitted when
`sunset` is absent.

Both helpers live in `app/js/views/format.js` beside `wcEmoji` / `windDirLabel`, and reuse
them. Both return `""` for a null/undefined argument (callers already guard with
`? ... : ""`).

## Changes

1. **`app/js/views/format.js`** — add `sessionWx(w)` and `dayWx(w)`.
2. **`app/js/views/lastminute.js`** — replace the inline session line with `sessionWx(s.weather)`.
3. **`app/js/views/day.js`** — replace the inline session line (rows) with `sessionWx(s.weather)`,
   and the header line with `dayWx(day.summary)`.
4. **`app/js/views/account.js`** — delete the local `wxLine`, use `sessionWx(...)`.
5. **`app/js/views/agenda.js`** — replace the inline day line with `dayWx(d.summary)`.
6. **Version bump** — `app/js/config.js` `APP_RELEASE` v48 → **v49**; `app/sw.js` `CACHE` →
   `lagoon-v49`. ASSETS list unchanged (no new files).

## Tests

`app/test/format.test.js` — pure string helpers, no network:
- `sessionWx`: full field set → exact string; `uv == null` → no UV segment; unknown wind
  dir → no dir prefix; `null` input → `""`.
- `dayWx`: full field set (with sunset) → exact string; `uvMax == null` → no UV;
  missing sunset → no sunset segment; `null` input → `""`.

## Out of scope

- No change to what weather data is fetched (`weather.js` already provides every field).
- No change to the agenda/session data model.
- No new gated features; unrelated to the beta/internal opt-in work.
