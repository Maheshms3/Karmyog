/* Karmyog SW – SEO-friendly caching + notifications + robust offline fallback */
importScripts('https://www.gstatic.com/firebasejs/9.6.7/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.6.7/firebase-messaging-compat.js');

const STATIC_CACHE = 'karmyog-static-v4';
const ASSET_CACHE  = 'karmyog-assets-v4';

// Precache only small, stable essentials
const PRECACHE = [
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512.png',
  '/icons/icon-512x512.png'
];

// Firebase config — must match index.html
const firebaseConfig = {
  apiKey: "AIzaSyA1YxzDZzzyIuAxjxzo_Vy3d8CLtHoBK44",
  authDomain: "karmyog.life",
  projectId: "karmyog-6da5f",
  // IMPORTANT: use the firebasestorage.app bucket (matches index.html)
  storageBucket: "karmyog-6da5f.firebasestorage.app",
  messagingSenderId: "331203556277",
  appId: "1:331203556277:web:b087b49debac40eeb6dffc",
  measurementId: "G-316W8DPVBN"
};

firebase.initializeApp(firebaseConfig);

// Guard: messaging may not be supported on all browsers/contexts
let messaging = null;
try {
  messaging = firebase.messaging();
} catch (_) {
  // no-op; push will just be disabled
}

// Utility to check same-origin
const sameOrigin = (url) =>
  new URL(url, self.location.origin).origin === self.location.origin;

// Optional: enable navigation preload for faster first paint
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Clean old caches
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => ![STATIC_CACHE, ASSET_CACHE].includes(k))
        .map((k) => caches.delete(k))
    );

    // Enable navigation preload if available
    if ('navigationPreload' in self.registration) {
      try { await self.registration.navigationPreload.enable(); } catch(_) {}
    }

    await self.clients.claim();
  })());
});

// Basic install: precache tiny essentials
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// SPA + SEO-friendly fetch handler
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Always bypass cache for sitemap/robots to avoid stale SEO files
  if (url.pathname === '/sitemap.xml' || url.pathname === '/robots.txt') {
    event.respondWith(fetch(req));
    return;
  }

  // Handle navigations with network-first (with preload) and offline fallback
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        // Try preload first (if enabled), else network
        const preload = await event.preloadResponse;
        const res = preload || await fetch(req);

        // Cache a fresh snapshot of index.html for future offline navigations
        try {
          const clone = res.clone();
          const cache = await caches.open(STATIC_CACHE);
          await cache.put('/index.html', clone);
        } catch (_) { /* ignore */ }

        return res;
      } catch (_) {
        // Offline fallback to last known index.html
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match('/index.html');
        return cached || Response.error();
      }
    })());
    return;
  }

  // For same-origin static assets (CSS/JS/images), use stale-while-revalidate
  if (sameOrigin(req.url)) {
    // Don’t handle HTML here; it’s covered by the navigate branch above
    const accept = req.headers.get('accept') || '';
    const isHTML = accept.includes('text/html');
    if (isHTML) return;

    event.respondWith((async () => {
      const cache = await caches.open(ASSET_CACHE);
      const cached = await cache.match(req);

      const networkFetch = fetch(req)
        .then((res) => {
          // Only cache successful, basic/cors responses
          if (res && res.status === 200 && (res.type === 'basic' || res.type === 'cors')) {
            cache.put(req, res.clone());
          }
          return res;
        })
        .catch(() => undefined);

      // Serve cached immediately, update in background when possible
      return cached || networkFetch || fetch(req);
    })());
    return;
  }

  // For cross-origin requests, default to network (let the browser handle)
  // You can add specific strategies here if you need (e.g., fonts CDN).
});

// Push notifications (Firebase)
if (messaging && typeof messaging.onBackgroundMessage === 'function') {
  messaging.onBackgroundMessage((payload) => {
    // Defensive checks
    const n = payload && payload.notification || {};
    const title = n.title || 'Karmyog';
    const options = {
      body: n.body || '',
      icon: n.icon || '/icons/icon-192x192.png',
      badge: '/icons/icon-192x192.png',
      // Optionally include click_action if sent, otherwise handle in notificationclick
      data: { click_action: n.click_action || '/' }
    };
    self.registration.showNotification(title, options);
  });
}

// Notification click → focus existing tab or open /
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification && event.notification.data && event.notification.data.click_action) || '/';
  event.waitUntil((async () => {
    const list = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      // Reuse any visible client
      if ('focus' in c) return c.focus();
    }
    if (clients.openWindow) return clients.openWindow(target);
  })());
});

// Allow page to request an immediate SW activation after update
// usage from page: navigator.serviceWorker.controller.postMessage({type:'SKIP_WAITING'})
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
