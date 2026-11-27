// Sheetal apps' service worker (the customer app at / and Sheetal Business at /business/): lets an installed app open without internet.
// How it works: pages are fetched from the network first (always the newest), and a copy is kept; with no network the last copy is shown,
// else the offline page. The built files under /assets/ have their content's hash in the name, so they are taken from the cache first.
// Rules: only this site's own GET requests; the APIs (api.*) and anything signed in are never cached here; a new version (CACHE) clears old ones.

const CACHE = "sheetal-app-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, "/brand/logo-mark.png", "/brand/icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const isAsset = (url) => /\/assets\/[^/]+\.(js|css|woff2?|png|jpe?g|webp|svg)$/.test(url.pathname);

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(async () => (await caches.match(req)) || (await caches.match(url.pathname.startsWith("/business") ? "/business/" : "/")) || caches.match(OFFLINE)),
    );
    return;
  }
  if (isAsset(url)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
  }
});
