/*
 * HOTBOX DELIVERY - Service Worker
 * Versao: 2026.09.06.2
 *
 * Arquivo publico: /sw.js
 * Objetivo:
 * - permitir instalacao PWA
 * - manter navegacao segura em modo standalone
 * - usar rede como prioridade
 * - usar cache somente como contingencia
 */

const CACHE_NAME = "hotbox-delivery-v2";

const APP_SHELL = [
  "/",
  "/loja",
  "/manifest.webmanifest",
  "/pwa/icon-192.png",
  "/pwa/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // Nao deixa a instalacao falhar caso algum item ainda nao esteja disponivel.
      await Promise.allSettled(
        APP_SHELL.map(async (url) => {
          try {
            const response = await fetch(url, {
              cache: "no-cache"
            });

            if (response && response.ok) {
              await cache.put(url, response.clone());
            }
          } catch (_) {
            // Ignora falha individual durante a instalacao.
          }
        })
      );

      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );

      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Service Worker somente para requisicoes GET.
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  // Nao interfere em requisicoes para dominios externos.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Navegacao:
  // tenta buscar na internet primeiro.
  // Se estiver offline, tenta usar o cache.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);

          if (response && response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, response.clone());
          }

          return response;
        } catch (_) {
          return (
            (await caches.match(request)) ||
            (await caches.match("/loja")) ||
            (await caches.match("/")) ||
            new Response(
              "HOTBOX DELIVERY esta temporariamente offline. Verifique sua conexao e tente novamente.",
              {
                status: 503,
                headers: {
                  "Content-Type": "text/plain; charset=UTF-8"
                }
              }
            )
          );
        }
      })()
    );

    return;
  }

  // Arquivos estaticos:
  // usa cache primeiro e atualiza em segundo plano.
  const isStaticAsset =
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/pwa/") ||
    url.pathname === "/manifest.webmanifest";

  if (isStaticAsset) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);

        const networkPromise = fetch(request)
          .then(async (response) => {
            if (response && response.ok) {
              const cache = await caches.open(CACHE_NAME);
              await cache.put(request, response.clone());
            }

            return response;
          })
          .catch(() => null);

        if (cached) {
          event.waitUntil(networkPromise);
          return cached;
        }

        const networkResponse = await networkPromise;

        if (networkResponse) {
          return networkResponse;
        }

        return new Response("", {
          status: 504
        });
      })()
    );
  }
});
