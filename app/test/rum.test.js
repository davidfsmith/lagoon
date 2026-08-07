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

const { createCollector } = await import("../js/rum.js");

test("record queues; flush sends payload and clears when enabled", () => {
  const sent = [];
  const c = createCollector({ send: (j) => sent.push(j), isEnabled: () => true, now: () => "T" });
  c.setSession("s1", { ver: "v94" });
  c.record({ t: "route", route: "agenda" });
  assert.equal(c.queueLength(), 1);
  c.flush();
  const p = JSON.parse(sent[0]);
  assert.equal(p.v, 1);
  assert.equal(p.sid, "s1");
  assert.equal(p.sent, "T");
  assert.deepEqual(p.events, [{ t: "route", route: "agenda" }]);
  assert.equal(c.queueLength(), 0);
});

test("disabled: never queues or sends", () => {
  const sent = [];
  const c = createCollector({ send: (j) => sent.push(j), isEnabled: () => false });
  c.record({ t: "route", route: "agenda" });
  c.flush();
  assert.equal(c.queueLength(), 0);
  assert.equal(sent.length, 0);
});

test("size cap auto-flushes", () => {
  const sent = [];
  const c = createCollector({ send: (j) => sent.push(j), isEnabled: () => true, sizeCap: 2 });
  c.setSession("s", {});
  c.record({ t: "route", route: "agenda" });
  assert.equal(sent.length, 0);
  c.record({ t: "route", route: "account" });
  assert.equal(sent.length, 1);
  assert.equal(c.queueLength(), 0);
});

test("flush is a no-op when the queue is empty", () => {
  const sent = [];
  const c = createCollector({ send: (j) => sent.push(j), isEnabled: () => true });
  c.flush();
  assert.equal(sent.length, 0);
});
