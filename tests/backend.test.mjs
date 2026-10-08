import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearBackend, resumen } from '../functions/motor.js';
import { crearFirestoreFalso } from './helpers/entorno.mjs';
const presupuesto = { version: 1, total: 12000, lineas: [{ concepto: 'Pantalla', cantidad: 1, precio: 12000 }], condiciones: 'Garantía según diagnóstico', plazo: '3 días', autorizacion: { estado: 'pendiente' } };
const base = { uid: 'ana', cliente: 'Privado', telefono: '56912345678', pin: '1234', estado: 'revision', revisionOrden: 0, costo: 12000, abono: 0, presupuesto };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
function entorno(parche = {}, opciones = {}) {
    const db = crearFirestoreFalso({ equipos: { a: { ...base, ...parche } } });
    let tiempo = Date.UTC(2026, 9, 6, 12);
    const objetos = new Map();
    const bucket = { file: ruta => ({
        async save(bytes) { if (objetos.has(ruta)) throw Object.assign(new Error('Ya existe'), { code: 412 }); objetos.set(ruta, bytes); },
        async download() { if (!objetos.has(ruta)) throw new Error('No existe'); return [objetos.get(ruta)]; },
        async delete() { objetos.delete(ruta); }
    }) };
    const b = crearBackend({ db, stamp: () => tiempo, ahora: () => tiempo, bucket, ...opciones });
    return { b, db, objetos, avanzar: ms => { tiempo += ms; }, p: () => db._datos.get('equipos').get('a') };
}
test('aprobación expone solo presupuesto, almacena hash y confirma una sola decisión', async () => {
    const c = entorno(), { token } = await c.b.emitirEnlace('ana', 'a');
    assert.equal(token.length, 43);
    const publica = await c.b.aprobar(token);
    assert.deepEqual(Object.keys(publica).sort(), ['expira', 'presupuesto']);
    assert.ok(!JSON.stringify(publica).includes('1234'));
    assert.ok(!JSON.stringify([...c.db._datos.get('aprobacionesPrivadas')]).includes(token));
    await c.b.aprobar(token, 'aprobado', 'Cliente uno');
    await c.b.aprobar(token, 'aprobado', 'Cliente uno');
    assert.equal(c.p().presupuesto.autorizacion.medio, 'enlace-protegido');
    assert.equal(c.p().revisionOrden, 2);
    await assert.rejects(c.b.aprobar(token, 'rechazado', 'Cliente uno'), { status: 409 });
    await assert.rejects(c.b.emitirEnlace('otra', 'a'), { status: 404 });
});
test('enlace nuevo revoca anterior; vencimiento y cambio de versión bloquean uso', async () => {
    const c = entorno(), a = await c.b.emitirEnlace('ana', 'a'), b = await c.b.emitirEnlace('ana', 'a');
    await assert.rejects(c.b.aprobar(a.token), { status: 410 });
    c.avanzar(49 * 3600000); await assert.rejects(c.b.aprobar(b.token), { status: 410 });
    const d = await c.b.emitirEnlace('ana', 'a');
    await c.db.collection('equipos').doc('a').update({ presupuesto: { ...presupuesto, version: 2 } });
    await assert.rejects(c.b.aprobar(d.token), { status: 410 });
});
test('dos decisiones concurrentes no sobrescriben la primera', async () => {
    const c = entorno(), { token } = await c.b.emitirEnlace('ana', 'a');
    const r = await Promise.allSettled([c.b.aprobar(token, 'aprobado', 'Cliente uno'), c.b.aprobar(token, 'rechazado', 'Cliente uno')]);
    assert.equal(r.filter(x => x.status === 'fulfilled').length, 1);
});
test('migración verifica copia privada, es idempotente y niega acceso ajeno', async () => {
    const c = entorno({ evidencia: png });
    await c.b.migrarArchivo('ana', 'a', 'evidencia');
    await c.b.migrarArchivo('ana', 'a', 'evidencia');
    assert.equal(c.p().evidencia, ''); assert.equal(c.objetos.size, 1);
    assert.equal((await c.b.leerArchivo('ana', 'a', 'evidencia')).dataUrl, png);
    await assert.rejects(c.b.leerArchivo('otra', 'a', 'evidencia'), { status: 404 });
    await assert.rejects(c.b.migrarArchivo('ana', 'a', '../firmaCliente'), { status: 400 });
});
test('copia corrupta conserva original; retención nunca borra por defecto', async () => {
    const mala = entorno({ evidencia: png }, { bucket: { file: () => ({ save: async () => {}, download: async () => [Buffer.from('corrupto')] }) } });
    await assert.rejects(mala.b.migrarArchivo('ana', 'a', 'evidencia'), { status: 500 });
    assert.equal(mala.p().evidencia, png);
    const c = entorno({ evidencia: png });
    await c.b.migrarArchivo('ana', 'a', 'evidencia'); c.avanzar(366 * 86400000);
    await c.b.purgarOrden('a'); assert.equal(c.objetos.size, 1);
    await assert.rejects(c.b.retencion('ana', 'a', 90, false), { status: 400 });
    await c.b.retencion('ana', 'a', 90, true); c.avanzar(91 * 86400000);
    await c.b.purgarOrden('a'); assert.equal(c.objetos.size, 0); assert.ok(c.p().archivos.evidencia.borrado);
});
test('cola exige consentimiento, deduplica y cancela al revocarlo', async () => {
    let envios = 0;
    const c = entorno({ estado: 'reparado' }, { habilitarEnvios: true, proveedor: async () => { envios++; return { id: 'proveedor-1' }; } });
    await assert.rejects(c.b.encolar('ana', 'a', 'retiro', 'op'), { status: 409 });
    await c.b.consentimiento('ana', 'a', true, 'Consentimiento firmado en recepción');
    const r = await c.b.encolar('ana', 'a', 'retiro', 'op'); await c.b.encolar('ana', 'a', 'retiro', 'op');
    assert.equal(c.db._datos.get('colaMensajes').size, 1);
    await c.b.consentimiento('ana', 'a', false, 'Cliente solicita revocación');
    await c.b.procesarMensaje(r.id); assert.equal(envios, 0);
    assert.equal(c.db._datos.get('colaMensajes').get(r.id).estado, 'cancelado');
});
test('lease evita dos workers; aceptado no significa entregado; callback verifica proveedor', async () => {
    let envios = 0;
    const c = entorno({ estado: 'reparado' }, { habilitarEnvios: true, proveedor: async () => { envios++; return { id: 'p1' }; } });
    await c.b.consentimiento('ana', 'a', true, 'Permiso en recepción');
    const r = await c.b.encolar('ana', 'a', 'retiro', 'op');
    await Promise.all([c.b.procesarMensaje(r.id), c.b.procesarMensaje(r.id)]);
    assert.equal(envios, 1); assert.equal(c.db._datos.get('colaMensajes').get(r.id).estado, 'aceptado');
    await assert.rejects(c.b.confirmarMensaje(r.id, 'falso', 'entregado'), { status: 409 });
    await c.b.confirmarMensaje(r.id, 'p1', 'entregado');
    await c.b.confirmarMensaje(r.id, 'p1', 'fallido');
    assert.equal(c.db._datos.get('colaMensajes').get(r.id).estado, 'entregado');
});
test('error de proveedor programa reintento y luego corta tras cinco intentos', async () => {
    const c = entorno({ estado: 'reparado' }, { habilitarEnvios: true, proveedor: async () => { throw new Error('timeout'); } });
    await c.b.consentimiento('ana', 'a', true, 'Permiso en recepción');
    const r = await c.b.encolar('ana', 'a', 'retiro', 'op');
    for (let i = 0; i < 5; i++) { await c.b.procesarMensaje(r.id); c.avanzar(3600001); }
    assert.equal(c.db._datos.get('colaMensajes').get(r.id).estado, 'revision-manual');
});
test('métricas separan saldo y pagos por mes de Santiago, sin inventar cobros de apertura', () => {
    const ahora = Date.UTC(2026, 9, 6, 12);
    const r = resumen([{ costo: 10000, abono: 4000, estado: 'reparado' }], [{ monto: 4000 }, { monto: 2000, confirmado: ahora }, { monto: -1000, confirmado: ahora }], ahora);
    assert.equal(r.saldo, 6000); assert.equal(r.netoMes, 1000); assert.equal(r.activas, 1); assert.equal(r.periodo, '2026-10');
});

