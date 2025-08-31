/* Karmyog SW – SEO-friendly caching + notifications + robust offline fallback */
importScripts('https://www.gstatic.com/firebasejs/9.6.7/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.6.7/firebase-messaging-compat.js');

const STATIC_CACHE = 'karmyog-static-v3';
const ASSET_CACHE  = 'karmyog-assets-v3';

// Precache only small, stable essentials
const PRECACHE = [
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512.png',
  '/icons/icon-512x512.png'
];

// Copy your firebaseConfig from index.html here
const firebaseConfig = {
    apiKey: "AIzaSyA1YxzDZzzyIuAxjxzo_Vy3d8CLtHoBK44",
    authDomain: "karmyog.life",
    projectId: "karmyog-6da5f",
    storageBucket: "karmyog-6da5f.appspot.com",
    messagingSenderId: "331203556277",
    appId: "1:331203556277:web:b087b49debac40eeb6dffc",
    measurementId: "G-316W8DPVBN"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// Utility to check same-origin
const sameOrigin = (url) =>
  new URL(url, self.location.origin).origin === self.location.origin;

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
        .then(async (res) => {
          // Store a snapshot of index.html for offline fallback (without precaching HTML)
          try {
            const clone = res.clone();
            // Cache under a stable key so fallback always finds it
            const cache = await caches.open(STATIC_CACHE);
            // Prefer caching canonical index if path is root or any SPA route
            await cache.put('/index.html', clone);
          } catch (_) { /* ignore */ }
          return res;
        })
        .catch(async () => {
          // Fallback to cached index.html if available
          const cache  = await caches.open(STATIC_CACHE);
          const cached = await cache.match('/index.html');
          return cached || Response.error();
        })
    );
  }

  // For same-origin static assets (CSS/JS/images), do stale-while-revalidate
  if (sameOrigin(req.url)) {
    // Don’t try to cache HTML documents here; handled by the navigate branch above
    const accept = req.headers.get('accept') || '';
    const isHTML = accept.includes('text/html');
    if (isHTML) return; // let the navigate handler deal with it

    return event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(req);

        const networkFetch = fetch(req)
          .then((res) => {
            // Only cache successful, basic responses
            if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
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
});

// Push notifications - now using the Firebase SDK
messaging.onBackgroundMessage((payload) => {
  console.log('Received background message ', payload);
  const notificationTitle = payload.notification.title;
  const notificationOptions = {
    body: payload.notification.body,
    icon: payload.notification.icon || '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png'
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
