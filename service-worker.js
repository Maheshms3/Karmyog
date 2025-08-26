/* Karmyog SW – SEO-friendly caching */
const STATIC_CACHE = 'karmyog-static-v1';
const ASSET_CACHE = 'karmyog-assets-v1';

// Precache only small, stable essentials (avoid HTML shell here)
const PRECACHE = [
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512.png'
];

// Utility to check same-origin
const sameOrigin = (url) => new URL(url, self.location.origin).origin === self.location.origin;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => ![STATIC_CACHE, ASSET_CACHE].includes(k))
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Always bypass cache for sitemap/robots to avoid serving stale content
  if (url.pathname === '/sitemap.xml' || url.pathname === '/robots.txt') {
    return event.respondWith(fetch(req));
  }

  // Navigation requests (HTML) -> network first, fallback to cached index if offline
  if (req.mode === 'navigate') {
    return event.respondWith(
      fetch(req)
        .then((res) => {
          // Optionally cache the page snapshot (not strictly needed)
          return res;
        })
        .catch(async () => {
          // Fallback to cached index.html if available
          const cache = await caches.open(STATIC_CACHE);
          const cached = await cache.match('/index.html');
          return cached || Response.error();
        })
    );
  }

  // For same-origin static assets (CSS/JS/images), do stale-while-revalidate
  if (sameOrigin(req.url)) {
    // Don’t try to cache HTML documents here
    const isHTML = req.headers.get('accept')?.includes('text/html');
    if (isHTML) return; // handled above

    return event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const networkFetch = fetch(req)
          .then((res) => {
            // Only cache successful, basic responses
            if (res && res.status === 200 && res.type === 'basic') {
              cache.put(req, res.clone());
            }
            return res;
          })
          .catch(() => undefined);

        // Return cached immediately if present; update in background
        return cached || networkFetch || fetch(req);
      })
    );
  }

  // Cross-origin (e.g., CDNs) – just hit network
  // (You could add specific caching for fonts/CDNs later if needed)
});
