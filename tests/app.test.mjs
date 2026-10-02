import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { montarApp, tick } from './helpers/entorno.mjs';

const USUARIO = { uid: 'uid-ana', email: 'ana@taller.cl' };

function equipo(extra = {}) {
    return {
        uid: USUARIO.uid,
        cliente: 'Juan Perez',
        telefono: '56912345678',
        equipo: 'Apple',
        modelo: 'iPhone 13',
        imei: '354890123',
        pin: '1234',
        accesorios: 'Funda',
        falla: 'Pantalla rota',
        estado: 'ingresado',
        costo: 85000,
        abono: 20000,
        fecha: '01-10-2025',
        timestamp: Date.now(),
        ...extra
    };
}

async function sesionIniciada(semilla = {}) {
    const ctx = montarApp({ semilla });
    ctx.auth._entrar(USUARIO);
    await tick(10);
    return ctx;
}

describe('Aislamiento de datos entre usuarios', () => {
    test('solo carga los equipos del usuario autenticado', async () => {
        const ajenos = {};
        for (let i = 0; i < 600; i++) {
            ajenos['otro' + i] = equipo({ uid: 'uid-malo', cliente: 'Cliente Ajeno', timestamp: Date.now() + i });
        }
        ajenos.mio = equipo({ cliente: 'Cliente Propio', timestamp: 1 });

        const { window, document } = await sesionIniciada({ equipos: ajenos });
        const texto = document.getElementById('lista-proyectos').textContent;

        assert.ok(texto.includes('Cliente Propio'), 'debe mostrar el equipo propio aunque haya 600 ajenos mas nuevos');
        assert.ok(!texto.includes('Cliente Ajeno'), 'no debe mostrar equipos de otros usuarios');
        assert.equal(window.TechFix.proyectos().length, 1);
    });

    test('al cerrar sesion se cancelan todas las suscripciones y se limpia la cache offline', async () => {
        const { db, document } = await sesionIniciada({
            equipos: { a: equipo() },
            catalogo: { c1: { uid: USUARIO.uid, marca: 'Apple', modelo: 'iPhone 13', reparacion: 'Pantalla', precio: 85000 } }
        });
        assert.ok(db._oyentes.length >= 2, 'deben existir listeners de equipos y catalogo');

        document.getElementById('btn-logout').click();
        await tick(10);

        assert.equal(db._oyentes.length, 0, 'no deben quedar listeners activos tras cerrar sesion');
        assert.ok(db._limpiezas.length > 0, 'debe limpiarse la persistencia offline de Firestore');
    });

    test('re-autenticarse no duplica listeners', async () => {
        const { db, auth } = await sesionIniciada({ equipos: { a: equipo() } });
        const n = db._oyentes.length;
        auth._entrar({ uid: 'uid-ana', email: 'ana@taller.cl' });
        await tick(10);
        assert.equal(db._oyentes.length, n, 'no deben acumularse listeners al repetir onAuthStateChanged');
    });
});

