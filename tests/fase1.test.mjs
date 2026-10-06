import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarApp, tick } from './helpers/entorno.mjs';

const USUARIO = { uid: 'ana', email: 'ana@example.test' };
const equipo = extra => ({ uid: USUARIO.uid, cliente: 'Cliente', equipo: 'Apple', modelo: 'iPhone 13',
    estado: 'ingresado', costo: 20000, abono: 5000, timestamp: 1, ...extra });

async function iniciar(t, extras = {}) {
    const ctx = montarApp({ semilla: { equipos: { a: equipo(), b: equipo({ timestamp: 2 }), ...extras } } });
    t.after(() => ctx.dom.window.close());
    ctx.auth._entrar(USUARIO);
    await tick();
    ctx.bloque = () => ctx.document.querySelector('[data-id="a"] .procedimiento');
    ctx.cambiar = (id, valor) => {
        const nodo = ctx.document.getElementById(id);
        nodo.value = valor;
        nodo.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
    };
    ctx.marcar = () => ctx.bloque().querySelector('input').click();
    ctx.guardar = () => ctx.bloque().querySelector('[data-proc-campo="guardar"]').click();
    ctx.guia = () => ctx.window.TechFixDominio.crearProcedimiento('pantalla');
    ctx.remoto = procedimiento => ctx.db.collection('equipos').doc('a').update({ procedimiento });
    return ctx;
}

function salir(ctx) {
    const evento = new ctx.window.Event('beforeunload', { cancelable: true });
    ctx.window.dispatchEvent(evento);
    return evento.defaultPrevented;
}

test('KF-01: actualización ajena, filtros y ordenamiento conservan pasos, apertura y foco', async t => {
    const ctx = await iniciar(t);
    ctx.bloque().open = true;
    await tick();
    const check = ctx.bloque().querySelector('input');
    check.focus();
    check.click();
    await ctx.db.collection('equipos').doc('b').update({ notas: 'Cambio remoto en otra orden' });
    assert.equal(ctx.bloque().querySelector('input').checked, true);
    assert.equal(ctx.bloque().open, true);
    assert.equal(ctx.document.activeElement.getAttribute('data-proc-campo'), 'paso-0');
    ctx.cambiar('filtro-estado', 'reparado');
    assert.equal(ctx.bloque(), null);
    assert.equal(ctx.document.getElementById('borradores-status').hidden, false);
    ctx.cambiar('filtro-estado', 'activos');
    ctx.cambiar('ordenar-proyectos', 'antiguos');
    assert.equal(ctx.bloque().querySelector('input').checked, true);
    assert.equal(ctx.bloque().open, true);
    assert.equal(salir(ctx), true);
});

test('los cambios de plantilla sobreviven al renderizado; cancelar no los pierde', async t => {
    const ctx = await iniciar(t);
    const selector = ctx.bloque().querySelector('select');
    selector.value = 'bateria';
    selector.dispatchEvent(new ctx.window.Event('change'));
    await tick();
    ctx.marcar();
    ctx.window.TechFix.renderizarProyectos();
    assert.equal(ctx.bloque().querySelector('select').value, 'bateria');
    assert.equal(ctx.bloque().querySelector('input').checked, true);
    ctx.swal.respuesta = false;
    ctx.bloque().querySelector('[data-proc-campo="descartar"]').click();
    await tick();
    assert.equal(ctx.bloque().querySelector('input').checked, true);
});

test('confirmación de salida permite cancelar; salir limpia borradores y no almacena PIN', async t => {
    const ctx = await iniciar(t);
    ctx.marcar();
    ctx.swal.respuesta = false;
    ctx.document.getElementById('btn-logout').click();
    await tick();
    assert.equal(ctx.window.TechFix.proyectos().length, 2);
    assert.equal(ctx.bloque().querySelector('input').checked, true);
    ctx.swal.respuesta = true;
    ctx.document.getElementById('btn-logout').click();
    await tick();
    assert.equal(ctx.document.getElementById('borradores-status').hidden, true);
    assert.equal(salir(ctx), false);
    ctx.auth._entrar(USUARIO);
    await tick();
    assert.equal(ctx.bloque().querySelector('input').checked, false);
    assert.equal(ctx.window.localStorage.length, 0);
    assert.equal(ctx.window.sessionStorage.length, 0);
});

test('cambio de usuario forzado elimina borradores sin esperar confirmación', async t => {
    const ctx = await iniciar(t);
    ctx.marcar();
    ctx.auth._entrar({ uid: 'otro', email: 'otro@example.test' });
    await tick();
    assert.equal(ctx.bloque(), null);
    assert.equal(salir(ctx), false);
    ctx.auth._entrar(USUARIO);
    await tick();
    assert.equal(ctx.bloque().querySelector('input').checked, false);
});

