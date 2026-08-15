import { test } from "node:test";
import assert from "node:assert/strict";
import { login, authedGet, getCourseRuns, cancelParticipant,
  createPendingBookings, getPendingOrder, completeFreeOrder } from "../js/api.js";

test("cancelParticipant POSTs to the api2 endpoint with bearer; 401 throws coded", async () => {
  let url, opts;
  const ok = async (u, o) => { url = u; opts = o; return { ok: true, status: 200 }; };
  const r = await cancelParticipant(137840, "JWT", ok);
  assert.equal(r, true);
  assert.match(url, /\/booking-order\/cancelParticipant\/137840$/);
  assert.equal(opts.method, "POST");
  assert.equal(opts.headers.Authorization, "Bearer JWT");
  const unauth = async () => ({ ok: false, status: 401 });
  await assert.rejects(() => cancelParticipant(1, "JWT", unauth), (e) => e.code === 401);
});

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

test("getCourseRuns fetches ALL pages (runs are runId-ordered, not date-ordered)", async () => {
  // page 1's LAST run is far beyond any horizon — the old code broke here and
  // never fetched page 2's in-horizon runs. Dates are scattered (runId order),
  // so pagination must be driven by filteredCount, not a startDate comparison.
  const page1 = { meta: { itemsPerPage: 2, filteredCount: 4 },
    data: [{ id: 1, startDate: "2026-06-21T10:00:00+00:00" }, { id: 2, startDate: "2026-09-01T10:00:00+00:00" }] };
  const page2 = { meta: { itemsPerPage: 2, filteredCount: 4 },
    data: [{ id: 3, startDate: "2026-06-22T10:00:00+00:00" }, { id: 4, startDate: "2026-07-01T10:00:00+00:00" }] };
  let pagesFetched = 0;
  const stub = async (u) => { pagesFetched++; return { ok: true, json: async () => (u.includes("page=2") ? page2 : page1) }; };
  const runs = await getCourseRuns(50, stub);
  assert.equal(pagesFetched, 2);      // did NOT stop after page 1
  assert.equal(runs.length, 4);       // all runs returned; caller filters by horizon
  assert.deepEqual(runs.map(r => r.id), [1, 2, 3, 4]);
});

test("createPendingBookings POSTs the courseRun + participants payload", async () => {
  let captured;
  const fake = async (url, opts) => { captured = { url, opts }; return { ok: true, status: 200, json: async () => ({ id: 1 }) }; };
  await createPendingBookings(99001, [{ contact: { id: 9720 }, membership: { id: 1125 } }], "TOK", fake);
  assert.equal(captured.url, "https://api.lagoon.co.uk/me/orders/pending/bookings");
  assert.equal(captured.opts.method, "POST");
  assert.equal(captured.opts.headers.Authorization, "Bearer TOK");
  assert.deepEqual(JSON.parse(captured.opts.body),
    { courseRun: { id: 99001 }, groupParticipantsCount: 0, participants: [{ contact: { id: 9720 }, membership: { id: 1125 } }] });
});

test("createPendingBookings throws code 401 on unauthorized", async () => {
  const fake = async () => ({ ok: false, status: 401 });
  await assert.rejects(() => createPendingBookings(1, [], "T", fake), e => e.code === 401);
});

test("getPendingOrder GETs the pending order with auth", async () => {
  let u, h;
  const fake = async (url, opts) => { u = url; h = opts.headers; return { ok: true, status: 200, json: async () => ({ total: 0 }) }; };
  const r = await getPendingOrder("TOK", fake);
  assert.equal(u, "https://api.lagoon.co.uk/me/orders/pending");
  assert.equal(h.Authorization, "Bearer TOK");
  assert.equal(r.total, 0);
});

test("getPendingOrder throws code 401 on unauthorized", async () => {
  const fake = async () => ({ ok: false, status: 401 });
  await assert.rejects(() => getPendingOrder("T", fake), e => e.code === 401);
});

test("completeFreeOrder POSTs {} to the giftVoucherPayment endpoint", async () => {
  let captured;
  const fake = async (url, opts) => { captured = { url, opts }; return { ok: true, status: 200, json: async () => ({ status: "ok" }) }; };
  const r = await completeFreeOrder("TOK", fake);
  assert.equal(captured.url, "https://api.lagoon.co.uk/me/cart/giftVoucherPayment");
  assert.equal(captured.opts.method, "POST");
  assert.equal(captured.opts.headers.Authorization, "Bearer TOK");
  assert.equal(captured.opts.body, "{}");
  assert.deepEqual(r, { status: "ok" });
});

test("completeFreeOrder returns true when the response body is empty/unparseable", async () => {
  const fake = async () => ({ ok: true, status: 200, json: async () => { throw new Error("no body"); } });
  const r = await completeFreeOrder("TOK", fake);
  assert.equal(r, true);
});

test("completeFreeOrder throws code 401 on unauthorized", async () => {
  const fake = async () => ({ ok: false, status: 401 });
  await assert.rejects(() => completeFreeOrder("T", fake), e => e.code === 401);
});