test('no emite enlaces con totales inconsistentes ni saldo superior al presupuesto', async () => {
    const a = entorno({ presupuesto: { ...presupuesto, total: 1 } });
    await assert.rejects(a.b.emitirEnlace('ana', 'a'), { status: 409 });
    const b = entorno({ costo: 1 }); await assert.rejects(b.b.emitirEnlace('ana', 'a'), { status: 409 });
    const c = entorno({ abono: 15000 }); await assert.rejects(c.b.emitirEnlace('ana', 'a'), { status: 409 });
});

test('no se extiende retención ni reemplaza un archivo mientras se está eliminando', async () => {
    const c = entorno({ evidencia: png });
    await c.b.migrarArchivo('ana', 'a', 'evidencia');
    await c.db.collection('equipos').doc('a').update({ evidencia: png, archivos: { evidencia: { ...c.p().archivos.evidencia, eliminando: true } } });
    await assert.rejects(c.b.retencion('ana', 'a', 365, true), { status: 409 });
    await assert.rejects(c.b.migrarArchivo('ana', 'a', 'evidencia'), { status: 409 });
    assert.equal(c.p().evidencia, png);
    await assert.rejects(c.b.leerArchivo('ana', 'a', 'evidencia'), { status: 404 });
});


test('callback temprano o después de respuesta perdida no se degrada a aceptado/reintento', async () => {
    for (const perderRespuesta of [false, true]) {
        let c;
        c = entorno({ estado: 'reparado' }, { habilitarEnvios: true, proveedor: async datos => {
            await c.b.confirmarMensaje(datos.idempotencyKey, 'p-temprano', 'entregado');
            if (perderRespuesta) throw new Error('Se perdió la respuesta HTTP');
            return { id: 'p-temprano' };
        } });
        await c.b.consentimiento('ana', 'a', true, 'Permiso en recepción');
        const r = await c.b.encolar('ana', 'a', 'retiro', 'op');
        await c.b.procesarMensaje(r.id);
        assert.equal(c.db._datos.get('colaMensajes').get(r.id).estado, 'entregado');
    }
});
