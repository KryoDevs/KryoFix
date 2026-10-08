import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarApp, tick, esperarHasta } from './helpers/entorno.mjs';

const usuario = { uid: 'tecnico', email: 'tecnico@test.cl' };
const orden = { uid: usuario.uid, cliente: 'Ana', telefono: '56912345678', estado: 'reparado', costo: 10000, abono: 2000, pin: '1234', timestamp: 1 };
function iniciar(t, semilla = {}) {
    const ctx = montarApp({ semilla });
    t.after(() => ctx.window.close());
    ctx.auth._entrar(usuario);
    return ctx;
}

test('dominio admite enlace, query e ID pero rechaza rutas Firestore', (t) => {
    const { window } = iniciar(t);
    const parsear = window.TechFixDominio.extraerCodigoOrden;
    for (const entrada of ['abc123', '#abc123', '?id=abc123', 'https://ejemplo.test/status.html?id=abc123']) assert.equal(parsear(entrada), 'abc123');
    for (const entrada of ['a/b/c', '..', '?id=a%2Fb', 'a b']) assert.equal(parsear(entrada), '');
});

test('CSV neutraliza formulas sin alterar montos numericos', (t) => {
    const { window } = iniciar(t);
    const csv = window.TechFix.exportCSV([{ ...orden, cliente: '=HYPERLINK("x")', falla: '  +SUM(1,2)' }]);
    assert.ok(csv.includes("\"'=HYPERLINK"));
    assert.ok(csv.includes("\"'  +SUM"));
    assert.ok(csv.includes('"10000"'));
});

test('entregado no puede reabrirse con el selector', (t) => {
    const { window } = iniciar(t);
    assert.equal(window.TechFix.permiteEstado({ estado: 'entregado' }, 'reparado'), false);
});

test('una reparacion reciente no dispara aviso por ingreso antiguo', (t) => {
    const { document } = iniciar(t, { equipos: { a: { ...orden, fechaReparacion: Date.now() } } });
    assert.equal(document.getElementById('aviso-vencidos').hidden, true);
});

test('prioridades se guardan al editar y ordenan el tablero', async (t) => {
    const { window, document, db } = iniciar(t, { equipos: { a: orden, b: { ...orden, cliente: 'Beto', timestamp: 2 } } });
    await window.TechFix.editarProyecto('a', { prioridad: 'urgente', notas: 'Revisar placa' });
    document.getElementById('ordenar-proyectos').value = 'prioridad';
    window.TechFix.renderizarProyectos();
    assert.equal(document.querySelector('#lista-proyectos h3').textContent, 'Ana');
    assert.equal(db._datos.get('equipos').get('a').notas, 'Revisar placa');
    assert.ok(!window.TechFix.construirBoleta({ ...orden, notas: 'Secreto interno' }).textContent.includes('Secreto interno'));
});

test('tarifario sugerido se puede cargar dos veces sin duplicar', async (t) => {
    const { document, db } = iniciar(t);
    document.getElementById('btn-catalogo-base').click();
    await tick();
    const cantidad = db._datos.get('catalogo').size;
    assert.equal(cantidad, 7);
    document.getElementById('btn-catalogo-base').click();
    await tick();
    assert.equal(db._datos.get('catalogo').size, cantidad);
});

test('cierre de sesion limpia formulario, catalogo, firma y ticket privados', async (t) => {
    const { document, window, auth } = iniciar(t, { equipos: { a: orden } });
    document.getElementById('cliente').value = 'Dato privado';
    window.TechFix.imprimirBoleta('a');
    window.TechFix.archivarProyecto('a');
    await auth.signOut();
    assert.equal(document.getElementById('cliente').value, '');
    assert.equal(document.getElementById('capa-impresion').textContent, '');
    assert.equal(document.getElementById('modal-firma').style.display, 'none');
    assert.equal(document.getElementById('lista-catalogo').textContent, '');
});

test('entrega borra PIN y solo registra pago con confirmacion explicita', async (t) => {
    const { window, document, db } = iniciar(t, { equipos: { a: orden } });
    window.TechFix.archivarProyecto('a');
    const checkbox = document.getElementById('chk-saldar-entrega');
    assert.equal(checkbox.checked, false);
    checkbox.checked = true;
    const canvas = document.getElementById('canvas-firma');
    canvas.dispatchEvent(new window.PointerEvent('pointerdown', { isPrimary: true, pointerId: 1, pointerType: 'mouse', clientX: 5, clientY: 5 }));
    canvas.dispatchEvent(new window.PointerEvent('pointermove', { isPrimary: true, pointerId: 1, pointerType: 'mouse', clientX: 20, clientY: 20 }));
    document.getElementById('btn-guardar-firma').click();
    await esperarHasta(() => db._datos.get('equipos').get('a').estado === 'entregado');
    const guardado = db._datos.get('equipos').get('a');
    assert.equal(guardado.pin, '');
    assert.equal(guardado.abono, 10000);
});

test('KPI saldo accesible por teclado activa filtro y ordenamiento', (t) => {
    const { window, document } = iniciar(t);
    const card = document.querySelector('[data-filtro-kpi="saldo"]');
    assert.equal(card.tabIndex, 0);
    card.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(document.getElementById('filtro-estado').value, 'con-saldo');
    assert.equal(document.getElementById('ordenar-proyectos').value, 'saldo');
});
