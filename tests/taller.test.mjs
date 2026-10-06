import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarApp, tick } from './helpers/entorno.mjs';

const U = { uid: 'ana', email: 'ana@example.test' };
const base = { uid: U.uid, cliente: 'Ana Cliente', telefono: '56912345678', equipo: 'Apple', modelo: 'iPhone 13',
    estado: 'ingresado', costo: 50000, abono: 5000, timestamp: 1, schemaVersion: 2, revisionOrden: 0 };
async function iniciar(t, orden = {}) {
    const c = montarApp({ semilla: { equipos: { a: { ...base, ...orden } } } });
    t.after(() => c.dom.window.close());
    c.auth._entrar(U); await tick();
    c.servicio = c.window.TechFix.tallerServicio;
    c.orden = () => c.db._datos.get('equipos').get('a');
    c.op = (accion, datos = {}, opId = c.servicio.nuevoId()) => c.servicio.ejecutar({ id: 'a', uid: U.uid,
        revision: c.orden().revisionOrden || 0, accion, datos, opId });
    return c;
}
const calidad = { pantalla: 'correcto', carga: 'correcto', audio: 'correcto', camaras: 'correcto', conectividad: 'correcto', excepcion: '' };

test('diagnóstico separa riesgo, hipótesis y causa; nunca recomienda energizar ante riesgo', async t => {
    const c = await iniciar(t);
    await c.op('diagnostico', { sintoma: 'carga', riesgo: 'si', hipotesis: 'Puerto', causa: '', pruebas: 'Humedad visible' });
    assert.equal(c.orden().diagnostico.causa, '');
    assert.match(c.window.KryoFixTallerDominio.guiaDiagnostico(c.orden().diagnostico), /no cargar/);
    await assert.rejects(c.op('estado', { estado: 'reparado' }), /calidad/);
});

test('calidad impide listo sin pruebas; permite excepciones justificadas', async t => {
    const c = await iniciar(t, { costo: 0, abono: 0 });
    await assert.rejects(c.op('calidad', { ...calidad, carga: 'no-aplica' }), /Justifica/);
    await c.op('calidad', { ...calidad, carga: 'no-aplica', excepcion: 'Modelo sin puerto, carga inalámbrica probada aparte.' });
    await c.op('estado', { estado: 'reparado' });
    assert.equal(c.orden().estado, 'reparado');
    assert.equal(c.db._datos.get('seguimiento').get('a').estado, 'reparado');
});

test('presupuesto versionado conserva historial e invalida autorización anterior', async t => {
    const c = await iniciar(t);
    const datos = { lineas: [{ concepto: 'Pantalla', cantidad: 1, precio: 40000 }, { concepto: 'Mano de obra', cantidad: 1, precio: 15000 }], condiciones: 'Pruebas incluidas' };
    await c.op('presupuestar', datos);
    assert.equal(c.orden().costo, 55000);
    await c.op('autorizar', { version: 1, estado: 'aprobado', evidencia: 'Cliente confirmó por WhatsApp el 6 de octubre', medio: 'whatsapp' });
    await c.op('presupuestar', { ...datos, plazo: 'Tres días' });
    assert.equal(c.orden().presupuesto.version, 2);
    assert.equal(c.orden().presupuesto.autorizacion.estado, 'pendiente');
    await assert.rejects(c.op('autorizar', { version: 1, estado: 'aprobado', evidencia: 'Antigua autorización' }), /versión/);
    const eventos = await c.servicio.listar(U.uid, 'eventos', 'a');
    assert.ok(eventos.some(e => e.presupuesto?.version === 1));
});

test('pago idempotente no duplica cobro; mismo ID con otro monto se rechaza', async t => {
    const c = await iniciar(t);
    const id = c.servicio.nuevoId();
    await c.op('pago', { monto: 10000, medio: 'transferencia' }, id);
    await c.op('pago', { monto: 10000, medio: 'transferencia' }, id);
    assert.equal(c.orden().abono, 15000);
    assert.equal(c.orden().finanzas.apertura, 5000);
    assert.equal((await c.servicio.listar(U.uid, 'pagos', 'a')).length, 1);
    await assert.rejects(c.op('pago', { monto: 11000, medio: 'transferencia' }, id), /identificador/);
});

test('reverso conserva pago original y no se puede repetir con un ID nuevo', async t => {
    const c = await iniciar(t);
    const id = c.servicio.nuevoId();
    await c.op('pago', { monto: 10000, medio: 'efectivo' }, id);
    await c.op('reverso', { pagoId: id, motivo: 'Registro duplicado de caja' });
    assert.equal(c.orden().abono, 5000);
    const pagos = await c.servicio.listar(U.uid, 'pagos', 'a');
    assert.equal(pagos.length, 2);
    assert.ok(pagos.find(p => p.id === id).revertidoPor);
    await assert.rejects(c.op('reverso', { pagoId: id, motivo: 'Segundo reverso inválido' }), /sin revertir/);
});

