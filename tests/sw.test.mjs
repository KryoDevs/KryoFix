import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

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
    runInNewContext(readFileSync(new URL('../app/sw.js', import.meta.url), 'utf8'), {
        self: { addEventListener: (nombre, fn) => { eventos[nombre] = fn; }, location: { origin: 'https://ejemplo.test' }, clients: { claim: async () => {} } },
        caches: { open: async () => cache, keys: async () => ['techfix-app-v1', 'otra-app-v1', 'techfix-app-v18'], delete: async (n) => borradas.push(n) },
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

test('SW no intercepta ni cachea API privada del mismo origen', () => {
    const { eventos } = montarWorker();
    eventos.fetch({ request: { method: 'GET', mode: 'cors', url: 'https://ejemplo.test/api/leer-archivo' }, respondWith: () => assert.fail('Una API privada no puede entrar en caché') });
});

test('SW devuelve página de aprobación y no login al abrir enlace sin red', async () => {
    const { eventos } = montarWorker(); let respuesta;
    eventos.fetch({ request: { method: 'GET', mode: 'navigate', url: 'https://ejemplo.test/aprobacion.html#token' }, respondWith: p => { respuesta = p; } });
    assert.equal((await respuesta).pagina, './aprobacion.html');
});
