import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepararSpark } from '../tools/preparar-spark.mjs';
import { reglasSpark } from '../tools/spark-reglas.mjs';
import { montarApp, tick } from './helpers/entorno.mjs';
const uid = 'ana';
const base = { uid, cliente: 'Cliente ficticio', telefono: '56912345678', equipo: 'Apple', modelo: 'iPhone 13', estado: 'ingresado', costo: 0, abono: 0, timestamp: 1, schemaVersion: 2, revisionOrden: 0 };
async function iniciar(t, extra = {}) {
    const c = montarApp({ semilla: { equipos: { a: { ...base, ...extra } } }, antesDeIniciar: w => { w.KryoFixEntorno.modo = 'spark'; } });
    t.after(() => c.dom.window.close()); c.auth._entrar({ uid, email: 'ana@example.test' }); await tick(); return c;
}
const boton = (c, texto) => [...c.document.querySelectorAll('#ficha-dialog button')].find(b => b.textContent === texto);
test('Spark rechaza rutas de backend sin fetch ni tokens; capacidades explícitas', async t => {
    const c = await iniciar(t); let peticiones = 0; c.window.fetch = () => { peticiones++; throw new Error('Prohibido'); };
    const s = c.window.TechFix.tallerServicio;
    assert.equal((await s.remoto('capacidades')).storage, false);
    for (const ruta of ['metricas', 'migrar-archivo', 'encolar', 'emitir-enlace', 'retencion']) await assert.rejects(s.remoto(ruta), { code: 'no-disponible-spark' });
    assert.equal(peticiones, 0);
});
test('Spark mantiene formularios reales y elimina migración, colas y enlaces de pago', async t => {
    const c = await iniciar(t, { evidencia: 'data:image/jpeg;base64,AAAA', presupuesto: { version: 1, total: 0, lineas: [], autorizacion: { estado: 'pendiente' } } });
    c.document.querySelector('[data-id="a"] [data-accion="ficha"]').click(); await tick();
    boton(c, 'Evidencias').click(); await tick();
    assert.ok(boton(c, 'Ver evidencia')); assert.ok(!boton(c, 'Migrar archivo a Storage privado'));
    assert.match(c.document.querySelector('.ficha-cuerpo').textContent, /80 KiB/);
    boton(c, 'Contacto').click(); await tick();
    assert.ok(boton(c, 'Abrir mensaje en WhatsApp')); assert.ok(boton(c, 'Registrar contacto realizado'));
    assert.ok(!boton(c, 'Programar mensaje de servicio'));
    boton(c, 'Presupuesto').click(); await tick();
    assert.ok(boton(c, 'Registrar decisión del cliente')); assert.ok(!boton(c, 'Generar enlace protegido para el cliente'));
});
test('Spark guarda presupuesto, aprobación y pago reales sin API', async t => {
    const c = await iniciar(t); const s = c.window.TechFix.tallerServicio;
    c.window.fetch = () => { throw new Error('No debe llamar servidor'); };
    await s.ejecutar({ uid, id: 'a', revision: 0, opId: 'presupuesto', accion: 'presupuestar', datos: { lineas: [{ concepto: 'Mano de obra', precio: 12000, cantidad: 1 }] } });
    await s.ejecutar({ uid, id: 'a', revision: 1, opId: 'autorizacion', accion: 'autorizar', datos: { estado: 'aprobado', version: 1, medio: 'presencial', evidencia: 'Cliente autorizó en el taller' } });
    const op = { uid, id: 'a', revision: 2, opId: 'pago', accion: 'pago', datos: { monto: 12000, medio: 'efectivo' } };
    await s.ejecutar(op); await s.ejecutar(op);
    assert.equal((await s.leerOrden(uid, 'a')).abono, 12000);
    assert.equal((await s.listar(uid, 'pagos')).length, 1);
});
test('Spark informa límites de imágenes y no guarda el ingreso sobredimensionado', async t => {
    const c = await iniciar(t); const s = c.window.TechFix.tallerServicio;
    await assert.rejects(s.crearOrden(uid, { ...base, evidencia: 'A'.repeat(81921) }, 'grande'), /80 KiB/);
    assert.equal(c.db._datos.get('equipos').has('grande'), false);
});
test('la aplicación falla cerrada si falta la configuración, sin fallback productivo', t => {
    const c = montarApp({ antesDeIniciar: w => { delete w.KryoFixEntorno; } }); t.after(() => c.dom.window.close());
    assert.match(c.document.getElementById('aviso-dependencias').textContent, /Configuración del taller/);
    assert.equal(c.window.TechFix.iniciada, false);
});
test('paquete Spark solo contiene recursos gratuitos, UID restringido y CSP de kryofix', t => {
    const temp = mkdtempSync(join(tmpdir(), 'kryofix-paquete-')); t.after(() => rmSync(temp, { recursive: true, force: true }));
    const salida = prepararSpark(join(temp, '.spark'), 'ana');
    const conf = JSON.parse(readFileSync(join(salida, 'firebase.json'), 'utf8'));
    assert.deepEqual(Object.keys(conf).sort(), ['firestore', 'hosting']); assert.deepEqual(conf.hosting.rewrites, []);
    assert.match(JSON.stringify(conf), /kryofix.firebaseapp.com/); assert.doesNotMatch(JSON.stringify(conf), /techfix-tracker-9a128/);
    const rules = readFileSync(join(salida, 'firestore.rules'), 'utf8');
    assert.match(rules, /request.auth.uid == 'ana'/); assert.match(rules, /archivosSpark\(request.resource.data\)/);
    assert.equal(existsSync(join(salida, 'functions')), false);
    assert.match(readFileSync(join(salida, 'app/entorno.js'), 'utf8'), /"modo":"spark"/);
    assert.match(readFileSync(join(salida, 'publicar-spark.mjs'), 'utf8'), /firestore:rules,firestore:indexes,hosting/);
    const indices = JSON.parse(readFileSync(join(salida, 'firestore.indexes.json'), 'utf8'));
    assert.equal(indices.fieldOverrides.length, 2);
});
test('UID no puede inyectar reglas y un cambio de plantilla bloquea la generación', () => {
    const baseRules = readFileSync('firestore.rules', 'utf8');
    for (const id of ['', "x' || true || '", '../ana']) assert.throws(() => reglasSpark(baseRules, id), /UID/);
    assert.throws(() => reglasSpark('', 'ana'), /plantilla/);
});


test('paquete personalizado rechaza otro usuario antes de cargar datos del taller', async t => {
    const c = montarApp({ antesDeIniciar: w => { w.KryoFixEntorno.modo = 'spark'; w.KryoFixEntorno.propietarioUid = 'dueno'; } });
    t.after(() => c.dom.window.close()); c.auth._entrar({ uid: 'otro', email: 'otro@example.test' }); await tick();
    assert.equal(c.document.getElementById('app-content').style.display, 'none');
    assert.equal(c.db._oyentes.length, 0);
    assert.ok(c.swal.llamadas.some(x => x.title === 'Cuenta no autorizada'));
});
