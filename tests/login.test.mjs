/**
 * El login debe distinguir un problema de CONFIGURACION del proyecto
 * (proveedor de correo no habilitado, clave invalida, dominio no autorizado)
 * de unas credenciales simplemente incorrectas.
 *
 * Antes todos esos casos caian en "Credenciales incorrectas.", que hacia
 * reintentar la contrasena hasta terminar en auth/too-many-requests por
 * bloqueo de la cuenta, sin indicar la causa real.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarApp, tick } from './helpers/entorno.mjs';

function iniciar(t) {
    const c = montarApp({ antesDeIniciar: (w) => { w.KryoFixEntorno.modo = 'spark'; } });
    t.after(() => c.dom.window.close());
    return c;
}

/** Rellena el formulario y dispara el envío con un error de Firebase dado. */
async function intentar(c, error) {
    c.document.getElementById('login-email').value = 'taller@correo.cl';
    c.document.getElementById('login-password').value = 'secreto123';
    c.auth._fallarCon(error);
    c.document.getElementById('login-form').dispatchEvent(new c.window.Event('submit', { cancelable: true }));
    await tick();
    const ultimo = c.swal.llamadas[c.swal.llamadas.length - 1];
    return ultimo ? String(ultimo.text || '') : '';
}

test('un proveedor no habilitado explica la causa en vez de culpar a la contrasena', async t => {
    const c = iniciar(t);
    const texto = await intentar(c, { code: 'auth/operation-not-allowed', message: 'x' });
    assert.match(texto, /Correo\/contraseña|Sign-in method/i);
    assert.doesNotMatch(texto, /Credenciales incorrectas/);
});

test('clave de app invalida y dominio no autorizado se distinguen de una mala contrasena', async t => {
    for (const [code, patron] of [
        ['auth/invalid-api-key', /clave de la aplicación/i],
        ['auth/app-not-authorized', /dominio/i],
        ['auth/unauthorized-domain', /dominio/i],
        ['auth/project-not-found', /proyecto/i]
    ]) {
        const c = iniciar(t);
        const texto = await intentar(c, { code, message: 'x' });
        assert.match(texto, patron, 'mensaje util para ' + code);
        assert.doesNotMatch(texto, /Credenciales incorrectas/, 'no debe culpar a la contrasena en ' + code);
        c.dom.window.close();
    }
});

test('credenciales genuinamente erroneas siguen con mensaje generico (no enumera usuarios)', async t => {
    for (const code of ['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password']) {
        const c = iniciar(t);
        const texto = await intentar(c, { code, message: 'x' });
        assert.equal(texto, 'Credenciales incorrectas.', 'mensaje generico para ' + code);
        c.dom.window.close();
    }
});

test('los limites siguenーズpecificos y el boton se rehabilita tras fallar', async t => {
    const c = iniciar(t);
    assert.match(await intentar(c, { code: 'auth/too-many-requests', message: 'x' }), /Espera unos minutos/);
    assert.match(await intentar(c, { code: 'auth/network-request-failed', message: 'x' }), /conexion/i);
    assert.match(await intentar(c, { code: 'auth/invalid-email', message: 'x' }), /formato valido/);
    const btn = c.document.querySelector('#login-form button[type="submit"]');
    assert.equal(btn.disabled, false, 'el boton debe volver a estar disponible');
    assert.equal(btn.textContent, 'Ingresar al Sistema');
});

test('el codigo real del error queda en la consola para poder diagnosticar', async t => {
    const c = iniciar(t);
    const avisos = [];
    c.window.console.warn = (...a) => avisos.push(a.join(' '));
    await intentar(c, { code: 'auth/operation-not-allowed', message: 'proveedor deshabilitado' });
    assert.ok(avisos.some((a) => a.includes('auth/operation-not-allowed')), 'el codigo debe quedar registrado');
});
// ---------------------------------------------------------------------------
// El rechazo por UID debe ser autodiagnosticable. Un UID de 28 caracteres se
// teclea mal con facilidad y, sin comparar ambos, el sintoma es un callejon
// sin salida: el tecnico solo ve "Cuenta no autorizada".
// ---------------------------------------------------------------------------

function conUidPublicado(t, publicado) {
    const c = montarApp({ antesDeIniciar: (w) => { w.KryoFixEntorno.modo = 'spark'; w.KryoFixEntorno.propietarioUid = publicado; } });
    t.after(() => c.dom.window.close());
    return c;
}

