const CACHE = "hotbox-delivery-shell-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).catch(async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    if (event.request.mode === "navigate") return fetch("/loja");
    throw new Error("offline");
  }));
});
