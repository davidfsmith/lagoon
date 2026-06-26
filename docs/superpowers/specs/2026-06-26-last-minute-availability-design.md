# Last-Minute Availability — Design

**Date:** 2026-06-26
**Status:** Approved (design); ready for implementation plan
**Author:** Dave + Claude

## Purpose

Return the app to its founding idea: **helping riders grab short-notice / just-freed
wakeboarding sessions at Hove Lagoon.** Today the app shows *all* live availability
across the 21-day horizon, but it doesn't make "what can I jump on right now?" or
"a spot just opened" stand out.

This is **Phase 1 — in-app surfacing.** It is entirely client-side (no backend) and
ships **beta-gated to Dave (id 9720) first** via the existing feature-flag system.

**Phase 2 (out of scope here):** push notifications when a spot opens while the app is
closed — driven by the AWS watcher (which already detects releases) + Web Push. That
is a separate sub-project with its own spec.

## What we're building

1. A dedicated **`🔥 Last-minute`** screen — a new bottom-nav destination showing
   free, soon, not-yet-started sessions, with a **Today / Weekend / 48h** window
   selector (default **Today**).
2. A **"just opened ↑"** badge on sessions that newly freed since the user's last
   successful load (client-side diff against the cached snapshot).
3. A configurable **Default page** setting (Last minute / Availability / Bookings)
   so the landing screen is the user's choice, defaulting to Last-minute for gated
   users and Availability for everyone else.

All three are gated by a single flag so non-gated users see **zero change**.

## Non-goals (YAGNI)