test('montos inválidos, presupuesto bajo abono y edición destructiva del acumulado se rechazan', async t => {
    const c = await iniciar(t);
    await assert.rejects(c.op('pago', { monto: 1.2, medio: 'efectivo' }), /enteros/);
    await assert.rejects(c.op('pago', { monto: 60000, medio: 'efectivo' }), /saldo inválido/);
    await assert.rejects(c.op('presupuestar', { lineas: [{ concepto: 'Revisión', cantidad: 1, precio: 1 }] }), /reverso/);
    await c.op('pago', { monto: 1000, medio: 'efectivo' });
    await assert.rejects(c.op('editar', { abono: 0 }), /no sobrescribas/);
});

test('edición con revisión obsoleta y entrega concurrente no sobrescriben cambios', async t => {
    const c = await iniciar(t);
    const peticion = { id: 'a', uid: U.uid, revision: 0, accion: 'editar', datos: { notas: 'Texto anterior' }, opId: 'vieja' };
    await c.op('editar', { notas: 'Nota nueva' });
    await assert.rejects(c.servicio.ejecutar(peticion), /otra sesión/);
    assert.equal(c.orden().notas, 'Nota nueva');
});

test('entrega exige listo, firma y motivo de deuda, limpia PIN y mantiene saldo', async t => {
    const c = await iniciar(t, { pin: '4321' });
    const firma = 'data:image/jpeg;base64,' + 'A'.repeat(40);
    await assert.rejects(c.op('entregar', { firma, saldar: false }), /pruebas/);
    await c.op('presupuestar', { lineas: [{ concepto: 'Reparación', cantidad: 1, precio: 50000 }] });
    await c.op('autorizar', { version: 1, estado: 'aprobado', evidencia: 'Cliente autorizó la reparación' });
    await c.op('calidad', calidad); await c.op('estado', { estado: 'reparado' });
    await assert.rejects(c.op('entregar', { firma, saldar: false }), /saldo pendiente/);
    await c.op('entregar', { firma, saldar: false, excepcion: 'Retiro autorizado, pago acordado para mañana' });
    assert.equal(c.orden().pin, '');
    assert.equal(c.orden().abono, 5000);
    assert.equal(c.orden().estado, 'entregado');
    await c.op('pago', { monto: 45000, medio: 'transferencia' });
    assert.equal(c.orden().abono, 50000);
});

test('stock reserva última unidad, impide doble asignación y libera/consume sin stock negativo', async t => {
    const c = await iniciar(t, { costo: 0, abono: 0 });
    await c.servicio.guardarRepuesto(U.uid, { nombre: 'Pantalla OLED', marca: 'Apple', modelo: 'iPhone 13', costo: 20000, cantidad: 1 }, 'lote');
    const peticion = { repuestoId: 'lote', cantidad: 1, compatibilidadConfirmada: true };
    await c.op('reservar', peticion, 'reserva');
    await assert.rejects(c.op('reservar', peticion), /stock/);
    await c.op('liberar', { repuestoId: 'lote', reservaId: 'reserva' });
    await c.op('reservar', peticion, 'otra');
    await c.op('consumir', { repuestoId: 'lote', reservaId: 'otra' });
    const stock = (await c.servicio.listar(U.uid, 'repuestos'))[0];
    assert.equal(stock.disponible, 0); assert.equal(stock.reservado, 0);
    await assert.rejects(c.op('liberar', { repuestoId: 'lote', reservaId: 'otra' }), /consumida/);
});

test('repuesto incompatible y reserva sin aprobación se rechazan', async t => {
    const c = await iniciar(t, { costo: 0, abono: 0 });
    await c.servicio.guardarRepuesto(U.uid, { nombre: 'Pantalla', marca: 'Samsung', modelo: 'Galaxy A54', costo: 10000, cantidad: 2 }, 'otro');
    await assert.rejects(c.op('reservar', { repuestoId: 'otro', cantidad: 1, compatibilidadConfirmada: true }), /coincide/);
    await c.op('presupuestar', { lineas: [{ concepto: 'Reparación', precio: 50000, cantidad: 1 }] });
    await assert.rejects(c.op('reservar', { repuestoId: 'otro', cantidad: 1, compatibilidadConfirmada: true }), /Autoriza/);
});

