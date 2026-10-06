import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarApp, tick } from './helpers/entorno.mjs';

test('primera instalación no abre modal ni anuncia actualización aunque WebKit ya tenga controller', async t => {
    let updatefound, statechange;
    const nuevo = { state: 'installing', addEventListener: (_tipo, cb) => { statechange = cb; } };
    const registro = { active: null, waiting: null, installing: nuevo, addEventListener: (_tipo, cb) => { updatefound = cb; } };
    const sw = { controller: null, register: async () => registro };
    const c = montarApp({ antesDeIniciar(w) { Object.defineProperty(w.navigator, 'serviceWorker', { value: sw }); } });
    t.after(() => c.window.close()); await tick();
    updatefound();
    // Simula el orden de eventos observado: controller llega antes del callback instalado.
    sw.controller = nuevo; registro.active = nuevo; nuevo.state = 'installed'; statechange();
    assert.equal(c.document.getElementById('actualizacion-disponible'), null);
    assert.equal(c.swal.llamadas.some(x => x.title === 'Version nueva disponible'), false);
});

test('actualización real es no modal y no recarga una recepción pendiente', async t => {
    let enviados = 0;
    const viejo = {}, nuevo = { postMessage: () => { enviados++; } };
    const registro = { active: viejo, waiting: nuevo, addEventListener() {} };
    const sw = { controller: viejo, register: async () => registro, addEventListener() {} };
    const c = montarApp({ antesDeIniciar(w) { Object.defineProperty(w.navigator, 'serviceWorker', { value: sw }); } });
    t.after(() => c.window.close()); await tick();
    const aviso = c.document.getElementById('actualizacion-disponible'); assert.ok(aviso);
    assert.equal(c.swal.llamadas.some(x => x.title === 'Version nueva disponible'), false);
    c.document.getElementById('cliente').value = 'Borrador privado'; aviso.querySelector('button').click();
    assert.equal(enviados, 0); assert.match(aviso.textContent, /Guarda o descarta/);
    c.document.getElementById('cliente').value = ''; aviso.querySelector('button').click(); assert.equal(enviados, 1);
});