- No push/email/SMS notifications (that's Phase 2).
- No server, no new data source. The "just opened" signal comes only from diffing the
  user's own cached snapshot — it cannot see changes that happened while the app was
  closed. This limitation is intentional; no in-app messaging about it is needed, but
  the code comments must state it so future contributors don't mistake it for a bug.
- No new availability data: the agenda is already fetched live; this only re-presents
  a slice of it.

---

## 1. Feature gating

- Add `FEATURES.lastMinute = "internal"` in `config.js`. `internal` → allowed only for
  ids in `BETA_TESTERS` (`[9720]`), via the existing `isOn("lastMinute", state)`
  (`features.js`, unchanged). Later flip to `"beta"` or `"on"` to widen — no code change.
- Everything below keys off `isOn("lastMinute", state)`:
  - the nav button's visibility,
  - whether "Last minute" appears in the Default-page dropdown,
  - whether the `lastminute` route renders (else it degrades to `agenda`).

## 2. Navigation & landing (`app.js`, `index.html`)

### Nav button
- `index.html`: add a bottom-nav button `data-route="lastminute"` labelled `🔥
  Last-minute`, placed **first** (order: Last-minute · Availability · Bookings).
  Render it `hidden` by default.
- `app.js`, after a successful load (in `reload`, once `state` is set): reveal the
  button iff `isOn("lastMinute", state)`; otherwise keep it `hidden`.
- `go()` gains a `lastminute` route:
  - if `isOn("lastMinute", state)` → `setActiveNav("lastminute")` +
    `renderLastMinute(view, state, go)`,
  - else → fall through to `agenda` (safe degrade).

### Default landing
- Today `loadAndRender()` hard-codes `reload("agenda", true)`. Change so the **initial
  landing** is `getDefaultLanding(state)` (resolved *after* `state` exists, since the
  resolution depends on the gating + stored choice).
  - Implementation: `reload(target, showLoading)` treats `target === null` as "resolve
    default after load" — once `state` is built it computes
    `const t = target ?? getDefaultLanding(state)` and calls `go(t)`. `loadAndRender`
    calls `reload(null, true)`.
- Pull-to-refresh `refresh()`: add `lastminute` to the in-place set so refreshing on
  the Last-minute screen stays there:
  `const target = ["agenda","account","lastminute"].includes(currentRoute) ? currentRoute : "agenda";`

## 3. Default-page setting (`store.js`, `views/settings.js`)

### Storage (`store.js`)
- `LANDING_OPTIONS = [{ id: "lastminute", label: "Last minute" }, { id: "agenda",
  label: "Availability" }, { id: "account", label: "Bookings" }]`.
- `setDefaultLanding(id)` → `localStorage["lagoon.defaultLanding"] = id`.
- `getDefaultLanding(state)`:
  - read `raw = localStorage["lagoon.defaultLanding"]`,
  - valid if `raw` is one of the option ids **and** (`raw !== "lastminute"` OR
    `isOn("lastMinute", state)`),
  - if valid → return `raw`,
  - else → `isOn("lastMinute", state) ? "lastminute" : "agenda"`.
  - (`store.js` imports `isOn` from `features.js` and `FEATURES` indirectly; pass
    `state` in so it can evaluate gating.)
- Wrap `localStorage` access in try/catch like the other store helpers (private-mode
  safe), defaulting to the computed fallback.

### UI (`views/settings.js`, Settings tab)
- Under "Appearance", add a "Default page" `.set-row` with a `.set-select` dropdown
  (mirrors the existing "Default reminder time" control).
- Options = `LANDING_OPTIONS`, **filtered to drop `lastminute` unless
  `isOn("lastMinute", state)`**.
- Selected value = `getDefaultLanding(state)`.
- `change` handler → `setDefaultLanding(value)` (no re-render needed; takes effect next
  launch — the screen the user is on doesn't change underfoot).

## 4. The Last-minute view (`views/lastminute.js`)

`renderLastMinute(view, state, go)` — same shape as the other views (build HTML string,
set `innerHTML`, wire events, inject scoped `<style>` once).

### Window selector
- Three-button segmented control (reuse `.segbar`/`.seg` styling): **Today · Weekend ·
  48h**, default **Today**.
- Persisted: `localStorage["lagoon.lastMinuteWindow"]` via small helpers in `store.js`
  (`getLastMinuteWindow()` / `setLastMinuteWindow(w)`), default `"today"`.
- Clicking a window re-renders the view with the new selection.

### Session list
- Source: `state.agenda` (array of `{ date, weekend, summary, slots }`).
- Flatten to slots, then `sessionsInWindow(agenda, window, now)` (see §5) selects
  free, not-yet-started slots inside the window, sorted soonest-first.
- **Respects the existing type filter:** apply the shared `filters.js` selection
  (`getActiveTypes`) and render the shared filter chips (`filterBarHtml` +
  `wireFilterChips`) at the top, so the user can widen from the default Air 30 / Tech
  30 to "anything" in a tap — consistent with agenda/day.
- Each row shows: London time (`londonParts`), session label, free count, weather
  (`weatherAt(state.weather?.hourly, slot.start)`), a **Book** link to the booking
  site (`BOOKING_SITE` from `config.js`), and a **"just opened ↑"** badge when
  `state.justOpened.has(slot.key)`.
- Already-booked slots (`slot.booked`) still show but are visually marked "booked"
  (no Book link), matching agenda behaviour.

### Header & freshness
- `<h2>🔥 Last-minute</h2>` + a "Last refreshed `fmtWhen(state.refreshedAt)`
  `state.stale ? "(saved)" : ""`" line (same pattern as Settings/Availability).

### Empty state
- When no sessions match: `Nothing free <window> right now — pull to refresh, or
  browse everything in Availability.` where `<window>` ∈ {`today`, `this weekend`, `in
  the next 48h`}. The "Availability" word is a button calling `go("agenda")`.

## 5. "Just opened" detection & window logic (`model.js`)

Two **pure, DOM-free, testable** helpers added to `model.js`.

### `justOpenedKeys(prevAgenda, curAgenda) -> Set<string>`
- Build `prev = Map(slot.key -> slot.free)` from every slot in `prevAgenda` (handles
  `prevAgenda` null/undefined → empty map → empty result).
- For each slot in `curAgenda`: include `slot.key` if **either**
  - the key is absent from `prev` (was full/not present before — i.e. a cancellation,
    since the agenda only ever contains `free > 0` slots), **or**
  - `slot.free > prev.get(slot.key)` (free count rose).
- Do **not** include slots whose free count was unchanged or dropped.
- Returns a `Set<string>` of slot keys.

### `sessionsInWindow(agenda, window, now) -> slot[]`
- Flatten all slots from all days.
- Keep slots where `new Date(slot.start) > now` (not yet started) — `free > 0` is
  already guaranteed by `runsToSlots`, but assert it defensively.
- Window filter (all dates compared in **Europe/London** via `londonParts`):
  - `today`: `londonParts(slot.start).date === londonParts(now).date`.
  - `48h`: `new Date(slot.start) <= now + 48h`.
  - `weekend`: slot's London day-of-week ∈ {Sat, Sun} **and** the slot falls in the
    *coming* weekend window — from `now` up to and including the next Sunday 23:59
    Europe/London. If `now` is already Sat/Sun, that's the current weekend (today
    through Sunday). Compute the weekend bounds from `now` in London time; do not rely
    on raw UTC hours.
- Sort ascending by `slot.start`.
- Window-to-prose mapping (`today`→"today", `weekend`→"this weekend", `48h`→"in the
  next 48h") lives in the view, not here.

### Wiring the diff (`app.js` `reload`)
- The diff must compare the **new** agenda against the **previous** cached snapshot,
  *before* `saveCache` overwrites it:
  ```
  const prev = loadCache();                 // previous snapshot (or null)
  const data = await loadEverything(token);
  const justOpened = justOpenedKeys(prev && prev.data && prev.data.agenda, data.agenda);
  state = { ...data, stale: false, refreshedAt: Date.now(), justOpened };
  saveCache(data);                          // justOpened is derived, NOT persisted
  ```
- On the cache-fallback path (load failed), set `state.justOpened = new Set()` (no
  fresh diff available).
- First-ever load (no prior cache) → empty set, nothing flagged. Honest by design.

**Documented limitation (code comment in `model.js` + `app.js`):** this only detects
changes between the user's *own* loads/refreshes. Detecting opens while the app is
closed is Phase 2 (watcher + Web Push).

---

## Files touched

| File | Change |
|---|---|
| `app/js/config.js` | `FEATURES.lastMinute = "internal"`; bump `APP_RELEASE` |
| `app/js/features.js` | none (reused as-is) |
| `app/js/model.js` | **new** `justOpenedKeys`, `sessionsInWindow` |
| `app/js/store.js` | **new** `getDefaultLanding`/`setDefaultLanding`/`LANDING_OPTIONS`, `getLastMinuteWindow`/`setLastMinuteWindow` |
| `app/js/data.js` | none (diff lives in `app.js`, which owns the cache seam) |
| `app/js/app.js` | `lastminute` route; reveal nav button when gated; default-landing resolution; `justOpened` diff in `reload`; add `lastminute` to pull-to-refresh set |
| `app/index.html` | hidden `🔥 Last-minute` nav button (first) |
| `app/js/views/lastminute.js` | **new** view |
| `app/js/views/settings.js` | "Default page" dropdown (Settings tab) |
| `app/sw.js` | add `js/views/lastminute.js` to `ASSETS`; bump `CACHE` (in lock-step with `APP_RELEASE`) |

## Error handling

- Live load fails → existing cached-data "(saved)" banner path; `state.justOpened` is
  an empty set so no badges; the view renders from cached agenda as normal.
- Non-gated user reaching `lastminute` (stale link, flag flipped off) → `go` degrades
  to `agenda`; `getDefaultLanding` won't return `lastminute` for them.
- `localStorage` unavailable (private mode) → store helpers fall back to computed
  defaults (window `today`, landing per gating).

## Testing (`app/test/*.test.js`, `node --test`, fully mocked/offline)

- **`justOpenedKeys`**: newly-present key → flagged; free-count rose → flagged;
  unchanged → not; decreased → not; `prevAgenda` null → empty set; identical agendas →
  empty set.
- **`sessionsInWindow`**: against a fixed `now` —
  - Today includes only same-London-date future slots; excludes already-started and
    tomorrow.
  - 48h includes slots within 48h, excludes the 49th hour.
  - Weekend: from a weekday `now`, includes the coming Sat+Sun only; from a Saturday
    `now`, includes the rest of that weekend; excludes the following weekend.
  - All-day correctness across the BST `+00:00` quirk (reuse a known-tricky timestamp
    like the `tz.test.js` ground truth).
- **`getDefaultLanding`**: gated user, no stored value → `lastminute`; non-gated, no
  stored value → `agenda`; stored `account` → `account` for both; stored `lastminute`
  for a non-gated user → degrades to `agenda`; invalid stored value → fallback.
  (Inject a fake `state` / stub `localStorage` as the existing store tests do.)

## Version bump

Per `app/CLAUDE.md`: bump `APP_RELEASE` in `config.js` **and** `CACHE` in `sw.js`
together, and add the new `js/views/lastminute.js` to the `sw.js` `ASSETS` list.

## Rollout

Ships behind `FEATURES.lastMinute = "internal"` → visible only to Dave (9720). After
real-world shakedown, widen to `"beta"` (allowlist + opt-in once the toggle ships) or
`"on"`. Phase 2 (push) is a separate spec.
