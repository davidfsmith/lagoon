import { test } from "node:test";
import assert from "node:assert/strict";
import { urlBase64ToUint8Array, subscribeBody, prefsEqual } from "../js/push.js";

test("urlBase64ToUint8Array decodes URL-safe base64 to bytes", () => {
  // "hello" in standard base64 is "aGVsbG8"; URL-safe, unpadded here.
  const out = urlBase64ToUint8Array("aGVsbG8");
  assert.ok(out instanceof Uint8Array);
  assert.deepEqual([...out], [104, 101, 108, 108, 111]); // h e l l o
});

test("urlBase64ToUint8Array handles - and _ (URL-safe alphabet)", () => {
  // 0xfb 0xff 0xbf encodes to "-_-_" in URL-safe base64.
  const out = urlBase64ToUint8Array("-_-_");
  assert.deepEqual([...out], [0xfb, 0xff, 0xbf]);
});

test("subscribeBody wraps subscription + prefs", () => {
  const sub = { endpoint: "e", keys: { p256dh: "P", auth: "A" } };
  const body = JSON.parse(subscribeBody(sub, { days: ["Sat"], types: ["Air 30"], travelMins: 20 }));
  assert.deepEqual(body.subscription, sub);
  assert.deepEqual(body.prefs, { days: ["Sat"], types: ["Air 30"], travelMins: 20 });
});

test("prefsEqual: order-independent days/types, travelMins compared", () => {
  const a = { days: ["Sat", "Sun"], types: ["Air 30", "Tech 30"], travelMins: 30 };
  assert.equal(prefsEqual(a, { days: ["Sun", "Sat"], types: ["Tech 30", "Air 30"], travelMins: 30 }), true);
  assert.equal(prefsEqual(a, { days: ["Sat"], types: ["Air 30", "Tech 30"], travelMins: 30 }), false); // day dropped
  assert.equal(prefsEqual(a, { days: ["Sat", "Sun"], types: ["Air 30"], travelMins: 30 }), false);     // type stripped
  assert.equal(prefsEqual(a, { days: ["Sat", "Sun"], types: ["Air 30", "Tech 30"], travelMins: 45 }), false); // travel
  assert.equal(prefsEqual(a, null), false);
});
