const CACHE_NAME = "medialab-studio-v2"; // Increment version to force refresh

// 1. Assets (REMOVED manifest.json for PWA stability)
const ASSETS = [];

// Install: Resilient Caching
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(async (cache) => {
        console.log("MediaLab: Building resilient app shell...");

        const cachePromises = ASSETS.map(async (url) => {
          try {
            const isExternal = url.startsWith("http");
            const request = new Request(
              url,
              isExternal ? { mode: "no-cors" } : {},
            );
            const response = await fetch(request);

            // For internal files, we strictly need a 200 OK.
            // For external (opaque), we just store what we get.
            if (!isExternal && !response.ok)
              throw new Error(`Offline asset 404: ${url}`);

            return await cache.put(url, response);
          } catch (err) {
            console.warn(`⚠️ SW Skip: ${url} | ${err.message}`);
          }
        });
        return Promise.all(cachePromises);
      })
      .then(() => self.skipWaiting()),
  );
});

// Activate: Nuclear Cleanup of old versions
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Fetch Strategy: Studio-Optimized
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 1. BYPASS for AI Engine (Crucial)
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/socket.io"))
    return;

  // 2. Navigation Fallback (Network First, then Cache)
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/")));
    return;
  }

  // 3. Static Assets (Cache First)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          // Runtime caching for images and local scripts only
          if (
            event.request.method === "GET" &&
            response.status === 200 &&
            url.origin === location.origin
          ) {
            const copy = response.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => {
          // Provide generic error for missing images/avatars
          if (event.request.destination === "image") {
            return new Response("Offline", { status: 404 });
          }
        });
    }),
  );
});
