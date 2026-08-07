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
