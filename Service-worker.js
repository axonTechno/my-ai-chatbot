
const CACHE_NAME = "axon-cache-v1";

const APP_FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./axon-logo.png",
  "./male-avatar.png",
  "./female-avatar.png",
  "./like.png",
  "./dislike.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_FILES);
    })
  );

  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );

  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Don't cache AXON's AI API requests.
  if (url.hostname.endsWith(".workers.dev")) return;

  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, copy);
          });
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        return cached || caches.match("./index.html");
      })
  );
});
