const CACHE_NAME = 'techfix-cache-v2';
const urlsToCache = [
    './',
    './index.html',
    './estilos.css',
    './app.js',
    './manifest.json',
    './logo.jpg',
    './icon-192.png',
    './icon-512.png'
];

// Instalar el Service Worker y guardar recursos en caché
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Archivos cacheados exitosamente');
                return cache.addAll(urlsToCache);
            })
    );
});

// Interceptar peticiones y responder con caché si no hay red
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Si el archivo está en la caché, devuélvelo
                if (response) {
                    return response;
                }
                // Si no está, búscalo en la red
                return fetch(event.request);
            })
    );
});

// Actualizar caché si hay una nueva versión
self.addEventListener('activate', event => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});
