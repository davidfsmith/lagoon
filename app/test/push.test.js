import { test } from "node:test";
import assert from "node:assert/strict";
import { urlBase64ToUint8Array } from "../js/push.js";

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
