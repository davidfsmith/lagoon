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
