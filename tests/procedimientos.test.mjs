import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarApp, tick } from './helpers/entorno.mjs';

async function iniciar(extra = {}) {
    const ctx = montarApp({ semilla: { equipos: { a: {
        uid: 'tecnico', cliente: 'Ana', equipo: 'Apple', modelo: 'iPhone 13',
        estado: 'ingresado', costo: 0, abono: 0, timestamp: Date.now(), ...extra
    } } } });
    ctx.auth._entrar({ uid: 'tecnico', email: 'tecnico@example.test' });
    await tick(10);
    return ctx;
}

function cambiar(ctx, nodo, valor) {
    nodo.value = valor;
    nodo.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
}

test('modelos automáticos sin tarifario, filtrados por marca y con entrada libre', async () => {
    const ctx = await iniciar();
    const marca = ctx.document.getElementById('marca');
    const modelo = ctx.document.getElementById('modelo');
    cambiar(ctx, marca, 'Apple');
    assert.ok([...modelo.options].some(o => o.value === 'iPhone 13'));
    cambiar(ctx, marca, 'Samsung');
    assert.ok([...modelo.options].some(o => o.value === 'Galaxy A54'));
    assert.ok(![...modelo.options].some(o => o.value === 'iPhone 13'));
    cambiar(ctx, modelo, 'Otro');
    assert.equal(ctx.document.getElementById('modelo-otro').disabled, false);
});

test('combina modelos base, catálogo e historial sin duplicados ni mezcla de marcas', async () => {
    const { window } = await iniciar();
    const modelos = window.TechFixDominio.obtenerModelos(' apple ', [
        { marca: 'Apple', modelo: 'iphone 13' }, { marca: 'Apple', modelo: 'Modelo especial' },
        { marca: 'Samsung', modelo: 'Ajeno' }
    ], [{ equipo: 'Apple', modelo: 'Modelo histórico' }]);
    assert.equal(modelos.filter(m => m.toLowerCase() === 'iphone 13').length, 1);
    assert.ok(modelos.includes('Modelo especial'));
    assert.ok(modelos.includes('Modelo histórico'));
    assert.ok(!modelos.includes('Ajeno'));
    const a = window.TechFixDominio.crearProcedimiento('pantalla');
    a.pasos[0].completado = true;
    assert.equal(window.TechFixDominio.crearProcedimiento('pantalla').pasos[0].completado, false);
});

test('orden antigua permite seleccionar guía y guardar avance privado sin cambiar estado', async () => {
    const ctx = await iniciar();
    let bloque = ctx.document.querySelector('.procedimiento');
    assert.match(bloque.textContent, /Diagnóstico inicial/);
    cambiar(ctx, bloque.querySelector('select'), 'pantalla');
    await tick();
    const check = bloque.querySelector('input');
    check.click();
    assert.match(bloque.textContent, /1 de/);
    bloque.querySelector('button').click();
    await tick(10);
    const equipo = ctx.db._datos.get('equipos').get('a');
    assert.equal(equipo.procedimiento.tipo, 'pantalla');
    assert.equal(equipo.procedimiento.pasos[0].completado, true);
    assert.equal(equipo.estado, 'ingresado');
    assert.equal(ctx.db._datos.get('seguimiento')?.size || 0, 0);
    bloque = ctx.document.querySelector('.procedimiento');
    assert.equal(bloque.querySelector('input').checked, true);
    ctx.swal.respuesta = false;
    cambiar(ctx, bloque.querySelector('select'), 'bateria');
    await tick();
    assert.equal(bloque.querySelector('select').value, 'pantalla');
    assert.equal(bloque.querySelector('input').checked, true);
    ctx.swal.respuesta = true;
    cambiar(ctx, bloque.querySelector('select'), 'bateria');
    await tick();
    assert.equal(bloque.querySelector('input').checked, false);
});

test('un fallo de escritura conserva el borrador y permite reintentar', async () => {
    const ctx = await iniciar();
    const bloque = ctx.document.querySelector('.procedimiento');
    const check = bloque.querySelector('input');
    check.click();
    ctx.db._datos.get('equipos').delete('a');
    bloque.querySelector('button').click();
    await tick(10);
    assert.match(bloque.textContent, /No se pudo guardar/);
    assert.equal(check.checked, true);
    assert.equal(bloque.querySelector('button').disabled, false);
});

test('las órdenes entregadas muestran la guía en solo lectura y escapan textos', async () => {
    const ctx = await iniciar({ estado: 'entregado', procedimiento: {
        tipo: 'diagnostico', titulo: '<img src=x onerror=alert(1)>', version: 1,
        pasos: [{ texto: '<script>alert(1)</script>', completado: true }]
    } });
    cambiar(ctx, ctx.document.getElementById('filtro-estado'), 'todos');
    const bloque = ctx.document.querySelector('.procedimiento');
    assert.equal(bloque.querySelector('select').disabled, true);
    assert.equal(bloque.querySelector('input').disabled, true);
    assert.equal(bloque.querySelector('button').disabled, true);
    assert.equal(bloque.querySelector('script, img'), null);
});
