/**
 * Fusión de clientes duplicados de la agenda.
 *
 * Es la operación más delicada de las nuevas: mueve el historial de una
 * persona a otro registro y borra el absorbido. Si sale mal, el taller pierde
 * la trazabilidad de quién Hamas equipo, así que se prueba a fondo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarApp, tick } from './helpers/entorno.mjs';

function servicio(t, extra = {}) {
    const c = montarApp({
        semilla: {
            equipos: {
                o1: { uid: 'ana', clienteId: 'b', cliente: 'J. Perez', telefono: '56911112222', equipo: 'Apple', modelo: 'iPhone 13', estado: 'reparado', costo: 0, abono: 0, timestamp: 1, schemaVersion: 2, revisionOrden: 0, ...extra },
                o2: { uid: 'ana', clienteId: 'a', cliente: 'Juan Pérez', telefono: '56911112222', equipo: 'Samsung', modelo: 'S21', estado: 'reparado', costo: 0, abono: 0, timestamp: 2, schemaVersion: 2, revisionOrden: 0 }
            },
            'usuarios/ana/clientes': {
                a: { nombre: 'Juan Pérez', telefono: '56911112222', creado: 1 },
                b: { nombre: 'J. Perez', telefono: '56911112222', creado: 2 }
            }
        },
        antesDeIniciar: (w) => { w.KryoFixEntorno.modo = 'spark'; }
    });
    t.after(() => c.dom.window.close());
    c.auth._entrar({ uid: 'ana', email: 'ana@taller.cl' });
    return { c, s: c.window.TechFix.tallerServicio };
}

const clientesDe = (c) => c.db._datos.get('usuarios/ana/clientes');

test('fusiona dos clientes del mismo teléfono y reasigna sus órdenes', async t => {
    const { c, s } = servicio(t);
    await s.fusionarClientes('ana', 'a', ['b']);
    const agenda = clientesDe(c);
    assert.equal(agenda.has('b'), false, 'el absorbido debe eliminarse de la agenda');
    assert.equal(agenda.get('a').nombre, 'Juan Pérez', 'gana el que se eligió conservar');
    assert.deepEqual(c.db._datos.get('equipos').get('o1').clienteId, 'a', 'su orden debe quedar en el cliente conservado');
    assert.equal(c.db._datos.get('equipos').get('o2').clienteId, 'a', 'la orden ya correcta no se toca');
});

test('no se pierde el nombre alternativo: queda como alias', async t => {
    const { c, s } = servicio(t);
    await s.fusionarClientes('ana', 'a', ['b']);
    const destino = clientesDe(c).get('a');
    assert.ok(Array.isArray(destino.alias), 'debe guardar el alias');
    assert.ok(destino.alias.includes('J. Perez'), 'el nombre absorbido queda registrado: ' + JSON.stringify(destino.alias));
});

test('deja rastro en el registro de fusiones', async t => {
    const { c, s } = servicio(t);
    await s.fusionarClientes('ana', 'a', ['b']);
    const registro = c.db._datos.get('usuarios/ana/config').get('fusiones');
    assert.ok(registro, 'debe existir el registro de auditoría');
    assert.equal(registro.fusiones.length, 1);
    assert.equal(registro.fusiones[0].destino, 'a');
    assert.equal(registro.fusiones[0].absorbidos[0].nombre, 'J. Perez', 'guarda qué se absorbió, por si hay que auditar');
});

test('fusionar conserva el nombre del elegido, no del absorbido', async t => {
    const { c, s } = servicio(t);
    await s.fusionarClientes('ana', 'b', ['a']);
    const destino = clientesDe(c).get('b');
    assert.equal(destino.nombre, 'J. Perez');
    assert.ok(destino.alias.includes('Juan Pérez'));
    assert.equal(c.db._datos.get('equipos').get('o2').clienteId, 'b');
});

test('rechaza fusionar un cliente consigo mismo', async t => {
    const { c, s } = servicio(t);
    await assert.rejects(s.fusionarClientes('ana', 'a', ['a']), { code: 'seleccion-invalida' });
    assert.equal(clientesDe(c).has('b'), true, 'nada se borra si la selección es inválida');
});

test('rechaza una fusión sin origen o sin destino', async t => {
    const { s } = servicio(t);
    await assert.rejects(s.fusionarClientes('ana', '', ['b']), { code: 'seleccion-invalida' });
    await assert.rejects(s.fusionarClientes('ana', 'a', []), { code: 'seleccion-invalida' });
    await assert.rejects(s.fusionarClientes('ana', 'a', null), { code: 'seleccion-invalida' });
});

test('no borra nada si el cliente a conservar ya no existe', async t => {
    const { c, s } = servicio(t);
    await assert.rejects(s.fusionarClientes('ana', 'no-existe', ['b']), { code: 'no-encontrado' });
    assert.equal(clientesDe(c).has('b'), true, 'el absorbido debe sobrevivir a un fallo');
    assert.equal(c.db._datos.get('equipos').get('o1').clienteId, 'b', 'las órdenes quedan intactas');
});

test('fusionar tres de golpe agrupa todo bajo el mismo cliente', async t => {
    const { c, s } = servicio(t);
    c.db._datos.get('usuarios/ana/clientes').set('d', { nombre: 'Juan Perez', telefono: '+56 9 1111 2222', creado: 3 });
    await s.fusionarClientes('ana', 'a', ['b', 'd']);
    const agenda = clientesDe(c);
    assert.equal(agenda.size, 1, 'solo queda el cliente conservado');
    assert.equal(agenda.get('a').telefonos.length, 2, 'conserva los dos teléfonos');
    assert.equal(c.db._datos.get('equipos').get('o1').clienteId, 'a');
});

test('la fusión respeta el cambio de sesión: no se ejecuta con otra cuenta', async t => {
    const { c, s } = servicio(t);
    c.auth._entrar({ uid: 'otro', email: 'otro@taller.cl' });
    await tick();
    await assert.rejects(s.fusionarClientes('ana', 'a', ['b']), { code: 'sesion-cambiada' });
    assert.equal(clientesDe(c).has('b'), true);
});