# Bookings History Implementation Plan

> **For agentic workers:** implement task-by-task, TDD, committing per task. Full design,
> data definitions, stats and test matrix live in
> `docs/superpowers/specs/2026-07-12-bookings-history-design.md` — read it alongside this.

**Goal:** A gated (`internal`) History tab on the Bookings screen: a year-grouped list of past
held bookings plus a five-stat summary (total · this year · 🔥 streak · per-rider · favourite),
computed client-side from already-loaded `meBookings`.

**Architecture:** Pure model (`historyModel.js`) → presentational view (`views/history.js`) →
wired as a third tab in `account.js` behind `isOn("history")`. No new API/network/AWS.

**Tech Stack:** Vanilla ES-module JS, no deps; Node `--test` (mocked).

**Reused helpers:** `prettyCourse`, `fmtDate` (`views/format.js`); `londonParts().date`
(`tz.js`); `bookingIsHeld`, `activeParticipants` (`model.js`); `isOn` (`features.js`);
`tabBarHtml` (`tabs.js`). `state.me` (has `.id`), `state.meBookings` from `data.js`.

---

### Task 1: `historyModel.js` (pure) + tests — TDD

**Files:** Create `app/js/historyModel.js`, `app/test/historyModel.test.js`.

`pastSessions(meBookings, me, now)` → `{ list, stats }`:
- **list:** past held bookings → `[{ year, date /*London YYYY-MM-DD*/, startDate, typeLabel
  /*prettyCourse*/, riders /*non-me firstNames*/ }]`, newest-first.
- **stats:** `{ total, thisYear, streak, perRider: [{name,count}], favType, favDay }`.
- **Past held:** `bookingIsHeld(b)` && `b.courseRun?.startDate` && `new Date(startDate) < now`.
- **Rider identity:** `p.contact.id === me.id` ⇒ "you" (excluded from `riders`); others by
  `contact.firstName`. `perRider`: count bookings each contact appears on ("You" label for me).
- **favType:** modal `typeLabel`. **favDay:** modal London weekday (from `londonParts(startDate)
  .date` → `new Date(date+"T12:00:00").getDay()` → name). Ties: most-recent-wins is fine.
- **streak (see spec):** bucket each held session to its **London week Monday** (from the
  London date, step back `(getDay()+6)%7` days); `W` = set of those Mondays. `latest` = max(W).
  Live iff `latest` is this-week's or last-week's Monday relative to `now`. If live, count back
  while `latest−7k` ∈ W. Else 0.

- [ ] **Step 1 — tests first.** Write `historyModel.test.js` per the spec's test matrix: past
  vs future split; non-held/cancelled excluded; total & thisYear; per-rider incl. a two-rider
  booking counting for both; favType/favDay with a UTC→London weekday-shift fixture; streak
  (consecutive count; one-week gap breaks; stale >1wk ⇒ 0; mid-week now + last-weekend ride ⇒
  live; two rides same week don't double-count); newest-first order; empty input ⇒ zeros.
  Inject a fixed `now`. Use plain booking-object fixtures (only fields the model reads).
- [ ] **Step 2** — run `node --test app/test/historyModel.test.js`; expect FAIL (no module).
- [ ] **Step 3** — implement `historyModel.js` to pass. Keep it pure (no DOM/Date.now()).
- [ ] **Step 4** — run tests; expect PASS. Also `node --check app/js/historyModel.js`.
- [ ] **Step 5** — commit: `feat: history model (pure, tested)`.

### Task 2: `views/history.js`

**Files:** Create `app/js/views/history.js`.

`renderHistory(state)` → HTML string (no side-effects beyond a once-guarded style inject),
built from `pastSessions(state.meBookings, state.me, new Date())`:
- **Stats strip:** total ("N rides"), thisYear ("N in YYYY"), streak ("🔥 N-week streak", omit
  the row when streak is 0), perRider ("You a · Hamish b"), favourite ("Most: <type> ·
  <day>s"). Omit favourite when list empty.
- **List:** year headers (desc); rows `<date> · <typeLabel>` + a right-aligned rider tag only
  when `riders.length` (join with "+"). Reuse `fmtDate(entry.date)`.
- **Empty:** "No past sessions yet — they'll show here after you've ridden."
- **Styles:** `injectHistoryStyles()` guarded by an element id; reuse existing tokens/classes
  where possible (match `.set-row`/`.bkrow` idiom).

- [ ] **Step 1** — write the view; `node --check` it.
- [ ] **Step 2** — commit: `feat: history tab view`.

### Task 3: wire into `account.js` (gated)

**Files:** Modify `app/js/views/account.js`.

- Import `isOn` (`../features.js`) and `renderHistory` (`./history.js`).
- Tab bar: append `{ id: "history", label: "History" }` **only when** `isOn("history")`.
- Render: when `activeTab === "history"`, output `renderHistory(state)`. Existing
  `bookings`/`extras` branches unchanged. (Guard `activeTab`: if it's "history" but the flag
  is off — can't happen via UI, but be safe — fall back to bookings.)
- Existing tab-click handler already re-renders on `data.tab`; no change needed.

- [ ] **Step 1** — make edits; `node --check`; run full `node --test app/test/*.test.js`.
- [ ] **Step 2** — commit: `feat: gate history tab behind isOn(history) in Bookings`.

### Task 4: flag + version + SW precache

**Files:** Modify `app/js/config.js`, `app/sw.js`.

- `config.js`: `FEATURES.history = "internal"`; bump `APP_RELEASE` to the next `vNN`.
- `sw.js`: add `"./js/historyModel.js"` and `"./js/views/history.js"` to `ASSETS`; bump
  `CACHE` to the same `vNN`.

- [ ] **Step 1** — edits; `node --check app/sw.js app/js/config.js`.
- [ ] **Step 2** — commit: `chore: add history flag (internal) + vNN + SW assets`.

### Task 5: verify + PR

- [ ] Serve locally, enable dev mode (7-tap version row), confirm the History tab appears,
  stats + year-grouped list render, and with the flag off there's no third tab.
- [ ] `node --test app/test/*.test.js` green.
- [ ] Push branch, open PR (gated `internal`; deploy after merge via daves-adventures).

## Self-review notes
- Coverage vs spec: model (Task 1) ⇢ all five stats + definitions; view (Task 2) ⇢ layout +
  empty state; gating (Task 3) ⇢ additive `isOn`; flag/version/SW (Task 4). ✓
- Consistency: `pastSessions(meBookings, me, now)` signature identical across tasks; `stats`
  keys (`total/thisYear/streak/perRider/favType/favDay`) match the view's reads. ✓
- No placeholders. ✓
