const CACHE = "lagoon-v6";
const ASSETS = ["./", "./index.html", "./manifest.json",
  "./icon.svg", "./icon-180.png", "./icon-192.png", "./icon-512.png",
  "./js/app.js", "./js/config.js", "./js/tz.js", "./js/api.js", "./js/weather.js", "./js/model.js",
  "./js/agendaModel.js", "./js/store.js", "./js/data.js",
  "./js/views/login.js", "./js/views/agenda.js", "./js/views/day.js", "./js/views/account.js", "./js/views/format.js"];

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
  if (url.pathname.endsWith("/") || url.pathname.endsWith(".html")) {
    e.respondWith(fetch(e.request).then(res => { const c = res.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return res; }).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(c => c || fetch(e.request)));
});
