const CACHE_NAME = 'goodstock-shell-v62';
const APP_SHELL = ['/', '/index.html', '/i18n.js', '/app.js', '/kitchen-tools.js', '/kitchen-reference.js', '/recipe-import.mjs', '/mealie.mjs', '/deepl.mjs', '/styles.css', '/manifest.webmanifest', '/icon.svg', '/apple-touch-icon.png', '/icon-192.png', '/ingredients.json', '/fonts/fonts.css', '/fonts/dm-sans-latin.woff2', '/fonts/dm-sans-latin-ext.woff2', '/fonts/fraunces-latin.woff2', '/fonts/fraunces-latin-ext.woff2'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin || requestUrl.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(async () => {
    const cached = await caches.match(event.request);
    return cached || caches.match('/');
  }));
});