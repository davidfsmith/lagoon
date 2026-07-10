import { test } from "node:test";
import assert from "node:assert/strict";

// node has no localStorage — back it with a Map. store.js/features.js touch it only
// at call time (not module-eval), so a static import below is safe.
const mem = new Map();
global.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const {
  getToken, setToken, clearToken,
  saveCache, loadCache,
  getDefaultLanding, setDefaultLanding,
  getLastMinuteWindow, setLastMinuteWindow,
  LANDING_OPTIONS,
  getBetaOptIn, setBetaOptIn,
  getInternalOptIn, setInternalOptIn,
  getNotifyPrefs, setNotifyPrefs,
} = await import("../js/store.js");

// --- token / cache (existing) ---

test("token round-trips and clears", () => {
  mem.clear();
  assert.equal(getToken(), null);
  setToken("JWT");
  assert.equal(getToken(), "JWT");
  clearToken();
  assert.equal(getToken(), null);
});

test("cache saves and loads JSON", () => {
  mem.clear();
  saveCache({ hi: 1 });
  assert.deepEqual(loadCache().data, { hi: 1 });
  assert.equal(typeof loadCache().at, "number");
});

// --- default landing + last-minute window (new) ---

const gated = { me: { id: 9720 } }; // on BETA_TESTERS
const other = { me: { id: 111 } };  // not

test("LANDING_OPTIONS lists the three pages", () => {
  assert.deepEqual(LANDING_OPTIONS.map(o => o.id), ["lastminute", "agenda", "account"]);
});

// lastMinute is now "on" for everyone, so gated/other behave the same. The unset
// default is Availability; a stored choice (incl. "lastminute") is honoured.
test("getDefaultLanding defaults to Availability when nothing is stored", () => {
  mem.clear();
  assert.equal(getDefaultLanding(gated), "agenda");
  assert.equal(getDefaultLanding(other), "agenda");
});

test("getDefaultLanding returns a valid stored choice for anyone", () => {
  mem.clear();
  setDefaultLanding("account");
  assert.equal(getDefaultLanding(gated), "account");
  assert.equal(getDefaultLanding(other), "account");
});

test("a stored 'lastminute' is honoured for everyone (feature is on)", () => {
  mem.clear();
  setDefaultLanding("lastminute");
  assert.equal(getDefaultLanding(gated), "lastminute");
  assert.equal(getDefaultLanding(other), "lastminute");
});

test("an invalid stored landing falls back to Availability", () => {
  mem.clear();
  setDefaultLanding("bogus");
  assert.equal(getDefaultLanding(gated), "agenda");
  assert.equal(getDefaultLanding(other), "agenda");
});

test("getLastMinuteWindow defaults to today and persists valid values only", () => {
  mem.clear();
  assert.equal(getLastMinuteWindow(), "today");
  setLastMinuteWindow("weekend");
  assert.equal(getLastMinuteWindow(), "weekend");
  setLastMinuteWindow("bogus");
  assert.equal(getLastMinuteWindow(), "today");
});

// --- beta / internal opt-in flags ---

test("beta opt-in round-trips (default off)", () => {
  mem.clear();
  assert.equal(getBetaOptIn(), false);
  setBetaOptIn(true);
  assert.equal(getBetaOptIn(), true);
  setBetaOptIn(false);
  assert.equal(getBetaOptIn(), false);
});

test("internal opt-in round-trips (default off)", () => {
  mem.clear();
  assert.equal(getInternalOptIn(), false);
  setInternalOptIn(true);
  assert.equal(getInternalOptIn(), true);
  setInternalOptIn(false);
  assert.equal(getInternalOptIn(), false);
});

test("notify prefs round-trip with defaults", () => {
  mem.clear();
  const d = getNotifyPrefs();
  assert.deepEqual(d.days, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  assert.deepEqual(d.types, ["Air 30", "Tech 30"]);
  assert.equal(d.travelMins, 30);
  setNotifyPrefs({ days: ["Sat", "Sun"], types: ["Air 30"], travelMins: 45 });
  const p = getNotifyPrefs();
  assert.deepEqual(p.days, ["Sat", "Sun"]);
  assert.deepEqual(p.types, ["Air 30"]);
  assert.equal(p.travelMins, 45);
});

test("notify prefs days come back in weekday order regardless of stored order", () => {
  mem.clear();
  setNotifyPrefs({ days: ["Sun", "Sat", "Tue", "Thu"], types: ["Tech 30"], travelMins: 60 });
  assert.deepEqual(getNotifyPrefs().days, ["Tue", "Thu", "Sat", "Sun"]);
});
