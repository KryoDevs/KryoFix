import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { crearFirestoreFalso, tick } from './helpers/entorno.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const leer = (p) => readFileSync(join(ROOT, p), 'utf8');

function montarStatus({ id = 'abc123', semilla = {} } = {}) {
    const virtualConsole = new VirtualConsole();
    const dom = new JSDOM(leer('app/status.html'), {
        url: `https://ejemplo.test/status.html${id ? '?id=' + id : ''}`,
        runScripts: 'outside-only',
        virtualConsole
    });
    const { window } = dom;
    const db = crearFirestoreFalso(semilla);
    window.firebase = { initializeApp: () => ({}), firestore: () => db };
    window.eval(leer('app/status.js'));
    return { window, document: window.document, db };
}

describe('Pagina publica de seguimiento', () => {
    test('lee el espejo publico y nunca la coleccion privada de equipos', async () => {
        const { db } = montarStatus({
            semilla: {
                seguimiento: { abc123: { estado: 'revision', modelo: 'iPhone 13' } },
                equipos: { abc123: { pin: '1234', telefono: '56999', cliente: 'Juan' } }
            }
        });
        await tick(10);
        const colecciones = db._oyentes.map((o) => o.coleccion);
        assert.ok(colecciones.includes('seguimiento'), 'debe suscribirse al espejo publico');
        assert.ok(!colecciones.includes('equipos'), 'NUNCA debe leer la coleccion privada equipos');
    });

    test('muestra la cascada de pasos segun el estado', async () => {
        const { document } = montarStatus({
            semilla: { seguimiento: { abc123: { estado: 'repuesto', modelo: 'Galaxy S22' } } }
        });
        await tick(10);
        assert.equal(document.getElementById('lbl-modelo').textContent, 'Galaxy S22');
        assert.ok(document.getElementById('step-ingresado').classList.contains('active'));
        assert.ok(document.getElementById('step-revision').classList.contains('active'));
        assert.ok(document.getElementById('step-repuesto').classList.contains('active'));
        assert.ok(!document.getElementById('step-reparado').classList.contains('active'));
    });

    test('el estado entregado tiene su propio paso y no invita a retirar', async () => {
        const { document } = montarStatus({
            semilla: { seguimiento: { abc123: { estado: 'entregado', modelo: 'Galaxy S22' } } }
        });
        await tick(10);
        const pasoEntregado = document.getElementById('step-entregado');
        assert.ok(pasoEntregado, 'debe existir el paso "entregado" en la linea de tiempo');
        assert.ok(pasoEntregado.classList.contains('active'));
        assert.equal(
            document.getElementById('msg-reparado').style.display,
            'none',
            'no debe pedirle al cliente que venga a retirar un equipo ya entregado'
        );
    });

    test('sin id muestra el error y no consulta la base', async () => {
        const { document, db } = montarStatus({ id: '' });
        await tick(10);
        assert.equal(document.getElementById('error').style.display, 'block');
        assert.equal(db._oyentes.length, 0);
    });

    test('un id inexistente muestra el error', async () => {
        const { document } = montarStatus({ id: 'noexiste', semilla: { seguimiento: {} } });
        await tick(10);
        assert.equal(document.getElementById('error').style.display, 'block');
        assert.equal(document.getElementById('content').style.display, 'none');
    });

    test('permite consultar manualmente una orden desde el buscador cuando se entra sin id', async () => {
        const { document } = montarStatus({
            id: '',
            semilla: { seguimiento: { orden99: { estado: 'reparado', modelo: 'Xiaomi 13T', actualizado: 1700000000000 } } }
        });
        await tick(10);
        assert.equal(document.getElementById('error').style.display, 'block');

        const input = document.getElementById('input-codigo-orden');
        const form = document.getElementById('form-buscar-orden');
        input.value = 'orden99';
        form.dispatchEvent(new document.defaultView.Event('submit', { bubbles: true, cancelable: true }));
        await tick(10);

        assert.equal(document.getElementById('content').style.display, 'block');
        assert.equal(document.getElementById('lbl-modelo').textContent, 'Xiaomi 13T');
        assert.equal(document.getElementById('progreso-porcentaje').textContent, '90%');
        assert.equal(document.getElementById('msg-reparado').style.display, 'block');
    });
});