test('KF-03: metadata de caché, escrituras pendientes y error no se anuncian como sincronizados', async t => {
    const ctx = await iniciar(t);
    const badge = ctx.document.getElementById('red-status');
    ctx.db._emitirMetadata({ fromCache: true, hasPendingWrites: false });
    assert.match(badge.textContent, /caché/);
    ctx.db._emitirMetadata({ fromCache: false, hasPendingWrites: true });
    assert.match(badge.textContent, /pendientes de sincronizar/);
    ctx.db._emitirMetadata({ fromCache: false, hasPendingWrites: false });
    assert.match(badge.textContent, /Órdenes sincronizadas/);
    ctx.db._fallarSuscripcion({ code: 'permission-denied' });
    assert.match(badge.textContent, /Error de sincronización/);
});

test('offline conserva borrador sin fingir envío; reconectar exige guardar explícitamente', async t => {
    const ctx = await iniciar(t);
    ctx.marcar();
    Object.defineProperty(ctx.window.navigator, 'onLine', { value: false, configurable: true });
    ctx.guardar();
    await tick();
    assert.match(ctx.bloque().textContent, /Sin conexión: borrador conservado/);
    assert.equal(ctx.db._datos.get('equipos').get('a').procedimiento, undefined);
    Object.defineProperty(ctx.window.navigator, 'onLine', { value: true, configurable: true });
    ctx.window.dispatchEvent(new ctx.window.Event('online'));
    assert.equal(ctx.db._datos.get('equipos').get('a').procedimiento, undefined);
    ctx.guardar();
    await tick();
    assert.equal(ctx.db._datos.get('equipos').get('a').procedimiento.pasos[0].completado, true);
    assert.equal(salir(ctx), false);
});

test('rechazo del servidor conserva pasos y error incluso tras actualizar otra orden', async t => {
    const ctx = await iniciar(t);
    ctx.db._errorTransaccion = Object.assign(new Error('Rechazado'), { code: 'permission-denied' });
    ctx.marcar();
    ctx.guardar();
    await tick();
    await ctx.db.collection('equipos').doc('b').update({ notas: 'Cambió' });
    assert.match(ctx.bloque().textContent, /No se pudo guardar/);
    assert.equal(ctx.bloque().querySelector('input').checked, true);
    assert.equal(salir(ctx), true);
    ctx.db._errorTransaccion = null;
    ctx.guardar();
    await tick();
    assert.match(ctx.bloque().textContent, /sincronizado con el servidor/);
});

test('KF-04: cambio remoto conserva borrador, muestra comparación y exige descarte explícito', async t => {
    const ctx = await iniciar(t);
    ctx.marcar();
    await ctx.remoto(ctx.guia());
    assert.match(ctx.bloque().textContent, /Conflicto/);
    assert.equal(ctx.bloque().querySelector('input').checked, true);
    assert.equal(ctx.bloque().querySelector('[data-proc-campo="guardar"]').disabled, true);
    assert.match(ctx.bloque().textContent, /Cambio de pantalla/);
    ctx.bloque().querySelector('[data-proc-campo="descartar"]').click();
    await tick();
    assert.equal(ctx.bloque().querySelector('select').value, 'pantalla');
    assert.equal(ctx.bloque().querySelector('input').checked, false);
    assert.equal(salir(ctx), false);
    assert.equal(ctx.db._datos.get('equipos').get('a').procedimiento.revision, undefined, 'descartar no escribe');
});

test('sin borrador, un procedimiento remoto actualiza la ficha sin conflicto', async t => {
    const ctx = await iniciar(t);
    await ctx.remoto(ctx.guia());
    assert.equal(ctx.bloque().querySelector('select').value, 'pantalla');
    assert.equal(ctx.bloque().querySelector('[data-proc-campo="guardar"]').disabled, false);
    assert.equal(salir(ctx), false);
});

test('transacción reintenta y detecta cambio concurrente antes del commit', async t => {
    const ctx = await iniciar(t);
    ctx.marcar();
    ctx.db._antesCommit = async () => {
        ctx.db._antesCommit = null;
        await ctx.remoto(ctx.guia());
    };
    ctx.guardar();
    await tick();
    assert.equal(ctx.db._datos.get('equipos').get('a').procedimiento.tipo, 'pantalla');
    assert.match(ctx.bloque().textContent, /Conflicto/);
    assert.equal(ctx.bloque().querySelector('input').checked, true);
});

