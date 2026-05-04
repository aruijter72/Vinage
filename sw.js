// Vinage Service Worker — network-first, cache as offline fallback
// SW_VERSION is stamped automatically by autopush.sh on every deploy.
const SW_VERSION = 'v1777926671';
const CACHE = `vinage-${SW_VERSION}`;

// Files to pre-cache on install (app shell)
const SHELL = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/i18n.js',
  '/js/db.js',
  '/js/api.js',
  '/js/sync.js',
  '/js/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

// ── Install: pre-cache app shell ──────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL))
  );
  // Activate immediately — don't wait for old tabs to close
  self.skipWaiting();
});

// ── Activate: delete every cache except the current one ──────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: network-first, fall back to cache ──────────────────────────────────
// Network-first means Safari always gets the latest code when online.
// Cache is only used when the network is unavailable (offline support).
self.addEventListener('fetch', e => {
  // Only handle GET requests for same-origin or our CDN assets
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // Let Firebase SDK and Firestore requests bypass the SW entirely
  if (
    url.hostname.includes('firebaseapp.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('firebasestorage.app')
  ) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Clone before consuming — put fresh copy in cache
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
