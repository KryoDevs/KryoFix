/* =============================================================================
 * Service Worker de TechFix Tracker
 *
 * Estrategias:
 *   - Navegaciones (HTML): red primero, cache de respaldo => el codigo nuevo
 *     llega de inmediato y la app sigue abriendo sin conexion.
 *   - Librerias propias (vendor/): cache primero => sus nombres son fijos y su
 *     contenido inmutable. Precachearlas es lo que hace que la PWA funcione
 *     realmente offline (antes vivian en un CDN y no estaban en la cache).
 *   - Resto de estaticos propios (css/js/img): stale-while-revalidate =>
 *     respuesta instantanea y actualizacion en segundo plano.
 *   - Firestore / Auth / APIs: NUNCA se interceptan.
 * ========================================================================== */

const VERSION = 'v16';
const CACHE_APP = `techfix-app-${VERSION}`;
const CACHE_VENDOR = `techfix-vendor-${VERSION}`;
const CACHES_VIGENTES = [CACHE_APP, CACHE_VENDOR];

// Todo lo que hay que tener en disco para abrir la app sin conexion.
const RECURSOS_APP = [
    './',
    './index.html',
    './status.html',
    './aprobacion.html',
    './aprobacion.js',
    './estilos.css',
    './tema.js',
    './entorno.js',
    './dominio.js',
    './app.js',
    './borradores.js',
    './ordenes-repositorio.js',
    './taller-dominio.js',
    './taller-servicio.js',
    './ficha.js',
    './status.js',
    './manifest.json',
    './logo.jpg',
    './icon-192.png',
    './icon-512.png',
    './ticket-qr.png'
];

// Dependencias servidas desde el propio origen (app/vendor/), sin CDN.
const RECURSOS_VENDOR = [
    './vendor/firebase-app-compat.js',
    './vendor/firebase-auth-compat.js',
    './vendor/firebase-firestore-compat.js',
    './vendor/sweetalert2.all.min.js',
    './vendor/qrcode.js'
];

// Dominios que gestionan su propio transporte/offline: dejarlos pasar siempre.
const DOMINIOS_EXCLUIDOS = [
    'firestore.googleapis.com',
    'firebaseinstallations.googleapis.com',
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com',
    'firebaseio.com',
    'google-analytics.com',
    'googletagmanager.com'
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
            await precachearTolerante(CACHE_VENDOR, RECURSOS_VENDOR);
            // Activa la version nueva sin esperar a que se cierren las pestanas.
            await self.skipWaiting();
        })()
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            const nombres = await caches.keys();
            await Promise.all(nombres.filter((n) => n.startsWith('techfix-') && !CACHES_VIGENTES.includes(n)).map((n) => caches.delete(n)));
            await self.clients.claim();
        })()
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

async function redPrimero(request, nombreCache, respaldo) {
    const cache = await caches.open(nombreCache);
    try {
        const respuesta = await fetch(request);
        if (respuesta && respuesta.ok) cache.put(request, respuesta.clone());
        return respuesta;
    } catch (_e) {
        const enCache = (await cache.match(request)) || (respaldo ? await cache.match(respaldo) : null);
        if (enCache) return enCache;
        return new Response(
            '<h1>Sin conexion</h1><p>Abre la app una vez con internet para habilitar el modo offline.</p>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
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
    if (url.pathname.startsWith('/api/')) return; // Datos privados: jamás cachear API del mismo origen.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (DOMINIOS_EXCLUIDOS.some((d) => url.hostname === d || url.hostname.endsWith('.' + d))) return;

    if (request.mode === 'navigate') {
        const respaldo = url.pathname.endsWith('/status.html') ? './status.html' : url.pathname.endsWith('/aprobacion.html') ? './aprobacion.html' : './index.html';
        event.respondWith(redPrimero(request, CACHE_APP, respaldo));
        return;
    }

    if (url.origin === self.location.origin) {
        // Librerias del propio origen: inmutables, cache primero.
        if (url.pathname.includes('/vendor/')) {
            event.respondWith(cachePrimero(request, CACHE_VENDOR));
            return;
        }
        event.respondWith(staleWhileRevalidate(request, CACHE_APP));
    }
    // Cualquier otro origen desconocido pasa directo a la red.
});
