import { test } from "node:test";
import assert from "node:assert/strict";

// node has no localStorage — back it with a Map (same pattern as store.test.js).
// features.js/store.js touch it only at call time, so the dynamic imports are safe.
const mem = new Map();
global.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { tierAllows, isOn, isBetaUser, accessTier } = await import("../js/features.js");
const { setBetaOptIn, setInternalOptIn } = await import("../js/store.js");

test("no opt-in: only 'on' is visible", () => {
  mem.clear();
  assert.equal(tierAllows("on"), true);
  assert.equal(tierAllows("beta"), false);
  assert.equal(tierAllows("internal"), false);
  assert.equal(tierAllows("off"), false);
  assert.equal(tierAllows(undefined), false); // unknown tier → off
  assert.equal(isBetaUser(), false);
  assert.equal(accessTier(), null);
});

test("beta opt-in unlocks beta but not internal", () => {
  mem.clear();
  setBetaOptIn(true);
  assert.equal(tierAllows("beta"), true);
  assert.equal(tierAllows("internal"), false);
  assert.equal(isBetaUser(), true);
  assert.equal(accessTier(), "beta");
});

test("internal opt-in unlocks internal and beta (superset)", () => {
  mem.clear();
  setInternalOptIn(true);
  assert.equal(tierAllows("internal"), true);
  assert.equal(tierAllows("beta"), true);
  assert.equal(isBetaUser(), true);
  assert.equal(accessTier(), "internal");
});

test("internal wins the badge even when both flags are set", () => {
  mem.clear();
  setBetaOptIn(true);
  setInternalOptIn(true);
  assert.equal(accessTier(), "internal");
});

test("isOn maps an undefined flag to off", () => {
  mem.clear();
  assert.equal(isOn("doesNotExist"), false);
});
