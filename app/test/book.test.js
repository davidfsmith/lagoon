import { test } from "node:test";
import assert from "node:assert/strict";
import { isFreeOrder } from "../js/views/book.js";

// The £0 safety gate: this is the ONLY thing standing between "book a free session"
// and "silently complete a paid one". Must default to NOT free whenever it can't
// positively confirm £0.
test("isFreeOrder: only a zero total is free", () => {
  assert.equal(isFreeOrder({ total: 0 }), true);
  assert.equal(isFreeOrder({ total: 25 }), false);
  assert.equal(isFreeOrder({}), false);           // unknown → treat as NOT free (safe default)
  assert.equal(isFreeOrder(null), false);
});

test("isFreeOrder: false on non-object inputs", () => {
  assert.equal(isFreeOrder(undefined), false);
  assert.equal(isFreeOrder(0), false);
  assert.equal(isFreeOrder("free"), false);
});

test("isFreeOrder: ALL money-shaped fields must be zero, not just one", () => {
  assert.equal(isFreeOrder({ total: 0, amountDue: 0 }), true);
  assert.equal(isFreeOrder({ total: 0, amountDue: 5 }), false); // one nonzero field -> NOT free
  assert.equal(isFreeOrder({ total: 0, balance: 0, grossPrice: 0, netCost: 0 }), true);
});

test("isFreeOrder: matches balance/price/cost/net/gross field names too, case-insensitively", () => {
  assert.equal(isFreeOrder({ Balance: 0 }), true);
  assert.equal(isFreeOrder({ PRICE: 12 }), false);
  assert.equal(isFreeOrder({ costTotal: 0 }), true);
});

test("isFreeOrder: non-numeric money-shaped fields don't count as a confirmed £0", () => {
  assert.equal(isFreeOrder({ total: "0" }), false); // string, not number -> can't confirm
  assert.equal(isFreeOrder({ total: null }), false);
});

test("isFreeOrder: unrelated numeric fields don't fool the gate", () => {
  assert.equal(isFreeOrder({ id: 12345, courseRunId: 99001 }), false); // no money field at all
});
