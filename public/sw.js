// ======================================
// SERVICE WORKER
// - Interfaz (HTML/CSS/JS/iconos): caché primero, se actualiza en segundo plano.
//   Así la app abre al instante aunque el Wi-Fi esté caído o muy lento.
// - /api/*: no se intercepta. Los datos viven en IndexedDB (ver app.js).
// ======================================
const CACHE_NAME = 'dashboard-tickets-v2';

const ARCHIVOS = [
    '/',
    '/index.html',
    '/css/styles.css',
    '/js/app.js',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ARCHIVOS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const req = event.request;
    const url = new URL(req.url);

    if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        const guardado = await cache.match(req, { ignoreSearch: true });

        // Actualiza en segundo plano (stale-while-revalidate)
        const red = fetch(req).then(resp => {
            if (resp.ok && resp.type === 'basic') cache.put(req, resp.clone());
            return resp;
        }).catch(() => null);

        if (guardado) {
            event.waitUntil(red);
            return guardado;
        }

        const resp = await red;
        if (resp) return resp;
        if (req.mode === 'navigate') return cache.match('/index.html');
        return new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    })());
});
