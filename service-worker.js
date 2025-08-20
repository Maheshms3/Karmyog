// Define the cache name for your app's assets.
const CACHE_NAME = 'karmyog-v1';

// List all the essential files that make up the app's "shell".
// These will be cached so the app can load offline.
const urlsToCache = [
  '/', // The root of your site
  '/index.html', // The main HTML file
  'https://cdn.tailwindcss.com', // Tailwind CSS framework
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css', // Font Awesome icons
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap' // Google Fonts
];

/**
 * Installation Event:
 * This event is triggered when the service worker is first installed.
 * It opens a cache and adds the app shell files to it.
 */
self.addEventListener('install', event => {
  // waitUntil() ensures the service worker won't install until the code inside has successfully completed.
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        // addAll() fetches and caches all the specified URLs.
        return cache.addAll(urlsToCache);
      })
  );
});

/**
 * Fetch Event:
 * This event is triggered for every network request made by the page (e.g., for CSS, images, or data).
 * It allows the service worker to intercept the request and respond with a cached version if available.
 */
self.addEventListener('fetch', event => {
  // respondWith() hijacks the request and lets us provide our own response.
  event.respondWith(
    // caches.match() checks if the request exists in any of the caches.
    caches.match(event.request)
      .then(response => {
        // If a cached response is found (a "cache hit"), return it.
        if (response) {
          return response;
        }
        // If the request is not in the cache, let the browser handle it as a normal network request.
        return fetch(event.request);
      }
    )
  );
});
