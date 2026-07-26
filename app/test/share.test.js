import { test } from "node:test";
import assert from "node:assert/strict";
import { APP_URL, FEATURES } from "../js/config.js";
import { shareSectionHtml } from "../js/views/share.js";

test("Share section is gated to the internal (dev-only) tier", () => {
  assert.equal(FEATURES.shareApp, "internal");
});

test("Share section carries the app URL (copy button + QR)", () => {
  const html = shareSectionHtml();
  assert.match(html, new RegExp(`data-url="${APP_URL.replace(/[.\/]/g, "\\$&")}"`));
  assert.match(html, /share-qr\.svg/);
});