describe('Escapado y sanitizacion', () => {
    test('escapeHtml neutraliza comillas y angulares', async () => {
        const { window } = await sesionIniciada();
        const sucio = `" onerror="alert(1)" x="<script>`;
        const limpio = window.TechFix.escapeHtml(sucio);
        assert.ok(!limpio.includes('"'), 'las comillas dobles deben escaparse');
        assert.ok(!limpio.includes("'") || !sucio.includes("'"), 'las comillas simples deben escaparse');
        assert.ok(!limpio.includes('<'), 'los angulares deben escaparse');
    });

    test('un cliente con comillas no inyecta atributos en la tarjeta', async () => {
        const hostil = '" onmouseover="alert(1)" data-x="';
        const { document } = await sesionIniciada({
            equipos: { a: equipo({ cliente: hostil, evidencia: 'data:image/jpeg;base64,AAA' }) }
        });
        const lista = document.getElementById('lista-proyectos');

        // Ningun elemento debe haber ganado un manejador de eventos.
        for (const nodo of lista.querySelectorAll('*')) {
            for (const attr of nodo.attributes) {
                assert.ok(!/^on/i.test(attr.name), `atributo inyectado: ${attr.name}`);
            }
        }
        // Y el dato debe mostrarse tal cual, como texto.
        assert.equal(lista.querySelector('h3').textContent, hostil);
    });

    test('el ticket impreso escapa las comillas en los atributos', async () => {
        const { window, document } = await sesionIniciada({
            equipos: { a: equipo({ cliente: '"><img src=x onerror=alert(1)>' }) }
        });
        window.TechFix.imprimirBoleta('a');
        const ticket = document.getElementById('ticket-impresion');
        for (const nodo of ticket.querySelectorAll('*')) {
            for (const attr of nodo.attributes) {
                assert.ok(!/^on/i.test(attr.name), `atributo inyectado en el ticket: ${attr.name}`);
            }
        }
        assert.ok(ticket.textContent.includes('"><img src=x onerror=alert(1)>'), 'el nombre debe verse como texto');
    });
});

describe('WhatsApp', () => {
    test('normaliza el telefono y abre con noopener', async () => {
        const { window } = await sesionIniciada({ equipos: { a: equipo({ telefono: '+56 9 1234 5678' }) } });
        window.TechFix.enviarWhatsApp('a');
        const v = window.__ventanas.at(-1);
        assert.ok(v.url.startsWith('https://wa.me/56912345678?'), `URL invalida: ${v.url}`);
        assert.match(String(v.features ?? ''), /noopener/, 'debe abrirse con noopener');
    });

    test('avisa si el telefono no tiene digitos suficientes', async () => {
        const { window, swal } = await sesionIniciada({ equipos: { a: equipo({ telefono: '123' }) } });
        const antes = (window.__ventanas || []).length;
        window.TechFix.enviarWhatsApp('a');
        assert.equal((window.__ventanas || []).length, antes, 'no debe abrir WhatsApp con un numero invalido');
        assert.ok(swal.llamadas.length > 0);
    });
});

describe('Ticket y QR', () => {
    test('la URL de seguimiento usa el origen actual, no un dominio fijo', async () => {
        const { window } = await sesionIniciada({ equipos: { a: equipo() } });
        const url = window.TechFix.urlSeguimiento('a');
        assert.ok(url.startsWith('https://ejemplo.test/'), `debe usar location.origin: ${url}`);
        assert.ok(!url.includes('techfix-tracker-9a128.web.app'));
    });
});

describe('Firma digital', () => {
    test('las coordenadas se escalan al tamano real del canvas', async () => {
        const { window, document, trazos } = await sesionIniciada({ equipos: { a: equipo() } });
        const canvas = document.getElementById('canvas-firma');

        // El canvas mide 300x150 px internos pero se muestra a 600x300 (CSS width:100%)
        canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 300, right: 600, bottom: 300 });

        window.TechFix.archivarProyecto('a');
        const ev = new window.MouseEvent('mousedown', { clientX: 600, clientY: 300, bubbles: true });
        canvas.dispatchEvent(ev);

        const ultimo = trazos.at(-1);
        assert.equal(ultimo.tipo, 'move');
        assert.ok(
            Math.abs(ultimo.x - canvas.width) < 2 && Math.abs(ultimo.y - canvas.height) < 2,
            `el trazo debe mapearse al espacio del canvas, se obtuvo (${ultimo.x}, ${ultimo.y})`
        );
    });

    test('no permite guardar una firma en blanco', async () => {
        const { window, document, db } = await sesionIniciada({ equipos: { a: equipo() } });
        window.TechFix.archivarProyecto('a');
        document.getElementById('btn-guardar-firma').click();
        await tick(10);
        assert.notEqual(db._datos.get('equipos').get('a').estado, 'entregado', 'no debe entregarse sin firma');
    });
});

