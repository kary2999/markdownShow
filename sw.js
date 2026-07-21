/* Service worker — cache the app shell so Markdown Show works offline. */
var CACHE = "markdown-show-v1";
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
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      return (
        cached ||
        fetch(e.request)
          .then(function (res) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) {
              c.put(e.request, copy);
            });
            return res;
          })
          .catch(function () {
            return cached;
          })
      );
    })
  );
});