test('entrega concurrente impide guardar y conserva el borrador al volver al historial', async t => {
    const ctx = await iniciar(t);
    ctx.marcar();
    ctx.db._antesCommit = async () => {
        ctx.db._antesCommit = null;
        await ctx.db.collection('equipos').doc('a').update({ estado: 'entregado' });
    };
    ctx.guardar();
    await tick();
    ctx.cambiar('filtro-estado', 'todos');
    assert.equal(ctx.bloque().querySelector('input').checked, true);
    assert.equal(ctx.bloque().querySelector('[data-proc-campo="guardar"]').disabled, true);
    assert.equal(ctx.db._datos.get('equipos').get('a').procedimiento, undefined);
});

test('doble clic y render durante guardado no duplican revisión ni desbloquean controles', async t => {
    const ctx = await iniciar(t);
    let liberar;
    ctx.db._antesCommit = () => new Promise(resolve => { liberar = resolve; });
    ctx.marcar();
    ctx.guardar();
    await tick();
    ctx.window.TechFix.renderizarProyectos();
    assert.equal(ctx.bloque().querySelector('input').disabled, true);
    assert.equal(ctx.bloque().querySelector('[data-proc-campo="guardar"]').disabled, true);
    assert.match(ctx.bloque().textContent, /pendiente de confirmación/);
    ctx.guardar();
    liberar();
    await tick();
    assert.equal(ctx.db._datos.get('equipos').get('a').procedimiento.revision, 1);
    assert.equal(ctx.document.getElementById('borradores-status').hidden, true);
});

test('una respuesta tardía tras cerrar sesión no repuebla borradores ni muestra éxito', async t => {
    const ctx = await iniciar(t);
    let liberar;
    ctx.db._antesCommit = () => new Promise(resolve => { liberar = resolve; });
    ctx.marcar();
    ctx.guardar();
    await tick();
    ctx.auth._entrar(null);
    liberar();
    await tick();
    assert.equal(ctx.bloque(), null);
    assert.equal(salir(ctx), false);
    assert.equal(ctx.document.getElementById('borradores-status').hidden, true);
    assert.ok(!ctx.swal.llamadas.some(c => c.title === 'Procedimiento confirmado por el servidor'));
});

test('KF-05: saldo incluye entregados, filtro solo muestra deudores y no se presenta como ingresos', async t => {
    const ctx = await iniciar(t, { c: equipo({ estado: 'entregado', cliente: 'Entregado deudor', costo: 50000, abono: 10000 }),
        d: equipo({ cliente: 'Pagado', costo: 10000, abono: 10000 }) });
    const saldo = ctx.document.getElementById('stat-pendiente').textContent.replace(/\D/g, '');
    assert.equal(saldo, '70000');
    ctx.document.querySelector('[data-filtro-kpi="saldo"]').click();
    const lista = ctx.document.getElementById('lista-proyectos').textContent;
    assert.match(lista, /Entregado deudor/);
    assert.doesNotMatch(lista, /Pagado/);
    assert.match(ctx.document.querySelector('.stat-money').textContent, /no equivale a cobros/);
    assert.match(ctx.document.body.textContent, /últimas 500 órdenes/);
});

test('almacén no copia campos personales y huella es independiente del orden de claves', async t => {
    const ctx = await iniciar(t);
    const api = ctx.window.KryoFixBorradores;
    const guia = ctx.guia();
    const store = api.crear(() => guia);
    const entrada = store.obtener('a', { ...guia, pin: '1234', foto: 'privada' });
    assert.equal(entrada.guia.pin, undefined);
    assert.equal(entrada.guia.foto, undefined);
    assert.equal(api.huella({ ...guia, revision: 2 }), api.huella({ revision: 2, ...guia }));
    store.limpiar();
    assert.equal(store.vigente('a', entrada), false);
});

test('repositorio rechaza escritura ajena y base obsoleta aun sin un snapshot de UI', async t => {
    const ctx = await iniciar(t, { ajeno: equipo({ uid: 'otro' }) });
    const repo = ctx.window.KryoFixOrdenes.crear({ db: ctx.db, usuario: () => USUARIO,
        enLinea: () => true, timestampServidor: () => 123 });
    await assert.rejects(repo.guardarProcedimiento({ id: 'ajeno', uid: 'ana', base: 'null', guia: ctx.guia() }),
        err => err.code === 'permission-denied');
    await repo.guardarProcedimiento({ id: 'a', uid: 'ana', base: 'null', guia: ctx.guia() });
    await assert.rejects(repo.guardarProcedimiento({ id: 'a', uid: 'ana', base: 'null', guia: ctx.guia() }),
        err => err.code === 'conflicto');
    assert.equal(ctx.db._datos.get('equipos').get('a').procedimiento.revision, 1);
});

test('snapshot inmediato al abrir details conserva apertura aunque toggle todavía no llegó', async t => {
    const ctx = await iniciar(t);
    ctx.bloque().open = true;
    ctx.window.TechFix.renderizarProyectos();
    assert.equal(ctx.bloque().open, true);
});
