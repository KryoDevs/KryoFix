import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// La version vigente se lee del propio service worker: si se escribe aqui, el
// test se rompe en cada publicacion que suba la version de cache.
const FUENTE_SW = readFileSync(new URL('../app/sw.js', import.meta.url), 'utf8');
const VERSION_VIGENTE = FUENTE_SW.match(/const VERSION = '([^']+)'/)[1];

function montarWorker() {
    const eventos = {};
    const borradas = [];
    const consultas = [];
    const cache = {
        match: async (clave) => {
            consultas.push(clave);
            return typeof clave === 'string' ? { pagina: clave } : null;
        }
    };
    runInNewContext(FUENTE_SW, {
        self: { addEventListener: (nombre, fn) => { eventos[nombre] = fn; }, location: { origin: 'https://ejemplo.test' }, clients: { claim: async () => {} } },
        caches: { open: async () => cache, keys: async () => ['techfix-app-v1', 'otra-app-v1', `techfix-app-${VERSION_VIGENTE}`], delete: async (n) => borradas.push(n) },
        fetch: async () => { throw new Error('Offline'); }, URL, console
    });
    return { eventos, borradas, consultas };
}

test('SW devuelve portal publico al abrir un QR sin red', async () => {
    const { eventos } = montarWorker();
    let respuesta;
    eventos.fetch({ request: { method: 'GET', mode: 'navigate', url: 'https://ejemplo.test/status.html?id=abc' }, respondWith: (p) => { respuesta = p; } });
    assert.equal((await respuesta).pagina, './status.html');
});

test('SW no borra caches de otras aplicaciones', async () => {
    const { eventos, borradas } = montarWorker();
    let terminado;
    eventos.activate({ waitUntil: (p) => { terminado = p; } });
    await terminado;
    assert.deepEqual(borradas, ['techfix-app-v1']);
});

test('al publicar una version nueva se borra la cache anterior de la app', async () => {
    const anterior = 'techfix-app-v' + (Number(VERSION_VIGENTE.slice(1)) - 1);
    const eventos = {};
    const borradas = [];
    const cache = { match: async () => null, put: async () => {}, addAll: async () => {} };
    runInNewContext(FUENTE_SW, {
        self: { addEventListener: (n, fn) => { eventos[n] = fn; }, location: { origin: 'https://ejemplo.test' }, clients: { claim: async () => {} } },
        caches: {
            open: async () => cache,
            keys: async () => [anterior, `techfix-vendor-${VERSION_VIGENTE}`, 'otra-app-v99'],
            delete: async (n) => borradas.push(n)
        },
        fetch: async () => { throw new Error('Offline'); }, URL, console
    });
    let terminado;
    eventos.activate({ waitUntil: (p) => { terminado = p; } });
    await terminado;
    // La cache vieja debearsi: si no, los equipos siguen viendo la version anterior.
    assert.ok(borradas.includes(anterior), 'la cache anterior debe eliminarse; borradas: ' + JSON.stringify(borradas));
    assert.ok(!borradas.includes('otra-app-v99'), 'no debe tocar caches de otras aplicaciones');
});

test('SW no intercepta ni cachea API privada del mismo origen', () => {
    const { eventos } = montarWorker();
    eventos.fetch({ request: { method: 'GET', mode: 'cors', url: 'https://ejemplo.test/api/leer-archivo' }, respondWith: () => assert.fail('Una API privada no puede entrar en caché') });
});

test('SW devuelve página de aprobación y no login al abrir enlace sin red', async () => {
    const { eventos } = montarWorker(); let respuesta;
    eventos.fetch({ request: { method: 'GET', mode: 'navigate', url: 'https://ejemplo.test/aprobacion.html#token' }, respondWith: p => { respuesta = p; } });
    assert.equal((await respuesta).pagina, './aprobacion.html');
});
