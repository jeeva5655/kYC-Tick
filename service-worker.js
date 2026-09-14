const CACHE_NAME = 'kyc-tick-cache-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/app.html',
  '/landing.css',
  '/landing.js',
  '/styles.css',
  '/app.js',
  '/icon-512.jpg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  // Only intercept GET requests
  if (event.request.method !== 'GET') {
    return;
  }
  
  // Do not intercept external API calls
  if (event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});
