import { test } from "node:test";
import assert from "node:assert/strict";
import { login, authedGet, getCourseRuns } from "../js/api.js";

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

test("getCourseRuns paginates until past horizon", async () => {
  const page1 = { meta: { itemsPerPage: 2, filteredCount: 4 },
    data: [{ startDate: "2026-06-14T10:00:00+00:00" }, { startDate: "2026-06-15T10:00:00+00:00" }] };
  const page2 = { meta: { itemsPerPage: 2, filteredCount: 4 },
    data: [{ startDate: "2026-06-16T10:00:00+00:00" }, { startDate: "2026-09-01T10:00:00+00:00" }] };
  const stub = async (u) => ({ ok: true, json: async () => (u.includes("page=2") ? page2 : page1) });
  const runs = await getCourseRuns(50, "2026-07-05T00:00:00+00:00", stub);
  assert.equal(runs.length, 4); // stops after page 2 (last run beyond horizon)
});