describe('Dashboard', () => {
    test('cuenta los reparados por fecha de reparacion, no por fecha de ingreso', async () => {
        const haceDosMeses = new Date();
        haceDosMeses.setMonth(haceDosMeses.getMonth() - 2);
        const { document } = await sesionIniciada({
            equipos: {
                viejo: equipo({ estado: 'reparado', timestamp: haceDosMeses.getTime(), fechaReparacion: Date.now(), costo: 10000 }),
                ingresadoHoy: equipo({ estado: 'ingresado', timestamp: Date.now(), costo: 50000 })
            }
        });
        assert.equal(document.getElementById('stat-reparados').textContent, '1');
        assert.ok(document.getElementById('stat-ingresos').textContent.includes('10'), 'solo debe sumar lo reparado este mes');
    });

    test('marca fechaReparacion al pasar a reparado', async () => {
        const { window, db } = await sesionIniciada({ equipos: { a: equipo() } });
        await window.TechFix.cambiarEstado('a', 'reparado');
        await tick(10);
        assert.ok(db._datos.get('equipos').get('a').fechaReparacion, 'debe registrarse la fecha de reparacion');
    });
});

describe('Formulario de ingreso', () => {
    test('permite escribir marca y modelo libres cuando se elige "Otro"', async () => {
        const { document } = await sesionIniciada();
        const marca = document.getElementById('marca');
        marca.value = 'Otro';
        marca.dispatchEvent(new document.defaultView.Event('change'));
        await tick();
        const libre = document.getElementById('marca-otro');
        assert.ok(libre, 'debe existir un campo de texto para la marca fuera de catalogo');
        assert.notEqual(libre.offsetParent === null && libre.hidden, true, 'el campo debe quedar visible');
    });

    test('rechaza abono mayor al costo', async () => {
        const { document, db, swal } = await sesionIniciada();
        document.getElementById('cliente').value = 'Test';
        document.getElementById('telefono').value = '56911112222';
        document.getElementById('marca').value = 'Apple';
        const modelo = document.getElementById('modelo');
        modelo.disabled = false;
        modelo.innerHTML = '<option value="iPhone 13">iPhone 13</option>';
        modelo.value = 'iPhone 13';
        document.getElementById('costo').value = '1000';
        document.getElementById('abono').value = '5000';

        document.getElementById('proyecto-form').dispatchEvent(
            new document.defaultView.Event('submit', { bubbles: true, cancelable: true })
        );
        await tick(20);

        assert.equal((db._datos.get('equipos') ?? new Map()).size, 0, 'no debe guardarse con abono > costo');
        assert.ok(swal.llamadas.some((c) => /abono/i.test(JSON.stringify(c))), 'debe avisar del abono invalido');
    });

    test('guarda un ingreso valido con uid del usuario', async () => {
        const { document, db } = await sesionIniciada();
        document.getElementById('cliente').value = 'Maria';
        document.getElementById('telefono').value = '+56 9 8888 7777';
        document.getElementById('marca').value = 'Samsung';
        const modelo = document.getElementById('modelo');
        modelo.disabled = false;
        modelo.innerHTML = '<option value="S22">S22</option>';
        modelo.value = 'S22';
        document.getElementById('costo').value = '50000';
        document.getElementById('abono').value = '10000';

        document.getElementById('proyecto-form').dispatchEvent(
            new document.defaultView.Event('submit', { bubbles: true, cancelable: true })
        );
        await tick(20);

        const docs = [...db._datos.get('equipos').values()];
        assert.equal(docs.length, 1);
        assert.equal(docs[0].uid, USUARIO.uid);
        assert.equal(docs[0].telefono, '56988887777', 'el telefono debe guardarse normalizado');
    });
});