test('garantía conserva entrega original y contacto se registra sin afirmar envío automático', async t => {
    const c = await iniciar(t, { estado: 'entregado', fechaEntrega: 123 });
    await c.op('garantia', { motivo: 'El táctil vuelve a fallar', resultado: 'Pendiente evaluación', estado: 'abierta' });
    assert.equal(c.orden().fechaEntrega, 123);
    assert.equal(c.orden().estado, 'entregado');
    await c.op('contacto', { tipo: 'garantia', resultado: 'Se acordó revisión presencial' });
    assert.equal(c.orden().ultimoContacto.tipo, 'garantia');
});

test('correlativo central no colisiona entre ingresos y clientes no se fusionan automáticamente', async t => {
    const c = await iniciar(t);
    const a = await c.servicio.crearOrden(U.uid, base, 'nueva1');
    const b = await c.servicio.crearOrden(U.uid, base, 'nueva2');
    assert.equal(a.idOrden, 'KRF-000001'); assert.equal(b.idOrden, 'KRF-000002');
    assert.notEqual(a.clienteId, b.clienteId);
    const retry = await c.servicio.crearOrden(U.uid, base, 'nueva2');
    assert.equal(retry.idOrden, b.idOrden);
    assert.equal(c.db._datos.get('usuarios/ana/config').get('numeracion').numero, 2);
});

test('paginación consulta más allá del tablero y no filtra datos de otro usuario', async t => {
    const c = await iniciar(t);
    const tabla = c.db._datos.get('equipos');
    for (let i = 0; i < 515; i++) tabla.set('extra' + i, { ...base, timestamp: i + 10 });
    tabla.set('ajeno', { ...base, uid: 'otro', timestamp: 99999 });
    let cursor = null, fin = false; const ids = new Set();
    while (!fin) {
        const pagina = await c.servicio.pagina(U.uid, cursor);
        pagina.ordenes.forEach(p => ids.add(p.id)); cursor = pagina.cursor; fin = pagina.fin;
    }
    assert.equal(ids.size, 516); assert.ok(!ids.has('ajeno'));
});

test('ficha abre por ID privado, permite editar diagnóstico y limpia datos al salir de sesión', async t => {
    const c = await iniciar(t);
    await c.window.TechFix.abrirFicha('a');
    const dialog = c.document.getElementById('ficha-dialog');
    assert.equal(dialog.hasAttribute('open'), true);
    const boton = [...dialog.querySelectorAll('nav button')].find(b => b.textContent === 'Diagnóstico');
    boton.click(); await tick();
    dialog.querySelector('[name="riesgo"]').value = 'no';
    dialog.querySelector('[name="causa"]').value = 'Conector dañado, confirmado con inspección';
    dialog.querySelector('form').dispatchEvent(new c.window.Event('submit', { bubbles: true, cancelable: true }));
    await tick(30);
    assert.match(c.orden().diagnostico.causa, /Conector/);
    c.auth._entrar(null);
    assert.equal(dialog.hasAttribute('open'), false);
    assert.doesNotMatch(dialog.textContent, /Conector/);
});

test('plantillas versionadas conservan snapshot de órdenes y rechazan ediciones obsoletas', async t => {
    const c = await iniciar(t);
    const datos = { titulo: 'Inspección privada', tipo: 'diagnostico', pasos: 'Confirmar variante\nDocumentar estado', fuente: 'Manual consultado por el técnico' };
    await c.servicio.guardarPlantilla(U.uid, datos, 'plantilla');
    await c.op('plantilla', { plantillaId: 'plantilla', baseProcedimiento: 'null' });
    assert.equal(c.orden().procedimiento.version, 1);
    await c.servicio.guardarPlantilla(U.uid, { ...datos, id: 'plantilla', version: 1, pasos: 'Nueva comprobación' }, 'edicion');
    assert.equal(c.orden().procedimiento.pasos.length, 2);
    assert.match(c.orden().procedimiento.fuente, /Manual/);
    await assert.rejects(c.servicio.guardarPlantilla(U.uid, { ...datos, id: 'plantilla', version: 1 }, 'obsoleta'), /cambió/);
    assert.equal(c.db._datos.get('usuarios/ana/plantillas/plantilla/versiones').size, 2);
});

test('reintento del mismo ingreso con otro cliente se rechaza y no asigna otro correlativo', async t => {
    const c = await iniciar(t);
    await c.servicio.crearOrden(U.uid, base, 'nuevo');
    await assert.rejects(c.servicio.crearOrden(U.uid, { ...base, cliente: 'Otra persona' }, 'nuevo'), /otros datos/);
    assert.equal(c.db._datos.get('usuarios/ana/config').get('numeracion').numero, 1);
});

