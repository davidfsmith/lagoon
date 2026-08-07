// First-party, cookieless RUM. createCollector is the pure, DOM-free core (unit-tested);
// the wiring below (Task 7) adds sendBeacon + listeners. Nothing here persists an identifier.

export function createCollector({ send, isEnabled, now = () => new Date().toISOString(), sizeCap = 20 }) {
  let queue = [], meta = null, sid = null;
  const buildPayload = () => ({ v: 1, sid, sent: now(), meta, events: queue.slice() });
  function flush() {
    if (!isEnabled() || queue.length === 0) return;
    send(JSON.stringify(buildPayload()));
    queue = [];
  }
  function record(evt) {
    if (!isEnabled()) return;
    queue.push(evt);
    if (queue.length >= sizeCap) flush();
  }
  return {
    setSession(s, m) { sid = s; meta = m; },
    record, flush, buildPayload,
    queueLength: () => queue.length,
  };
}

import { isOn } from "./features.js";
import { getRumOptOut, getDiscipline } from "./store.js";
import { APP_RELEASE } from "./config.js";

const RUM_URL = "/lagoon/rum";
const dnt = () => (navigator.doNotTrack === "1" || window.doNotTrack === "1");
// Send only when the user hasn't opted out and DNT is off. (Tier gate is checked once in init.)
const sendable = () => !getRumOptOut() && !dnt();
const beacon = (json) => {
  try { navigator.sendBeacon(RUM_URL, new Blob([json], { type: "application/json" })); } catch (_) {}
};

let collector = null;
let firstLoad = true;

function buildMeta() {
  const m = {
    ver: APP_RELEASE,
    theme: document.documentElement.classList.contains("light") ? "light"
      : document.documentElement.classList.contains("dark") ? "dark" : undefined,
    disc: getDiscipline(),
    standalone: matchMedia("(display-mode: standalone)").matches,
  };
  if (firstLoad && document.referrer) m.ref = document.referrer;
  firstLoad = false;
  return m;
}

export function init() {
  if (collector || !isOn("rum")) return;   // tier gate — once
  collector = createCollector({ send: beacon, isEnabled: sendable });
  collector.setSession(crypto.randomUUID(), buildMeta());
  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") collector.flush();
  });
  addEventListener("pagehide", () => collector.flush());
}

export function route(name) { if (collector) collector.record({ t: "route", route: name }); }
export function event(name, props) {
  if (collector) collector.record(props ? { t: "event", name, props } : { t: "event", name });
}
