<<<<<<< LOCAL (Your changes)
/* =========================================================
   AXON AI — service worker
   • Precaches the app shell (HTML, CSS, JS modules, icons)
   • Network-first for navigation so updates arrive instantly
   • Cache-first for static assets
   • Never caches AI requests
   ========================================================= */

const VERSION = "axon-v2.1.1";
const CACHE_NAME = `axon-${VERSION}`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/base.css",
  "./css/chat.css",
  "./css/pages.css",
  "./css/voice.css",
  "./css/extra.css",
  "./css/aurora.css",
  "./js/main.js",
  "./js/config.js",
  "./js/state.js",
  "./js/ui.js",
  "./js/markdown.js",
  "./js/ai.js",
  "./js/chat.js",
  "./js/sidebar.js",
  "./js/settings.js",
  "./js/account.js",
  "./js/auth.js",
  "./js/backend.js",
  "./js/images.js",
  "./js/voice.js",
  "./js/pwa.js",
  "./js/share.js",
  "./assets/axon-icon-192.png",
  "./assets/axon-icon-512.png",
  "./assets/male-avatar.webp",
  "./assets/female-avatar.webp"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      /* addAll fails as a whole if one file is missing — add individually */
      Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch(() => {
            /* optional asset (e.g. logo variant) — ignore */
          })
        )
      )
    )
  );
  /* Activate the new version immediately — otherwise an old cached
     shell can keep serving the previous UI for days. */
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isAICall(url) {
  return (
    url.hostname.endsWith(".workers.dev") ||
    url.hostname.includes("openrouter") ||
    url.hostname.includes("openai") ||
    url.hostname.includes("anthropic")
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (isAICall(url)) return;
  if (url.origin !== self.location.origin) return;

  /* Navigations: network first, fall back to the cached shell offline. */
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  /* Static assets: NETWORK FIRST so a redeploy is visible immediately.
     The cache is only a fallback when the network fails (offline). */
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html")))
  );
});

=======
/* =========================================================
   AXON AI — service worker
   • Precaches the app shell (HTML, CSS, JS modules, icons)
   • Network-first for navigation so updates arrive instantly
   • Cache-first for static assets
   • Never caches AI requests
   ========================================================= */

const VERSION = "axon-v2.1.0";
const CACHE_NAME = `axon-${VERSION}`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/base.css",
  "./css/chat.css",
  "./css/pages.css",
  "./css/voice.css",
  "./css/extra.css",
  "./css/aurora.css",
  "./js/main.js",
  "./js/config.js",
  "./js/state.js",
  "./js/ui.js",
  "./js/markdown.js",
  "./js/ai.js",
  "./js/chat.js",
  "./js/sidebar.js",
  "./js/settings.js",
  "./js/account.js",
  "./js/auth.js",
  "./js/backend.js",
  "./js/images.js",
  "./js/voice.js",
  "./js/pwa.js",
  "./js/share.js",
  "./assets/axon-icon-192.png",
  "./assets/axon-icon-512.png",
  "./assets/male-avatar.webp",
  "./assets/female-avatar.webp"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      /* addAll fails as a whole if one file is missing — add individually */
      Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch(() => {
            /* optional asset (e.g. logo variant) — ignore */
          })
        )
      )
    )
  );
  /* Activate the new version immediately — otherwise an old cached
     shell can keep serving the previous UI for days. */
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

function isAICall(url) {
  return (
    url.hostname.endsWith(".workers.dev") ||
    url.hostname.includes("openrouter") ||
    url.hostname.includes("openai") ||
    url.hostname.includes("anthropic")
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (isAICall(url)) return;
  if (url.origin !== self.location.origin) return;

  /* Navigations: network first, fall back to the cached shell offline. */
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  /* Static assets: NETWORK FIRST so a redeploy is visible immediately.
     The cache is only a fallback when the network fails (offline). */
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html")))
  );
});

>>>>>>> REMOTE (Changes from GitHub)
