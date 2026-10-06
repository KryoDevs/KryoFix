import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarApp, tick } from './helpers/entorno.mjs';

async function iniciar() {
    const ctx = montarApp();
    ctx.auth._entrar({ uid: 'tecnico', email: 'tecnico@example.test' });
    await tick(10);
    ctx.cambiar = (id, valor) => {
        const nodo = ctx.document.getElementById(id);
        nodo.value = valor;
        nodo.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
    };
    ctx.cambiar('marca', 'Samsung');
    ctx.cambiar('modelo', 'Galaxy A54');
    return ctx;
}

async function guardar(ctx) {
    const $ = id => ctx.document.getElementById(id);
    $('cliente').value = 'Ana';
    $('telefono').value = '56912345678';
    $('costo').value = '10000';
    $('abono').value = '0';
    $('proyecto-form').dispatchEvent(new ctx.window.Event('submit', { bubbles: true, cancelable: true }));
    await tick(20);
    return [...ctx.db._datos.get('equipos').values()][0];
}

test('prioriza historial del modelo exacto sin inventar estadísticas ni mezclar marcas', async () => {
    const { window } = await iniciar();
    const historial = [
        { equipo: ' Samsung ', modelo: 'galaxy a54', problemaComun: { id: 'audio' } },
        { equipo: 'Samsung', modelo: 'Galaxy A54', problemaComun: { id: 'audio' } },
        { equipo: 'Samsung', modelo: 'Galaxy A55', problemaComun: { id: 'carga' } },
        { equipo: 'Apple', modelo: 'Galaxy A54', problemaComun: { id: 'carga' } }
    ];
    const lista = window.TechFixDominio.obtenerProblemas('Samsung', 'Galaxy A54', historial);
    assert.equal(lista[0].id, 'audio');
    assert.equal(lista[0].registros, 2);
    assert.equal(lista.find(p => p.id === 'carga').registros, 0);
    assert.match(lista[0].contexto, /Samsung Members/);
    assert.equal(window.TechFixDominio.obtenerProblemas('', '').length, 0);
    assert.match(window.TechFixDominio.obtenerProblemas('Desconocida', 'Modelo')[0].contexto, /variante/);
});

test('aplica sin duplicar ni borrar texto, notas o precio; persiste guía y no publica metadata', async () => {
    const ctx = await iniciar();
    const $ = id => ctx.document.getElementById(id);
    $('falla').value = 'Ocurre desde ayer';
    $('notas').value = 'Consultar al cliente';
    $('costo').value = '12345';
    ctx.cambiar('problema-comun', 'carga');
    assert.equal($('falla').value, 'Ocurre desde ayer', 'seleccionar no aplica');
    $('btn-aplicar-problema').click();
    const texto = $('falla').value;
    $('btn-aplicar-problema').click();
    assert.equal($('falla').value, texto);
    assert.match(texto, /^Ocurre desde ayer/);
    assert.equal($('notas').value, 'Consultar al cliente');
    assert.equal($('costo').value, '12345');
    const orden = await guardar(ctx);
    assert.equal(orden.problemaComun.id, 'carga');
    assert.equal(orden.procedimiento.tipo, 'diagnostico');
    assert.ok(orden.procedimiento.pasos.some(p => p.texto.includes('cargador compatibles')));
    assert.ok(orden.procedimiento.pasos.some(p => p.texto.includes('Samsung Members')));
    assert.ok(orden.procedimiento.pasos.every(p => !p.completado));
    assert.equal([...ctx.db._datos.get('seguimiento').values()][0].problemaComun, undefined);
    assert.equal($('problema-comun').disabled, true, 'formulario reiniciado');
});

test('cambiar modelo descarta asociación y mantiene el detalle escrito', async () => {
    const ctx = await iniciar();
    ctx.cambiar('problema-comun', 'pantalla');
    ctx.document.getElementById('btn-aplicar-problema').click();
    ctx.cambiar('modelo', 'Galaxy A55');
    assert.equal(ctx.document.getElementById('problema-comun').value, '');
    assert.match(ctx.document.getElementById('falla').value, /Pantalla/);
    const orden = await guardar(ctx);
    assert.equal(orden.problemaComun, null);
    assert.equal(orden.procedimiento.titulo, 'Diagnóstico inicial');
});

test('límite de texto impide aplicar sin truncar y permite quitar la asociación', async () => {
    const ctx = await iniciar();
    const $ = id => ctx.document.getElementById(id);
    $('falla').value = 'x'.repeat(200);
    ctx.cambiar('problema-comun', 'humedad');
    $('btn-aplicar-problema').click();
    assert.match($('problema-resultado').textContent, /No se aplicó/);
    assert.equal($('falla').value.length, 200);
    $('falla').value = '';
    $('btn-aplicar-problema').click();
    $('btn-quitar-problema').click();
    assert.match($('falla').value, /líquido/);
    const orden = await guardar(ctx);
    assert.equal(orden.problemaComun, null);
});

test('humedad prepara evaluación segura, no reparación automática', async () => {
    const ctx = await iniciar();
    ctx.cambiar('problema-comun', 'humedad');
    ctx.document.getElementById('btn-aplicar-problema').click();
    const orden = await guardar(ctx);
    assert.equal(orden.procedimiento.tipo, 'humedad');
    assert.equal(orden.estado, 'ingresado');
    assert.ok(orden.procedimiento.pasos.some(p => p.texto.includes('No cargar, encender')));
});
