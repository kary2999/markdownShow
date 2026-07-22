/* Service worker — network-first for the app shell so updates land immediately,
 * cache fallback for offline. Bump CACHE on every release. */
var CACHE = "markdown-show-v3";
var ASSETS = [
  "./",
  "index.html",
  "app.css",
  "app.js",
  "manifest.webmanifest",
  "lib/marked.min.js",
  "lib/purify.min.js",
  "lib/highlight.min.js",
  "lib/mermaid.min.js",
  "lib/hljs-light.css",
  "lib/hljs-dark.css",
  "icons/icon128.png",
  "icons/icon192.png",
  "icons/icon512.png",
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (k) {
          if (k !== CACHE) return caches.delete(k);
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  // Network-first: always try fresh, fall back to cache when offline.
  e.respondWith(
    fetch(e.request)
      .then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) {
            c.put(e.request, copy);
          });
        }
        return res;
      })
      .catch(function () {
        return caches.match(e.request);
      })
  );
});
