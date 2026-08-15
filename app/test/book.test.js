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

// The real /me/orders/pending shape was never captured live — the gate must NOT assume
// it's flat. A nested payable total must be caught, not masked by a zeroed top-level field.
test("isFreeOrder: recurses — a nested non-zero total is NOT free, even with a zeroed top-level field", () => {
  assert.equal(isFreeOrder({ total: 0, cart: { grandTotal: 25 } }), false);
});

test("isFreeOrder: recurses — a fully-zeroed nested order IS free", () => {
  assert.equal(isFreeOrder({ total: 0, cart: { grandTotal: 0, items: [{ price: 0 }, { cost: 0 }] } }), true);
});

test("isFreeOrder: recurses — a money field found only deep inside still confirms/denies £0", () => {
  assert.equal(isFreeOrder({ meta: { breakdown: { fees: { due: 5 } } } }), false); // deep nonzero
  assert.equal(isFreeOrder({ meta: { breakdown: { fees: { due: 0 } } } }), true);  // deep zero, nothing else
});

test("isFreeOrder: a money field inside an array-only structure is still found", () => {
  assert.equal(isFreeOrder({ items: [{ price: 0 }, { price: 0 }] }), true);
  assert.equal(isFreeOrder({ items: [{ price: 0 }, { price: 10 }] }), false);
});

// Depth-cap truncation must fail SAFE. If the walk hits the depth cap while structure
// is still unexplored below it, that's "can't confirm £0" — never "found nothing, so
// free" — even when every money field seen ON THE WAY DOWN was zero.
test("isFreeOrder: hitting the depth cap with more structure below is NOT free, even if everything found so far is zero", () => {
  // 20 levels deep, every "total" along the way is 0 — well past MAX_DEPTH (12), so the
  // walk must truncate and report "can't confirm" rather than "all zero -> free".
  let order = { total: 0 };
  for (let i = 0; i < 20; i++) order = { total: 0, next: order };
  assert.equal(isFreeOrder(order), false);
});
