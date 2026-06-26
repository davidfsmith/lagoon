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

test("getDefaultLanding default: lastminute for gated, agenda for others", () => {
  mem.clear();
  assert.equal(getDefaultLanding(gated), "lastminute");
  assert.equal(getDefaultLanding(other), "agenda");
});

test("getDefaultLanding returns a valid stored choice for anyone", () => {
  mem.clear();
  setDefaultLanding("account");
  assert.equal(getDefaultLanding(gated), "account");
  assert.equal(getDefaultLanding(other), "account");
});

test("a stored 'lastminute' degrades to agenda for a non-gated user", () => {
  mem.clear();
  setDefaultLanding("lastminute");
  assert.equal(getDefaultLanding(gated), "lastminute");
  assert.equal(getDefaultLanding(other), "agenda");
});

test("an invalid stored landing falls back per gating", () => {
  mem.clear();
  setDefaultLanding("bogus");
  assert.equal(getDefaultLanding(gated), "lastminute");
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