test('al rechazar un UID incorrecto se muestran ambos para poder compararlos', async t => {
    const esperado = 'WuwekSPQ8NXJQfC5dudISPB08xBc3';
    const c = conUidPublicado(t, esperado);
    const avisos = [];
    c.window.console.warn = (...a) => avisos.push(a.join(' '));
    c.auth._entrar({ uid: 'n6o8TUgbOJP2O9yYLqeRmHjPEUE3', email: 'taller@correo.cl' });
    await tick();
    const alerta = c.swal.llamadas.find((x) => x.title === 'Cuenta no autorizada');
    assert.ok(alerta, 'debe avisar que la cuenta no esta autorizada');
    assert.match(alerta.text, /n6o8TUgbOJP2O9yYLqeRmHjPEUE3/, 'indica el UID con el que se entro');
    assert.match(alerta.text, new RegExp(esperado), 'indica el UID que espera el sitio');
    assert.match(alerta.text, /publicar/i, 'indica como corregirlo');
    // El dato clave tambien queda en consola, sin depender del mensaje.
    assert.ok(avisos.some((a) => a.includes(esperado) && a.includes('n6o8TUgbOJP2O9yYLqeRmHjPEUE3')));
    assert.equal(c.auth.currentUser, null, 'la sesion se cierra y no quedan datos visibles');
});

test('con el UID correcto la sesion entra y no se muestra el aviso', async t => {
    const uid = 'n6o8TUgbOJP2O9yYLqeRmHjPEUE3';
    const c = conUidPublicado(t, uid);
    c.auth._entrar({ uid, email: 'taller@correo.cl' });
    await tick();
    assert.equal(c.document.getElementById('app-content').style.display, 'block');
    assert.ok(!c.swal.llamadas.some((x) => x.title === 'Cuenta no autorizada'));
});

// ---------------------------------------------------------------------------
// Alcance de los indicadores. El tablero carga un numero limitado de ordenes
// (100 en Spark, 500 con backend). Si la interfaz anuncia un tope que no es el
// real, el taller lee un saldo parcial como si fuera el saldo completo.
// ---------------------------------------------------------------------------

function iniciarConOrdenes(t, cantidad, opciones = {}) {
    const c = montarApp({
        semilla: { equipos: Object.fromEntries(Array.from({ length: cantidad }, (_, i) => ['o' + i, {
            uid: 'dueno', cliente: 'Cliente ' + i, telefono: '5690000' + String(i).padStart(4, '0'),
            equipo: 'Apple', modelo: 'iPhone 13', estado: 'reparado', costo: 10000, abono: 0,
            timestamp: 1, schemaVersion: 2, revisionOrden: 0
        }])) },
        antesDeIniciar: (w) => { w.KryoFixEntorno.modo = opciones.modo || 'spark'; if (opciones.uid) w.KryoFixEntorno.propietarioUid = opciones.uid; }
    });
    t.after(() => c.dom.window.close());
    c.auth._entrar({ uid: 'dueno', email: 'taller@correo.cl' });
    return c;
}

test('la ayuda anuncia el tope real del modo, no siempre 500', async t => {
    const c = iniciarConOrdenes(t, 1);
    await tick(50);
    const ayuda = c.document.getElementById('ayuda-limite-carga');
    assert.match(ayuda.textContent, /100/, 'en Spark solo se cargan 100 ordenes');
    assert.doesNotMatch(ayuda.textContent, /500/, 'no debe prometer 500 cuando no se cargan');
    const frec = c.document.getElementById('ayuda-frecuencias');
    assert.match(frec.textContent, /máximo 100/);
});

test('al alcanzar el tope se avisa que los indicadores estan incompletos', async t => {
    const c = iniciarConOrdenes(t, 100);
    await tick(60);
    const aviso = c.document.getElementById('aviso-tope-carga');
    assert.ok(aviso, 'debe aparecer el aviso de alcance incompleto');
    assert.match(aviso.textContent, /100 órdenes cargadas/);
    assert.match(aviso.textContent, /Historial/, 'debe indicar como consultar el resto');
    assert.match(c.document.getElementById('contador-resultados').textContent, /de las últimas 100/);
});

test('sin alcanzar el tope no hay aviso ni coletilla en el contador', async t => {
    const c = iniciarConOrdenes(t, 40);
    await tick(60);
    assert.equal(c.document.getElementById('aviso-tope-carga').hidden, true);
    assert.match(c.document.getElementById('contador-resultados').textContent, /^\d+ ordenes?$/);
});

