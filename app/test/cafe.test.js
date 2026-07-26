import { test } from "node:test";
import assert from "node:assert/strict";
import { CAFE_WIFI } from "../js/config.js";
import { cafeTabHtml } from "../js/views/cafe.js";

test("Café tab renders the SSID and password", () => {
  const html = cafeTabHtml();
  assert.match(html, new RegExp(CAFE_WIFI.ssid));
  assert.match(html, new RegExp(CAFE_WIFI.password));
});

test("Café tab exposes copyable values and the WiFi QR image", () => {
  const html = cafeTabHtml();
  // Copy buttons carry the raw values so wireCafeTab can write them to the clipboard.
  assert.match(html, new RegExp(`data-copy="${CAFE_WIFI.ssid}"`));
  assert.match(html, new RegExp(`data-copy="${CAFE_WIFI.password}"`));
  assert.match(html, /wifi-qr\.svg/);
});
