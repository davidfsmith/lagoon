import { test } from "node:test";
import assert from "node:assert/strict";
import { tierAllows, isOn, isBetaUser } from "../js/features.js";

const dave = { me: { id: 9720 } };   // on the BETA_TESTERS allowlist
const other = { me: { id: 111 } };   // not

test("tierAllows respects audience tiers", () => {
  assert.equal(tierAllows("on", other), true);
  assert.equal(tierAllows("off", dave), false);
  assert.equal(tierAllows("internal", dave), true);
  assert.equal(tierAllows("internal", other), false);
  assert.equal(tierAllows("beta", dave), true);    // allowlist
  assert.equal(tierAllows("beta", other), false);  // not opted in
  assert.equal(tierAllows(undefined, dave), false); // unknown tier → off
});

test("isBetaUser is true only for the allowlist (until opt-in ships)", () => {
  assert.equal(isBetaUser(dave), true);
  assert.equal(isBetaUser(other), false);
  assert.equal(isBetaUser(null), false);
});

test("isOn is false for an undefined flag", () => {
  assert.equal(isOn("doesNotExist", dave), false);
});