test('el aviso de alcance desaparece al cerrar sesion', async t => {
    const c = iniciarConOrdenes(t, 100);
    await tick(60);
    assert.ok(c.document.getElementById('aviso-tope-carga'));
    await c.auth.signOut();
    await tick(60);
    const a = c.document.getElementById('aviso-tope-carga'); assert.ok(a.hidden, 'no puede quedar visible tras salir');
});

// ---------------------------------------------------------------------------
// Busqueda del tablero. El tecnico escribe rapido y sin tildes: "gonzalez"
// tiene que encontrar "Gonzalez". Antes la comparacion era literal y la orden
// quedaba escondida, igual que cualquier combinacion de dos palabras.
// ---------------------------------------------------------------------------

const CLIENTES_BUSQUEDA = [
    { cliente: 'María González', equipo: 'Apple', modelo: 'iPhone 13', imei: '354890123456789', idOrden: 'KRF-000001', telefono: '56912345678' },
    { cliente: 'Carlos Pérez', equipo: 'Samsung', modelo: 'Galaxy S21', imei: '351234567890123', idOrden: 'KRF-000002', telefono: '56987654321' },
    { cliente: 'Ana Núñez', equipo: 'Xiaomi', modelo: 'Redmi Note 12', imei: '359999999999999', idOrden: 'KRF-000003', telefono: '56955555555' }
];

function iniciarBusqueda(t) {
    const c = montarApp({
        semilla: { equipos: Object.fromEntries(CLIENTES_BUSQUEDA.map((d, i) => ['o' + i,
            { uid: 'dueno', estado: 'ingresado', costo: 0, abono: 0, timestamp: 1, schemaVersion: 2, revisionOrden: 0, ...d }])) },
        antesDeIniciar: (w) => { w.KryoFixEntorno.modo = 'spark'; }
    });
    t.after(() => c.dom.window.close());
    c.auth._entrar({ uid: 'dueno', email: 'taller@correo.cl' });
    return c;
}

async function buscar(c, texto) {
    const campo = c.document.getElementById('buscador');
    campo.value = texto;
    campo.dispatchEvent(new c.window.Event('input', { bubbles: true }));
    await tick(320); // el buscador tiene un rebote de 250 ms
    return c.document.querySelectorAll('article.tarjeta-proyecto').length;
}

test('la busqueda ignora tildes y mayusculas', async t => {
    const c = iniciarBusqueda(t);
    await tick(60);
    for (const q of ['gonzalez', 'González', 'gonzález', 'nunez', 'nuñez', 'NÚÑEZ']) {
        assert.equal(await buscar(c, q), 1, 'debe encontrar 1 orden con: ' + q);
    }
});

test('varias palabras funcionan en cualquier orden', async t => {
    const c = iniciarBusqueda(t);
    await tick(60);
    for (const q of ['maria gonzalez', 'gonzalez maria', 'samsung perez', 'perez samsung']) {
        assert.equal(await buscar(c, q), 1, 'debe encontrar 1 orden con: ' + q);
    }
});

test('sigue encontrando por numero de orden, IMEI y modelo', async t => {
    const c = iniciarBusqueda(t);
    await tick(60);
    assert.equal(await buscar(c, 'KRF-000002'), 1);
    assert.equal(await buscar(c, '351234567890123'), 1);
    assert.equal(await buscar(c, 'iphone 13'), 1);
});

test('un termino imposible da cero resultados y no inventa coincidencias', async t => {
    const c = iniciarBusqueda(t);
    await tick(60);
    assert.equal(await buscar(c, 'xyz'), 0);
    assert.equal(await buscar(c, 'gonzalez xyz'), 0);
});

test('si casi todos los terminos coinciden, se sugiere ampliar en vez de un silencio', async t => {
    const c = iniciarBusqueda(t);
    await tick(60);
    assert.equal(await buscar(c, 'gonzalez inexistente'), 0);
    const aviso = c.document.getElementById('aviso-busqueda');
    assert.equal(aviso.hidden, false, 'debe avisar que hay coincidencias parciales');
    assert.match(aviso.textContent, /1 orden coincide con casi todos/);
    // Con un solo termino no tiene sentido "casi todos".
    await buscar(c, 'gonzalez');
    assert.equal(aviso.hidden, true);
});

// ---------------------------------------------------------------------------
// Panel de prioridades, garantía vencida y modo sin conexión
// ---------------------------------------------------------------------------

