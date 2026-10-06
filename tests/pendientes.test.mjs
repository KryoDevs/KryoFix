import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarApp } from './helpers/entorno.mjs';
function iniciar(t) {
    const c = montarApp({ semilla: { equipos: { original: { uid: 'ana', estado: 'entregado', revisionOrden: 0, cliente: 'Ana', equipo: 'Apple', modelo: 'iPhone 13', costo: 100, abono: 100, firmaCliente: 'firma-original', pin: '' } } } });
    t.after(() => c.window.close());
    c.auth._entrar({ uid: 'ana', email: 'ana@example.test' });
    return { ...c, s: c.window.KryoFixTallerServicio.crear({ db: c.db, usuario: () => c.auth.currentUser, enLinea: () => true, timestampServidor: () => c.db.FieldValue.serverTimestamp() }) };
}
const compra = { nombre: 'Pantalla', marca: 'Apple', modelo: 'iPhone 13', variante: 'A2633', proveedor: 'Proveedor', cantidad: 3, costo: 10000 };
test('compra pendiente no aumenta stock; recepción repetida produce un único lote', async t => {
    const { s } = iniciar(t);
    await s.guardarCompra('ana', compra, 'compra');
    await s.guardarCompra('ana', compra, 'compra');
    await assert.rejects(s.guardarCompra('ana', { ...compra, cantidad: 4 }, 'compra'), { code: 'id-reutilizado' });
    assert.equal((await s.listar('ana', 'repuestos')).length, 0);
    await s.resolverCompra('ana', 'compra', 'recibir');
    await s.resolverCompra('ana', 'compra', 'recibir');
    const stock = await s.listar('ana', 'repuestos');
    assert.equal(stock.length, 1); assert.equal(stock[0].disponible, 3);
    await assert.rejects(s.resolverCompra('ana', 'compra', 'cancelar'), { code: 'conflicto' });
});
test('compra cancelada no se recibe ni crea stock', async t => {
    const { s } = iniciar(t);
    await s.guardarCompra('ana', compra, 'compra');
    await s.resolverCompra('ana', 'compra', 'cancelar');
    await assert.rejects(s.resolverCompra('ana', 'compra', 'recibir'), { code: 'conflicto' });
    assert.equal((await s.listar('ana', 'repuestos')).length, 0);
});
test('ajustes y devoluciones conservan reservado, motivo e idempotencia', async t => {
    const { s, db } = iniciar(t);
    await s.guardarRepuesto('ana', compra, 'lote');
    const datos = { repuestoId: 'lote', tipo: 'devolucion', cantidad: 2, motivo: 'Pantallas defectuosas, comprobante 123', baseDisponible: 3, baseReservado: 0 };
    await s.ajustarStock('ana', datos, 'devolucion');
    await s.ajustarStock('ana', datos, 'devolucion');
    assert.equal(db._datos.get('usuarios/ana/repuestos').get('lote').disponible, 1);
    assert.equal((await s.listar('ana', 'movimientosStock')).length, 1);
    await assert.rejects(s.ajustarStock('ana', { ...datos, cantidad: 1 }, 'devolucion'), { code: 'id-reutilizado' });
    await assert.rejects(s.ajustarStock('ana', datos, 'otra'), { code: 'conflicto' });
    await assert.rejects(s.ajustarStock('ana', { ...datos, baseDisponible: 1 }, 'otra'), { code: 'sin-stock' });
    await s.ajustarStock('ana', { ...datos, tipo: 'entrada', baseDisponible: 1 }, 'entrada');
    assert.equal(db._datos.get('usuarios/ana/repuestos').get('lote').disponible, 3);
});
test('garantía crea orden vinculada, correlativo único y no copia dinero ni firma', async t => {
    const { s, db } = iniciar(t);
    await s.crearRetrabajo('ana', 'original', 0, 'Falla de pantalla recurrente', 'hija');
    await s.crearRetrabajo('ana', 'original', 0, 'Falla de pantalla recurrente', 'hija');
    const p = await s.leerOrden('ana', 'original'), h = await s.leerOrden('ana', 'hija');
    assert.equal(p.estado, 'entregado'); assert.equal(p.abono, 100); assert.equal(p.firmaCliente, 'firma-original');
    assert.equal(p.garantia.ordenRetrabajo, 'hija'); assert.equal(h.origenGarantia, 'original');
    assert.equal(h.costo, 0); assert.equal(h.abono, 0); assert.equal(h.firmaCliente, undefined);
    assert.equal(db._datos.get('usuarios/ana/config').get('numeracion').numero, 1);
    await assert.rejects(s.crearRetrabajo('ana', 'original', 1, 'Otro caso del mismo equipo', 'otra'), { code: 'conflicto' });
    await s.ejecutar({ uid: 'ana', id: 'original', revision: 1, opId: 'cerrar', accion: 'garantia', datos: { motivo: 'Falla de pantalla recurrente', estado: 'cerrada', resultado: 'Reparada y probada' } });
    assert.equal((await s.leerOrden('ana', 'original')).garantia.ordenRetrabajo, 'hija');
});
