// Vice service worker: the studio is browser-local by design — this makes
// offline a real property instead of an accident. Precache the shell + WASM
// core on install; runtime cache-first for same-origin GETs (JS chunks,
// WASM); network-first for navigations with cache fallback for reloads.
// Version the cache name to roll forward; old caches are purged on activate.
const CACHE = "vice-v1";
const PRECACHE = ["/", "/wasm/core.js", "/wasm/core.wasm", "/favicon.ico"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // fonts/CDN stay network
  if (req.mode === "navigate") {
    // Reloads must work offline: try network, fall back to cached shell.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        }),
    ),
  );
});