describe('Seguimiento publico', () => {
    test('al crear un equipo se publica un espejo publico sin datos sensibles', async () => {
        const { document, db } = await sesionIniciada();
        document.getElementById('cliente').value = 'Maria';
        document.getElementById('telefono').value = '56988887777';
        document.getElementById('marca').value = 'Samsung';
        const modelo = document.getElementById('modelo');
        modelo.disabled = false;
        modelo.innerHTML = '<option value="S22">S22</option>';
        modelo.value = 'S22';
        document.getElementById('imei').value = '99988877';
        document.getElementById('pin').value = '4321';
        document.getElementById('costo').value = '50000';

        document.getElementById('proyecto-form').dispatchEvent(
            new document.defaultView.Event('submit', { bubbles: true, cancelable: true })
        );
        await tick(20);

        const espejo = db._datos.get('seguimiento');
        assert.ok(espejo && espejo.size === 1, 'debe crearse el documento publico de seguimiento');
        const publico = [...espejo.values()][0];
        const texto = JSON.stringify(publico);
        for (const sensible of ['Maria', '56988887777', '99988877', '4321']) {
            assert.ok(!texto.includes(sensible), `el espejo publico no debe incluir "${sensible}"`);
        }
        assert.equal(publico.modelo, 'S22');
        assert.equal(publico.estado, 'ingresado');
    });

    test('el cambio de estado se refleja en el espejo publico', async () => {
        const { window, db } = await sesionIniciada({
            equipos: { a: equipo() },
            seguimiento: { a: { estado: 'ingresado', modelo: 'iPhone 13', uid: USUARIO.uid } }
        });
        await window.TechFix.cambiarEstado('a', 'repuesto');
        await tick(10);
        assert.equal(db._datos.get('seguimiento').get('a').estado, 'repuesto');
    });

    test('borrar un equipo borra su espejo publico', async () => {
        const { window, db, swal } = await sesionIniciada({
            equipos: { a: equipo() },
            seguimiento: { a: { estado: 'ingresado', modelo: 'iPhone 13', uid: USUARIO.uid } }
        });
        swal.respuesta = true;
        await window.TechFix.eliminarProyectoPermanente('a');
        await tick(20);
        assert.equal(db._datos.get('seguimiento').has('a'), false, 'el espejo publico debe eliminarse tambien');
    });
});

describe('PIN del equipo', () => {
    test('se oculta por defecto y no filtra la longitud', async () => {
        const { document } = await sesionIniciada({ equipos: { a: equipo({ pin: '987654' }) } });
        const html = document.getElementById('lista-proyectos').innerHTML;
        assert.ok(!html.includes('987654'), 'el PIN no debe renderizarse en claro');
        assert.ok(!html.includes('******'), 'la mascara no debe revelar la longitud del PIN');
    });

    test('puede revelarse a peticion del tecnico', async () => {
        const { window, document } = await sesionIniciada({ equipos: { a: equipo({ pin: '987654' }) } });
        window.TechFix.revelarPin('a');
        await tick();
        assert.ok(document.getElementById('lista-proyectos').textContent.includes('987654'), 'el tecnico debe poder ver el PIN');
    });
});

describe('Robustez', () => {
    test('un error al cambiar estado se informa y no queda silencioso', async () => {
        const { window, swal } = await sesionIniciada({ equipos: { a: equipo() } });
        await window.TechFix.cambiarEstado('inexistente', 'reparado');
        await tick(10);
        assert.ok(swal.llamadas.some((c) => /error/i.test(JSON.stringify(c))), 'debe mostrarse un error al usuario');
    });

    test('el buscador filtra por cliente, IMEI y falla', async () => {
        const { document } = await sesionIniciada({
            equipos: {
                a: equipo({ cliente: 'Ana Soto', imei: '111' }),
                b: equipo({ cliente: 'Beto Lara', imei: '222', falla: 'No carga' })
            }
        });
        const buscador = document.getElementById('buscador');
        buscador.value = '222';
        buscador.dispatchEvent(new document.defaultView.Event('input'));
        await tick(400);
        const txt = document.getElementById('lista-proyectos').textContent;
        assert.ok(txt.includes('Beto Lara'));
        assert.ok(!txt.includes('Ana Soto'));
    });
});
