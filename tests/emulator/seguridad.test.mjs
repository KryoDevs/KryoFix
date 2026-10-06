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


// Construye una escritura maliciosa que omite el servicio del navegador.
function stockDirecto({ opId, disponible = 0, reservado = 1, repuestoId = 'lote' }) {
    const cliente = db('ana');
    const batch = cliente.batch();
    const reserva = { id: opId, repuestoId, nombre: 'Pantalla', cantidad: 1, costoUnitario: 20000, estado: 'reservada', en: 1 };
    batch.update(cliente.doc('equipos/a'), { reservas: [reserva], revisionOrden: 1, ultimaOperacion: opId, actualizado: serverTime() });
    batch.set(cliente.doc('usuarios/ana/eventos/' + opId), { uid: 'ana', ordenId: 'a', accion: 'reservar',
        huella: 'a'.repeat(64), resumen: 'Reserva', confirmado: serverTime(), revision: 1,
        repuesto: { repuestoId, cantidad: 1, reservaId: opId, antes: null, despues: reserva } });
    batch.update(cliente.doc('usuarios/ana/repuestos/lote'), { disponible, reservado,
        ultimaOperacion: opId, actualizado: serverTime() });
    return batch.commit();
}

test('reglas rechazan reserva sin autorización aunque se omita el servicio', async () => {
    const s = servicio('ana');
    await s.guardarRepuesto('ana', { nombre: 'Pantalla', marca: 'Apple', modelo: 'iPhone 13', cantidad: 1, costo: 20000 }, 'lote');
    await assert.rejects(s.ejecutar({ id: 'a', uid: 'ana', revision: 0, opId: 'servicio-denegado', accion: 'reservar',
        datos: { repuestoId: 'lote', cantidad: 1, compatibilidadConfirmada: true } }), { code: 'sin-autorizacion' });
    await assertFails(stockDirecto({ opId: 'cliente-malicioso' }));
    assert.equal((await db('ana').doc('usuarios/ana/repuestos/lote').get()).data().disponible, 1);
    assert.equal((await s.leerOrden('ana', 'a')).revisionOrden, 0);
});

test('reglas exigen lote y deltas exactos; servicio reserva, consume y libera', async () => {
    const s = servicio('ana');
    await entorno.withSecurityRulesDisabled(c => c.firestore().doc('equipos/a').update({ costo: 0 }));
    await s.guardarRepuesto('ana', { nombre: 'Pantalla', marca: 'Apple', modelo: 'iPhone 13', cantidad: 2, costo: 20000 }, 'lote');
    await assertFails(stockDirecto({ opId: 'cantidad-falsa', disponible: 0, reservado: 1 }));
    await assertFails(stockDirecto({ opId: 'lote-falso', disponible: 1, reservado: 1, repuestoId: 'otro-lote' }));
    await s.ejecutar({ id: 'a', uid: 'ana', revision: 0, opId: 'reserva-1', accion: 'reservar', datos: { repuestoId: 'lote', cantidad: 1, compatibilidadConfirmada: true } });
    await s.ejecutar({ id: 'a', uid: 'ana', revision: 1, opId: 'consumo-1', accion: 'consumir', datos: { repuestoId: 'lote', reservaId: 'reserva-1' } });
    await s.ejecutar({ id: 'a', uid: 'ana', revision: 2, opId: 'reserva-2', accion: 'reservar', datos: { repuestoId: 'lote', cantidad: 1, compatibilidadConfirmada: true } });
    await s.ejecutar({ id: 'a', uid: 'ana', revision: 3, opId: 'liberacion-2', accion: 'liberar', datos: { repuestoId: 'lote', reservaId: 'reserva-2' } });
    const stock = (await db('ana').doc('usuarios/ana/repuestos/lote').get()).data();
    assert.equal(stock.disponible, 1);
    assert.equal(stock.reservado, 0);
    await assertFails(db('ana').doc('usuarios/ana/repuestos/lote').update({ disponible: 0, reservado: 1, ultimaOperacion: 'reserva-2', actualizado: serverTime() }));
});

test('compra, recepción, ajustes y devolución atómicos con diario inmutable', async () => {
    const s = servicio('ana');
    await s.guardarCompra('ana', { nombre: 'Pantalla', marca: 'Apple', modelo: 'iPhone 13', proveedor: 'Proveedor', costo: 10000, cantidad: 3 }, 'compra');
    assert.equal((await s.listar('ana', 'repuestos')).length, 0);
    await assertFails(db('ana').doc('usuarios/ana/compras/compra').update({ estado: 'recibida', revision: 1, loteId: 'falso', actualizado: serverTime() }));
    await s.resolverCompra('ana', 'compra', 'recibir'); await s.resolverCompra('ana', 'compra', 'recibir');
    const datos = { repuestoId: 'compra-compra', tipo: 'devolucion', cantidad: 2, motivo: 'Defecto al recibir', baseDisponible: 3, baseReservado: 0 };
    await s.ajustarStock('ana', datos, 'devolucion'); await s.ajustarStock('ana', datos, 'devolucion');
    await s.ajustarStock('ana', { ...datos, tipo: 'entrada', cantidad: 1, baseDisponible: 1 }, 'entrada');
    assert.equal((await s.listar('ana', 'repuestos'))[0].disponible, 2);
    await assertFails(db('ana').doc('usuarios/ana/movimientosStock/devolucion').delete());
    await assertFails(db('ana').doc('usuarios/ana/repuestos/compra-compra').update({ disponible: 90, origenOperacion: 'inventario', ultimaOperacion: 'entrada', actualizado: serverTime() }));
    await assertFails(db('otro').collection('usuarios/ana/compras').get());
});

test('garantía genera nueva orden enlazada sin alterar entrega/pagos y rechaza origen ajeno', async () => {
    const s = servicio('ana');
    await entorno.withSecurityRulesDisabled(c => c.firestore().doc('equipos/a').update({ estado: 'entregado', abono: 50000, firmaCliente: 'firma-original' }));
    await s.crearRetrabajo('ana', 'a', 0, 'La pantalla volvió a fallar', 'hija');
    await s.crearRetrabajo('ana', 'a', 0, 'La pantalla volvió a fallar', 'hija');
    const padre = await s.leerOrden('ana', 'a'), hija = await s.leerOrden('ana', 'hija');
    assert.equal(padre.estado, 'entregado'); assert.equal(padre.abono, 50000); assert.equal(padre.firmaCliente, 'firma-original');
    assert.equal(hija.origenGarantia, 'a'); assert.equal(hija.idOrden, 'KRF-000002');
    await assertFails(db('otro').doc('equipos/hija').get());
    await assertFails(db('ana').doc('equipos/falsa').set({ ...base, schemaVersion: 1, origenGarantia: 'ajena' }));
});
