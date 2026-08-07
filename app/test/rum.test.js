// app/test/rum.test.js
import { test } from "node:test";
import assert from "node:assert/strict";

const mem = new Map();
global.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { getRumOptOut, setRumOptOut } = await import("../js/store.js");

test("rum opt-out defaults to false (opted-in)", () => {
  mem.clear();
  assert.equal(getRumOptOut(), false);
});

test("rum opt-out round-trips", () => {
  mem.clear();
  setRumOptOut(true);
  assert.equal(getRumOptOut(), true);
  setRumOptOut(false);
  assert.equal(getRumOptOut(), false);
});
