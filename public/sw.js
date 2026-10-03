// AKIBA service worker.
// Scope: app-shell caching + offline fallback, Web Push display, and two
// sync hooks (background + periodic) that keep the cached shell fresh.
// Deliberately does NOT cache anything under /dashboard or /api — balance
// and transaction data must always come from the network or be explicitly
// shown as stale, never silently served from a cache.

const SHELL_CACHE = "akiba-shell-v1";
const SHELL_ASSETS = [
  "/",
  "/offline.html",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/favicon.ico",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isAppData(url) {
  return url.pathname.startsWith("/dashboard") || url.pathname.startsWith("/api");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Page navigations: network-first so logged-in users always see live
  // data; only reach for the cached shell (then the offline page) if the
  // network is actually unavailable.
  if (request.mode === "navigate") {
    if (isAppData(url)) {
      event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
      return;
    }
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/offline.html")))
    );
    return;
  }

  // Static assets (icons, fonts, media): cache-first, refresh in the
  // background. Never applies to /api or /dashboard requests.
  if (!isAppData(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((res) => {
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, res.clone()));
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  const payload = event.data.json();
  const { title, body, url } = payload;

  event.waitUntil(
    self.registration.showNotification(title || "AKIBA", {
      body: body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: url || "/dashboard" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/dashboard";
  event.waitUntil(clients.openWindow(url));
});

// Background Sync: if a deposit/withdrawal request is queued while offline
// (see lib/offline-queue.js on the page side), retry it as soon as
// connectivity returns instead of making the user remember to.
self.addEventListener("sync", (event) => {
  if (event.tag === "akiba-retry-queue") {
    event.waitUntil(retryQueuedRequests());
  }
});

// Periodic Sync: opportunistically refresh the cached app shell so the
// offline page reflects a recent build even if the user hasn't opened the
// app in a while. Browsers that grant this only call it every few hours at
// most, and many (iOS Safari) never call it at all — it's a progressive
// enhancement, not something any feature depends on.
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "akiba-refresh-shell") {
    event.waitUntil(
      caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS))
    );
  }
});

async function retryQueuedRequests() {
  const clientsList = await self.clients.matchAll({ type: "window" });
  clientsList.forEach((client) => client.postMessage({ type: "AKIBA_RETRY_QUEUE" }));
}
