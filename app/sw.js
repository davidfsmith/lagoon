const CACHE = "lagoon-v55";
const ASSETS = ["./", "./index.html", "./manifest.json",
  "./icon.svg", "./icon-180.png", "./icon-192.png", "./icon-512.png",
  "./js/app.js", "./js/config.js", "./js/tz.js", "./js/theme.js", "./js/api.js", "./js/weather.js", "./js/model.js",
  "./js/agendaModel.js", "./js/store.js", "./js/data.js", "./js/pullToRefresh.js", "./js/intro.js", "./js/filters.js", "./js/calendar.js", "./js/features.js", "./js/tabs.js", "./js/refreshedTicker.js", "./js/push.js",
  "./js/views/login.js", "./js/views/agenda.js", "./js/views/day.js", "./js/views/account.js", "./js/views/format.js", "./js/views/settings.js", "./js/views/lastminute.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.hostname.endsWith("lagoon.co.uk") || url.hostname.endsWith("open-meteo.com")) return; // never cache API
  // Network-first for the app shell, code and manifest so every online load gets
  // the latest version (cache is only an offline fallback). Like the compose app.
  const p = url.pathname;
  if (p.endsWith("/") || p.endsWith(".html") || p.endsWith(".js") || p.endsWith(".json")) {
    e.respondWith(fetch(e.request).then(res => { const c = res.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return res; }).catch(() => caches.match(e.request)));
    return;
  }
  // Cache-first for static images (icons).
  e.respondWith(caches.match(e.request).then(c => c || fetch(e.request)));
});

// Web Push: show the notification from the pushed JSON payload.
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = {}; }
  const title = d.title || "Hove Lagoon";
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || "",
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    data: { url: d.url || "./", date: d.date, key: d.key },
    tag: "lagoon-opening", // coalesce onto one notification per device
  }));
});

// Tap → jump to the freed slot's Day view. Focus an open tab (postMessage the route)
// or open a new one at a #day/<date>/<key> hash for the app to pick up on boot.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  const { date, key } = data;
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
    for (const w of wins) {
      if ("focus" in w) {
        if (date && key) w.postMessage({ type: "open-day", date, key });
        return w.focus();
      }
    }
    const url = (date && key) ? `./#day/${date}/${encodeURIComponent(key)}` : (data.url || "./");
    return clients.openWindow(url);
  }));
});