test('el panel de prioridades aparece con trabajo pendiente real', async t => {
    const c = montarApp({
        semilla: { equipos: {
            o1: { uid: 'dueno', cliente: 'Ana Lara', estado: 'entregado', costo: 50000, abono: 20000, schemaVersion: 2, revisionOrden: 0, timestamp: 1, fechaEntrega: Date.now() - 40 * 86400000 }
        } },
        antesDeIniciar: (w) => { w.KryoFixEntorno.modo = 'spark'; }
    });
    t.after(() => c.dom.window.close());
    c.auth._entrar({ uid: 'dueno', email: 't@e.cl' });
    await tick(80);
    const panel = c.document.getElementById('panel-prioridades');
    assert.equal(panel.hidden, false, 'debe mostrar el panel cuando hay trabajo pendiente');
    assert.match(panel.textContent, /Cobrar saldo en equipos ya entregados/);
    assert.match(panel.textContent, /\$30\.000/);
});

test('el panel se oculta cuando no hay nada que hacer', async t => {
    const c = montarApp({
        semilla: { equipos: { o1: { uid: 'dueno', cliente: 'Tranquila', estado: 'ingresado', costo: 0, abono: 0, schemaVersion: 2, revisionOrden: 0, timestamp: Date.now() } } },
        antesDeIniciar: (w) => { w.KryoFixEntorno.modo = 'spark'; }
    });
    t.after(() => c.dom.window.close());
    c.auth._entrar({ uid: 'dueno', email: 't@e.cl' });
    await tick(80);
    assert.equal(c.document.getElementById('panel-prioridades').hidden, true, 'no debe inventar trabajo');
});

test('la tarjeta muestra la garantía vencida y la última actualización', async t => {
    const c = montarApp({
        semilla: { equipos: {
            o1: { uid: 'dueno', cliente: 'María', estado: 'entregado', costo: 0, abono: 0, schemaVersion: 2, revisionOrden: 0,
                timestamp: Date.now() - 40 * 86400000, fechaEntrega: Date.now() - 40 * 86400000,
                garantia: { estado: 'abierta', en: Date.now() - 35 * 86400000 } }
        } },
        antesDeIniciar: (w) => { w.KryoFixEntorno.modo = 'spark'; }
    });
    t.after(() => c.dom.window.close());
    c.auth._entrar({ uid: 'dueno', email: 't@e.cl' });
    await tick(80);
    // La garantía se crea al entregar: hay que ver el historial, no solo activos.
    c.document.getElementById('filtro-estado').value = 'todos';
    c.document.getElementById('filtro-estado').dispatchEvent(new c.window.Event('change', { bubbles: true }));
    await tick(40);
    const tarjeta = c.document.querySelector('[data-id="o1"]');
    assert.ok(tarjeta, 'la orden debe estar visible en el historial');
    assert.match(tarjeta.textContent, /Garantía vencida hace 35 días/, 'debe advertir la garantía vencida');
    assert.match(tarjeta.textContent, /Actualizada/, 'debe indicar cuándo se movió por última vez');
});

test('sin conexión se explica qué sí funciona y qué queda en espera', async t => {
    const c = montarApp({
        semilla: { equipos: { o1: { uid: 'dueno', cliente: 'Ana', estado: 'ingresado', costo: 0, abono: 0, schemaVersion: 2, revisionOrden: 0, timestamp: Date.now() } } },
        antesDeIniciar: (w) => { w.KryoFixEntorno.modo = 'spark'; }
    });
    t.after(() => c.dom.window.close());
    c.auth._entrar({ uid: 'dueno', email: 't@e.cl' });
    await tick(60);
    const panel = c.document.getElementById('panel-sin-conexion');
    // jsdom permite simular la caida de red.
    Object.defineProperty(c.window.navigator, 'onLine', { value: false, configurable: true });
    c.document.dispatchEvent(new c.window.Event('offline'));
    c.window.dispatchEvent(new c.window.Event('offline'));
    await tick(30);
    assert.match(panel.textContent, /Trabajando sin conexión/);
    assert.match(panel.textContent, /pagos/, 'debe decir qué queda en espera');
    Object.defineProperty(c.window.navigator, 'onLine', { value: true, configurable: true });
    c.window.dispatchEvent(new c.window.Event('online'));
    await tick(30);
    assert.equal(panel.hidden, true, 'al volver la conexión debe retirarse el aviso');
});
