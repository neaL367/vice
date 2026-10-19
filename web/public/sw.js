// Vice service worker: the studio is browser-local by design — this makes
// offline a real property instead of an accident. Precache the shell + WASM
// core on install (covers first-visit-then-offline); runtime cache-first for
// same-origin GETs (JS chunks, WASM); network-first for navigations so an
// online load always boots fresh HTML and can never stick on a stale shell —
// cache fallback only serves reloads that truly fail (offline/dev restart).
// Version the cache name to roll forward; old caches are purged on activate,
// which also heals clients stuck on a previous version's entries.
const CACHE = "vice-v3";
const PRECACHE = ["/","/wasm/core.js","/wasm/core.wasm","/favicon.ico","/icon.svg","/_next/static/chunks/0cz1d0mv5g_q7.js","/_next/static/chunks/0p_w__bs2_j30.js","/_next/static/chunks/1buo_v93i-sex.js","/_next/static/chunks/1t2m6kn-pwd3_.js","/_next/static/chunks/1tq6ppe__m8m-.js","/_next/static/chunks/1y31zz6-268th.js","/_next/static/chunks/21jmab2xql1m7.js","/_next/static/chunks/3cfn99dbrcvvp.js","/_next/static/chunks/turbopack-3-ry682tkyiqk.js","/_next/static/chunks/turbopack-3jwbm1qpkkdd0.js","/_next/static/chunks/turbopack-worker-1hrsqshz0gfey.js#params=%5B%5B%22%2F_next%2Fstatic%2Fchunks%2Fturbopack-3-ry682tkyiqk.js%22%2C%22%2F_next%2Fstatic%2Fchunks%2Fturbopack-3jwbm1qpkkdd0.js%22%2C%22%2F_next%2Fstatic%2Fchunks%2F1y31zz6-268th.js%22%5D%2C%22%22%2C%22%2F_next%2F%22%2Cnull%2Cnull%5D"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE).catch(() => {}))
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
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
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
          // Never cache failed/redirected responses — a poisoned cache-first
          // entry would serve the error forever.
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
