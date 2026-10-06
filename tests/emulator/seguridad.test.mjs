import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

// Mismos módulos de dominio/servicio que usa el navegador, contra Firestore real emulado.
globalThis.window = globalThis;
await import('../../app/dominio.js');
await import('../../app/taller-dominio.js');
await import('../../app/taller-servicio.js');
await import('../../app/borradores.js');
await import('../../app/ordenes-repositorio.js');
let entorno;
const base = { uid: 'ana', cliente: 'Cliente', telefono: '56912345678', equipo: 'Apple', modelo: 'iPhone 13',
    estado: 'ingresado', costo: 50000, abono: 0, timestamp: 1, schemaVersion: 2, revisionOrden: 0, idOrden: 'KRF-000001', numeroOrden: 1 };
const serverTime = () => firebase.firestore.FieldValue.serverTimestamp();
const db = uid => entorno.authenticatedContext(uid).firestore();
const servicio = uid => globalThis.KryoFixTallerServicio.crear({ db: db(uid), usuario: () => ({ uid }), enLinea: () => true, timestampServidor: serverTime });
before(async () => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Usa npm run test:rules. Nunca ejecutar estas pruebas contra producción.');
    entorno = await initializeTestEnvironment({ projectId: 'demo-kryofix', firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') } });
});
beforeEach(async () => {
    await entorno.clearFirestore();
    await entorno.withSecurityRulesDisabled(async c => {
        await c.firestore().collection('equipos').doc('a').set(base);
        await c.firestore().collection('usuarios/ana/config').doc('numeracion').set({ numero: 1 });
    });
});
after(async () => { if (entorno) await entorno.cleanup(); });

test('aislamiento real: dueño, tercero y anónimo; no listados públicos', async () => {
    await assertSucceeds(db('ana').collection('equipos').doc('a').get());
    await assertFails(db('otro').collection('equipos').doc('a').get());
    await assertFails(entorno.unauthenticatedContext().firestore().collection('equipos').doc('a').get());
    await assertFails(entorno.unauthenticatedContext().firestore().collection('seguimiento').get());
    await assertFails(db('otro').collection('usuarios/ana/repuestos').get());
    await assertFails(db('otro').collection('usuarios/ana/eventos').get());
});

test('bloquea montos inválidos, propietario alterado y actualización sin evento/revisión', async () => {
    const ref = db('ana').collection('equipos').doc('a');
    await assertFails(ref.update({ costo: -1 }));
    await assertFails(ref.update({ uid: 'otro' }));
    await assertFails(ref.update({ abono: 60000 }));
    await assertFails(ref.update({ estado: 'reparado' }));
    await assertFails(ref.update({ schemaVersion: 1 }));
});

test('ingreso transaccional asigna correlativo y publica solo espejo permitido', async () => {
    const s = servicio('ana');
    const nueva = await s.crearOrden('ana', { ...base, schemaVersion: 1 }, 'nueva');
    assert.equal(nueva.idOrden, 'KRF-000002');
    const publico = await entorno.unauthenticatedContext().firestore().collection('seguimiento').doc('nueva').get();
    assert.deepEqual(Object.keys(publico.data()).sort(), ['actualizado', 'estado', 'modelo', 'uid']);
    await assertFails(db('ana').collection('seguimiento').doc('nueva').update({ pin: '1234' }));
    await assertFails(db('ana').collection('seguimiento').doc('nueva').update({ estado: 'entregado' }));
});

test('presupuesto, pago, reverso y diario son atómicos e inmutables', async () => {
    const s = servicio('ana');
    await s.ejecutar({ id: 'a', uid: 'ana', revision: 0, opId: 'presupuesto', accion: 'presupuestar', datos: { lineas: [{ concepto: 'Reparación', cantidad: 1, precio: 50000 }] } });
    await s.ejecutar({ id: 'a', uid: 'ana', revision: 1, opId: 'pago', accion: 'pago', datos: { monto: 10000, medio: 'efectivo' } });
    await s.ejecutar({ id: 'a', uid: 'ana', revision: 2, opId: 'reverso', accion: 'reverso', datos: { pagoId: 'pago', motivo: 'Devolución autorizada al cliente' } });
    const orden = await s.leerOrden('ana', 'a');
    assert.equal(orden.abono, 0);
    await assertFails(db('ana').collection('usuarios/ana/eventos').doc('pago').delete());
    await assertFails(db('ana').collection('usuarios/ana/eventos').doc('pago').update({ resumen: 'Alterado' }));
    await assertFails(db('ana').collection('usuarios/ana/pagos').doc('pago').update({ monto: 1 }));
    await assertFails(db('ana').collection('equipos').doc('a').delete());
});

test('procedimiento antiguo sin revisión se actualiza; entregado rechaza cambios', async () => {
    const repositorio = globalThis.KryoFixOrdenes.crear({ db: db('ana'), usuario: () => ({ uid: 'ana' }), enLinea: () => true, timestampServidor: serverTime });
    const guia = globalThis.TechFixDominio.crearProcedimiento();
    await repositorio.guardarProcedimiento({ id: 'a', uid: 'ana', base: 'null', guia });
    await assert.rejects(repositorio.guardarProcedimiento({ id: 'a', uid: 'ana', base: 'null', guia }), /Otra sesión/);
    await entorno.withSecurityRulesDisabled(c => c.firestore().collection('equipos').doc('a').update({ estado: 'entregado' }));
    await assertFails(db('ana').collection('equipos').doc('a').update({ procedimiento: { ...guia, revision: 2, por: 'ana', actualizado: serverTime() } }));
});

test('dos reservas concurrentes no consumen la misma última unidad', async () => {
    const s = servicio('ana');
    await entorno.withSecurityRulesDisabled(async c => {
        await c.firestore().collection('equipos').doc('a').update({ costo: 0 });
        await c.firestore().collection('equipos').doc('b').set({ ...base, costo: 0, idOrden: 'KRF-000002' });
    });
    await s.guardarRepuesto('ana', { nombre: 'Pantalla', marca: 'Apple', modelo: 'iPhone 13', cantidad: 1, costo: 20000 }, 'lote');
    const resultados = await Promise.allSettled(['a', 'b'].map(id => s.ejecutar({ id, uid: 'ana', revision: 0, opId: 'reserva-' + id,
        accion: 'reservar', datos: { repuestoId: 'lote', cantidad: 1, compatibilidadConfirmada: true } })));
    assert.equal(resultados.filter(r => r.status === 'fulfilled').length, 1);
    const stock = (await s.listar('ana', 'repuestos'))[0];
    assert.equal(stock.disponible, 0); assert.equal(stock.reservado, 1);
});