test('una nueva prueba fallida invalida listo, devuelve a revisión y actualiza el espejo', async t => {
    const c = await iniciar(t, { estado: 'reparado', calidad });
    await c.op('calidad', { ...calidad, audio: 'falla' });
    assert.equal(c.orden().estado, 'revision');
    assert.equal(c.db._datos.get('seguimiento').get('a').estado, 'revision');
    assert.match((await c.servicio.listar(U.uid, 'eventos', 'a'))[0].resumen, /vuelve a revisión/);
});

test('entrega rechaza montos que cambiaron después de mostrar el resumen de firma', async t => {
    const c = await iniciar(t, { estado: 'reparado', calidad,
        presupuesto: { version: 1, total: 50000, autorizacion: { estado: 'aprobado', version: 1 } } });
    c.window.TechFix.archivarProyecto('a');
    c.document.getElementById('chk-saldar-entrega').checked = true;
    const canvas = c.document.getElementById('canvas-firma');
    canvas.dispatchEvent(new c.window.PointerEvent('pointerdown', { isPrimary: true, pointerId: 1, pointerType: 'mouse', clientX: 5, clientY: 5 }));
    canvas.dispatchEvent(new c.window.PointerEvent('pointermove', { isPrimary: true, pointerId: 1, pointerType: 'mouse', clientX: 20, clientY: 20 }));
    await c.op('pago', { monto: 10000, medio: 'efectivo' });
    c.document.getElementById('btn-guardar-firma').click();
    await tick(30);
    assert.equal(c.orden().estado, 'reparado');
    assert.equal(c.orden().abono, 15000);
    assert.equal(c.orden().firmaCliente, undefined);
});

test('compresión de una foto iniciada antes de salir no repuebla evidencia privada', async t => {
    const c = await iniciar(t);
    let imagen;
    c.window.FileReader = class {
        readAsDataURL() { this.onload({ target: { result: 'data:image/jpeg;base64,PRIVADA' } }); }
    };
    c.window.Image = class {
        constructor() { imagen = this; this.width = 100; this.height = 100; }
    };
    const input = c.document.getElementById('foto-evidencia');
    Object.defineProperty(input, 'files', { configurable: true, value: [new c.window.File(['foto'], 'foto.jpg', { type: 'image/jpeg' })] });
    input.dispatchEvent(new c.window.Event('change'));
    assert.ok(imagen);
    c.auth._entrar(null);
    imagen.onload();
    assert.equal(c.document.getElementById('preview-foto').style.display, 'none');
    assert.equal(c.document.getElementById('img-evidencia-preview').getAttribute('src'), '');
});

test('firma ignora un segundo dedo y deja de dibujar después de limpiar', async t => {
    const c = await iniciar(t);
    c.window.TechFix.archivarProyecto('a');
    const canvas = c.document.getElementById('canvas-firma');
    const enviar = (tipo, id, primaria = true) => canvas.dispatchEvent(new c.window.PointerEvent(tipo, { pointerType: 'touch', pointerId: id, isPrimary: primaria, clientX: 10, clientY: 10 }));
    enviar('pointerdown', 1); const antes = c.trazos.length;
    enviar('pointermove', 2, false); assert.equal(c.trazos.length, antes);
    enviar('pointerup', 2, false); enviar('pointermove', 1); assert.ok(c.trazos.length > antes);
    c.document.getElementById('btn-limpiar-firma').click(); const limpio = c.trazos.length;
    enviar('pointermove', 1); assert.equal(c.trazos.length, limpio);
    c.document.getElementById('btn-guardar-firma').click();
    assert.equal(c.swal.llamadas.at(-1).title, 'Falta la firma');
});

test('entrega tardía no cierra el modal de firma de otra orden', async t => {
    const c = await iniciar(t);
    await c.db.collection('equipos').doc('b').set({ ...base, cliente: 'Otra orden' });
    let terminar;
    c.servicio.ejecutar = () => new Promise(r => { terminar = r; });
    c.window.TechFix.archivarProyecto('a');
    const canvas = c.document.getElementById('canvas-firma');
    for (const tipo of ['pointerdown', 'pointermove']) canvas.dispatchEvent(new c.window.PointerEvent(tipo, { isPrimary: true, pointerId: 1, clientX: 10, clientY: 20 }));
    c.document.getElementById('btn-guardar-firma').click();
    c.document.getElementById('btn-cancelar-firma').click();
    c.window.TechFix.archivarProyecto('b');
    terminar(); await tick();
    assert.equal(c.document.getElementById('modal-firma').style.display, 'flex');
    assert.match(c.document.getElementById('resumen-entrega-firma').textContent, /Otra orden/);
    assert.equal(c.document.getElementById('btn-guardar-firma').disabled, false);
});
