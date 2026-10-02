/* =============================================================================
 * Service Worker de TechFix Tracker
 *
 * Estrategias:
 *   - Navegaciones (HTML): red primero, cache de respaldo => el codigo nuevo
 *     llega de inmediato y la app sigue abriendo sin conexion.
 *   - Estaticos propios (css/js/img): stale-while-revalidate => respuesta
 *     instantanea y actualizacion en segundo plano.
 *   - Librerias de terceros con version fija en la URL: cache primero
 *     (son inmutables). Precachearlas es lo que hace que la PWA funcione
 *     realmente offline.
 *   - Firestore / Auth / APIs: NUNCA se interceptan.
 * ========================================================================== */

const VERSION = 'v4';
const CACHE_APP = `techfix-app-${VERSION}`;
const CACHE_EXTERNO = `techfix-vendor-${VERSION}`;
const CACHES_VIGENTES = [CACHE_APP, CACHE_EXTERNO];

const RECURSOS_APP = [
    './',
    './index.html',
    './status.html',
    './estilos.css',
    './tema.js',
    './app.js',
    './status.js',
    './manifest.json',
    './logo.jpg',
    './icon-192.png',
    './icon-512.png'
];

// URLs versionadas e inmutables: seguro cachearlas indefinidamente.
const RECURSOS_EXTERNOS = [
    'https://cdn.jsdelivr.net/npm/sweetalert2@11.14.5/dist/sweetalert2.all.min.js',
    'https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/10.8.1/firebase-auth-compat.js',
    'https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore-compat.js'
];

// Dominios que gestionan su propio transporte/offline: dejarlos pasar siempre.
const DOMINIOS_EXCLUIDOS = [
    'firestore.googleapis.com',
    'firebaseinstallations.googleapis.com',
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com',
    'firebaseio.com',
    'google-analytics.com',
    'api.qrserver.com'
];

/**
 * Cachea cada recurso por separado: con cache.addAll un solo 404 aborta toda la
 * instalacion y la app se queda sin modo offline.
 */
async function precachearTolerante(nombreCache, urls) {
    const cache = await caches.open(nombreCache);
    await Promise.all(
        urls.map((url) =>
            cache.add(new Request(url, { cache: 'reload' })).catch((err) => {
                console.warn('[SW] No se pudo precachear', url, err && err.message);
            })
        )
    );
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        (async () => {
            await precachearTolerante(CACHE_APP, RECURSOS_APP);
            await precachearTolerante(CACHE_EXTERNO, RECURSOS_EXTERNOS);
            // Activa la version nueva sin esperar a que se cierren las pestanas.
            await self.skipWaiting();
        })()
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            const nombres = await caches.keys();
            await Promise.all(nombres.filter((n) => !CACHES_VIGENTES.includes(n)).map((n) => caches.delete(n)));
            await self.clients.claim();
        })()
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

async function redPrimero(request, nombreCache) {
    const cache = await caches.open(nombreCache);
    try {
        const respuesta = await fetch(request);
        if (respuesta && respuesta.ok) cache.put(request, respuesta.clone());
        return respuesta;
    } catch (_e) {
        const enCache = (await cache.match(request)) || (await cache.match('./index.html'));
        if (enCache) return enCache;
        return new Response('<h1>Sin conexion</h1><p>Abre la app una vez con internet para habilitar el modo offline.</p>', {
            status: 503,
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
    }
}

async function staleWhileRevalidate(request, nombreCache) {
    const cache = await caches.open(nombreCache);
    const enCache = await cache.match(request);
    const red = fetch(request)
        .then((respuesta) => {
            if (respuesta && respuesta.ok) cache.put(request, respuesta.clone());
            return respuesta;
        })
        .catch(() => null);
    return enCache || (await red) || new Response('', { status: 504 });
}

async function cachePrimero(request, nombreCache) {
    const cache = await caches.open(nombreCache);
    const enCache = await cache.match(request);
    if (enCache) return enCache;
    const respuesta = await fetch(request);
    if (respuesta && (respuesta.ok || respuesta.type === 'opaque')) cache.put(request, respuesta.clone());
    return respuesta;
}

self.addEventListener('fetch', (event) => {
    const { request } = event;

    // Interceptar POST/PUT/DELETE rompia las escrituras a Firestore.
    if (request.method !== 'GET') return;

    let url;
    try {
        url = new URL(request.url);
    } catch (_e) {
        return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (DOMINIOS_EXCLUIDOS.some((d) => url.hostname === d || url.hostname.endsWith('.' + d))) return;

    if (request.mode === 'navigate') {
        event.respondWith(redPrimero(request, CACHE_APP));
        return;
    }

    if (url.origin === self.location.origin) {
        event.respondWith(staleWhileRevalidate(request, CACHE_APP));
        return;
    }

    if (RECURSOS_EXTERNOS.some((r) => request.url.startsWith(r.split('?')[0]))) {
        event.respondWith(cachePrimero(request, CACHE_EXTERNO));
    }
    // Cualquier otro origen desconocido pasa directo a la red.
});
