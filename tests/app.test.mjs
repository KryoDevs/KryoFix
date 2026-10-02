import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { montarApp, tick } from './helpers/entorno.mjs';

const USUARIO = { uid: 'uid-ana', email: 'ana@taller.cl' };

function equipo(extra = {}) {
    return {
        uid: USUARIO.uid,
        idOrden: 'TF-251002-001',
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
        fecha: '2025-10-01T12:00:00.000Z',
        timestamp: Date.now(),
        ...extra
    };
}

async function sesionIniciada(semilla = {}, opciones = {}) {
    const ctx = montarApp({ semilla, ...opciones });
    ctx.auth._entrar(USUARIO);
    await tick(10);
    return ctx;
}

/** Lee el contenido de un Blob descargado (jsdom no implementa Blob.text). */
function leerBlob(window, blob) {
    return new Promise((resolver, rechazar) => {
        const lector = new window.FileReader();
        lector.onload = () => resolver(String(lector.result));
        lector.onerror = () => rechazar(lector.error);
        lector.readAsText(blob);
    });
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

    test('el ticket impreso no inyecta HTML desde los datos del cliente', async () => {
        const { window, document } = await sesionIniciada({
            equipos: { a: equipo({ cliente: '"><img src=x onerror=alert(1)>' }) }
        });
        window.TechFix.imprimirBoleta('a');
        const ticket = document.getElementById('capa-impresion');
        assert.ok(ticket, 'debe existir la capa de impresion');
        for (const nodo of ticket.querySelectorAll('*')) {
            for (const attr of nodo.attributes) {
                assert.ok(!/^on/i.test(attr.name), `atributo inyectado en el ticket: ${attr.name}`);
            }
        }
        assert.equal(ticket.querySelectorAll('img[src="x"]').length, 0, 'el HTML inyectado no debe crear elementos');
        assert.ok(
            ticket.textContent.includes('"><img src=x onerror=alert(1)>'),
            'el nombre debe verse como texto'
        );
    });
});

describe('WhatsApp y compartir', () => {
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

    test('compartir copia el enlace de seguimiento al portapapeles', async () => {
        const { window } = await sesionIniciada({ equipos: { a: equipo() } });
        let copiado = '';
        Object.defineProperty(window.navigator, 'clipboard', {
            value: { writeText: async (t) => { copiado = t; } },
            configurable: true
        });
        await window.TechFix.compartirTicket('a');
        assert.equal(copiado, window.TechFix.urlSeguimiento('a'));
    });
});

describe('Ticket, QR y numero de orden', () => {
    test('la URL de seguimiento usa el origen actual, no un dominio fijo', async () => {
        const { window } = await sesionIniciada({ equipos: { a: equipo() } });
        const url = window.TechFix.urlSeguimiento('a');
        assert.ok(url.startsWith('https://ejemplo.test/'), `debe usar location.origin: ${url}`);
        assert.ok(!url.includes('techfix-tracker-9a128.web.app'));
    });

    test('sin la libreria de QR el ticket usa el QR estatico versionado', async () => {
        const { window, document } = await sesionIniciada({ equipos: { a: equipo() } });
        window.TechFix.imprimirBoleta('a');
        const img = document.querySelector('#capa-impresion .boleta-qr img');
        assert.ok(img, 'debe dibujarse un QR de respaldo');
        assert.equal(img.getAttribute('src'), 'ticket-qr.png');
        assert.ok(
            document.querySelector('#capa-impresion .url-respaldo').textContent.startsWith('https://ejemplo.test/'),
            'la URL debe quedar impresa como texto'
        );
    });

    test('con la libreria de QR disponible el ticket genera un SVG propio (sin terceros)', async () => {
        const { window, document } = await sesionIniciada({ equipos: { a: equipo() } }, { conQr: true });
        window.TechFix.imprimirBoleta('a');
        const svg = document.querySelector('#capa-impresion .boleta-qr svg');
        assert.ok(svg, 'debe generarse el QR en el navegador');
        assert.ok(!document.querySelector('#capa-impresion img[src^="https://api"]'), 'nada de servicios externos de QR');
    });

    test('el numero de orden es legible y se imprime en el ticket', async () => {
        const { window, document, db } = await sesionIniciada();
        document.getElementById('cliente').value = 'Maria';
        document.getElementById('telefono').value = '56988887777';
        document.getElementById('marca').value = 'Samsung';
        const modelo = document.getElementById('modelo');
        modelo.disabled = false;
        modelo.innerHTML = '<option value="S22">S22</option>';
        modelo.value = 'S22';
        document.getElementById('costo').value = '50000';

        document.getElementById('proyecto-form').dispatchEvent(
            new document.defaultView.Event('submit', { bubbles: true, cancelable: true })
        );
        await tick(20);

        const guardado = [...db._datos.get('equipos').values()][0];
        assert.match(guardado.idOrden, /^TF-\d{6}-\d{3}$/, `numero de orden inesperado: ${guardado.idOrden}`);

        window.TechFix.imprimirBoleta([...db._datos.get('equipos').keys()][0]);
        assert.ok(
            document.getElementById('capa-impresion').textContent.includes(guardado.idOrden),
            'el numero de orden debe aparecer en el ticket'
        );
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

    test('el fondo del lienzo se pinta de blanco (se exporta a JPEG, sin alfa)', async () => {
        const { window, document, trazos } = await sesionIniciada({ equipos: { a: equipo() } });
        trazos.length = 0;
        window.TechFix.archivarProyecto('a');
        const primerTrazo = trazos[0];
        assert.equal(
            primerTrazo && primerTrazo.tipo,
            'fill',
            'sin pintar el fondo, la firma exportada a JPEG sale con fondo negro'
        );

        trazos.length = 0;
        document.getElementById('btn-limpiar-firma').click();
        assert.equal(trazos[0] && trazos[0].tipo, 'fill', 'limpiar tambien debe repintar el fondo');
    });

    test('no permite guardar una firma en blanco', async () => {
        const { window, document, db } = await sesionIniciada({ equipos: { a: equipo() } });
        window.TechFix.archivarProyecto('a');
        document.getElementById('btn-guardar-firma').click();
        await tick(10);
        assert.notEqual(db._datos.get('equipos').get('a').estado, 'entregado', 'no debe entregarse sin firma');
    });

    test('la entrega con firma guarda firma, fecha de entrega e historial', async () => {
        const { window, document, db } = await sesionIniciada({
            equipos: { a: equipo({ historial: [{ estado: 'ingresado', en: 1, por: USUARIO.uid }] }) }
        });
        window.TechFix.archivarProyecto('a');
        const canvas = document.getElementById('canvas-firma');
        canvas.dispatchEvent(new window.MouseEvent('mousedown', { clientX: 10, clientY: 10, bubbles: true }));
        canvas.dispatchEvent(new window.MouseEvent('mousemove', { clientX: 30, clientY: 40, bubbles: true }));
        document.getElementById('btn-guardar-firma').click();
        await tick(20);

        const doc = db._datos.get('equipos').get('a');
        assert.equal(doc.estado, 'entregado');
        assert.ok(String(doc.firmaCliente).startsWith('data:image/jpeg'));
        assert.ok(doc.fechaEntrega > 0, 'debe registrarse la fecha de entrega');
        assert.equal(doc.historial.length, 2, 'el historial debe acumular la entrega');
        assert.equal(doc.historial.at(-1).estado, 'entregado');
        assert.equal(db._datos.get('seguimiento').get('a').estado, 'entregado');
    });
});

describe('Estados: transiciones y recordatorios', () => {
    test('permiteEstado admite avanzar, retroceder un paso y reserva entregado', async () => {
        const { window } = await sesionIniciada();
        const { permiteEstado } = window.TechFix;
        assert.equal(permiteEstado({ estado: 'ingresado' }, 'reparado'), true);
        assert.equal(permiteEstado({ estado: 'ingresado' }, 'entregado'), false, 'entregado se reserva a la firma');
        assert.equal(permiteEstado({ estado: 'reparado' }, 'repuesto'), true, 'un paso atras corrige un clic');
        assert.equal(permiteEstado({ estado: 'reparado' }, 'revision'), false, 'no se puede saltar hacia atras');
        assert.equal(permiteEstado({ estado: 'entregado' }, 'entregado'), true);
        assert.equal(permiteEstado({ estado: 'entregado' }, 'ingresado'), false);
    });

    test('el selector de la tarjeta deshabilita los estados no alcanzables', async () => {
        const { document } = await sesionIniciada({ equipos: { a: equipo({ estado: 'ingresado' }) } });
        const select = document.querySelector('#lista-proyectos select');
        assert.equal(select.querySelector('option[value="entregado"]').disabled, true);
        assert.equal(select.querySelector('option[value="reparado"]').disabled, false);
    });

    test('un salto de estado invalido no escribe en la base', async () => {
        const { window, db } = await sesionIniciada({ equipos: { a: equipo({ estado: 'reparado' }) } });
        await window.TechFix.cambiarEstado('a', 'revision');
        await tick(10);
        assert.equal(db._datos.get('equipos').get('a').estado, 'reparado');
    });

    test('el cambio de estado queda registrado en el historial', async () => {
        const { window, db } = await sesionIniciada({
            equipos: { a: equipo({ historial: [{ estado: 'ingresado', en: 1, por: USUARIO.uid }] }) }
        });
        await window.TechFix.cambiarEstado('a', 'reparado');
        await tick(10);
        const doc = db._datos.get('equipos').get('a');
        assert.equal(doc.historial.length, 2);
        assert.equal(doc.historial.at(-1).estado, 'reparado');
        assert.ok(doc.historial.at(-1).en > 0);
    });

    test('avisa cuando un equipo lleva demasiado tiempo en el taller', async () => {
        const haceCuarentaDias = Date.now() - 40 * 86400000;
        const { document } = await sesionIniciada({
            equipos: {
                listo: equipo({
                    cliente: 'Ana Lista',
                    estado: 'reparado',
                    timestamp: haceCuarentaDias,
                    fechaReparacion: haceCuarentaDias
                }),
                nuevo: equipo({ cliente: 'Beto Nuevo', estado: 'repuesto', timestamp: Date.now() })
            }
        });

        const aviso = document.getElementById('aviso-vencidos');
        assert.equal(aviso.hidden, false, 'debe mostrarse el aviso de equipos sin retirar');
        assert.match(aviso.textContent, /Ana Lista/);
        assert.ok(!aviso.textContent.includes('Beto Nuevo'), 'solo entran las ordenes que superan el plazo');

        const tarjeta = [...document.querySelectorAll('#lista-proyectos .badge-espera')];
        assert.equal(tarjeta.length, 1, 'solo la orden antigua lleva la marca de espera');
    });

    test('el aviso permite filtrar los equipos listos para entregar', async () => {
        const haceCuarentaDias = Date.now() - 40 * 86400000;
        const { document } = await sesionIniciada({
            equipos: {
                listo: equipo({ cliente: 'Ana Lista', estado: 'reparado', timestamp: haceCuarentaDias, fechaReparacion: haceCuarentaDias }),
                otro: equipo({ cliente: 'Beto Nuevo', estado: 'repuesto', timestamp: Date.now() })
            }
        });
        document.getElementById('btn-ver-vencidos').click();
        await tick(10);
        assert.equal(document.getElementById('filtro-estado').value, 'reparado');
        const texto = document.getElementById('lista-proyectos').textContent;
        assert.ok(texto.includes('Ana Lista'));
        assert.ok(!texto.includes('Beto Nuevo'));
    });
});

describe('Exportacion a CSV', () => {
    test('escapa comillas, saltos de linea y agrega BOM para Excel', async () => {
        const { window } = await sesionIniciada();
        const csv = window.TechFix.exportCSV([
            equipo({ cliente: 'Ana "la jefa"', falla: 'Linea 1\nLinea 2', costo: 1000, abono: 500 })
        ]);
        assert.ok(csv.startsWith('\ufeff'), 'debe empezar con BOM');
        assert.ok(csv.includes('"Ana ""la jefa"""'), 'las comillas internas deben duplicarse');
        assert.ok(csv.includes('"Linea 1\nLinea 2"'), 'el salto de linea debe quedar dentro de comillas');
        assert.ok(csv.includes('"500"'), 'debe incluir el saldo calculado');
    });

    test('exporta solo lo que el filtro deja ver y descarga el archivo', async () => {
        const { window, document } = await sesionIniciada({
            equipos: {
                activo: equipo({ cliente: 'Cliente Activo' }),
                viejo: equipo({ cliente: 'Cliente Antiguo', estado: 'entregado', timestamp: 5 })
            }
        });
        document.getElementById('btn-exportar').click();
        await tick(10);

        assert.equal(window.__descargas.length, 1, 'debe generarse una descarga');
        const texto = await leerBlob(window, window.__descargas[0]);
        assert.ok(texto.includes('Cliente Activo'));
        assert.ok(!texto.includes('Cliente Antiguo'), 'con el filtro "activos" no debe exportar entregados');
    });
});

describe('Indicador de red', () => {
    test('muestra Offline mientras no hay conexion y Online al recuperarla', async () => {
        const { window, document } = await sesionIniciada();
        const badge = document.getElementById('red-status');

        Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
        window.dispatchEvent(new window.Event('offline'));
        assert.match(badge.textContent, /Offline/);
        assert.equal(badge.style.display, 'inline-block');
        assert.match(badge.className, /estado-revision/);

        Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
        window.dispatchEvent(new window.Event('online'));
        assert.match(badge.textContent, /Online/);
        assert.match(badge.className, /estado-reparado/);
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

    test('rechaza abono mayor al costo y marca el campo', async () => {
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
        assert.ok(document.getElementById('abono').classList.contains('campo-invalido'), 'el campo debe quedar marcado');
        assert.ok(!document.getElementById('cliente').classList.contains('campo-invalido'));
    });

    test('guarda un ingreso valido con uid, fecha ISO y telefono normalizado', async () => {
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
        assert.match(docs[0].fecha, /^\d{4}-\d{2}-\d{2}T/, 'la fecha debe guardarse en ISO 8601');
        assert.equal(docs[0].fechaEntrega, null);
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
        assert.deepEqual(Object.keys(publico).sort(), ['actualizado', 'estado', 'modelo', 'uid']);
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

describe('Catalogo de precios', () => {
    test('el buscador del catalogo filtra sin duplicar tarjetas', async () => {
        const { document } = await sesionIniciada({
            catalogo: {
                c1: { uid: USUARIO.uid, marca: 'Apple', modelo: 'iPhone 13', reparacion: 'Pantalla', precio: 85000 },
                c2: { uid: USUARIO.uid, marca: 'Samsung', modelo: 'S22', reparacion: 'Bateria', precio: 45000 }
            }
        });
        const buscador = document.getElementById('cat-buscador');
        buscador.value = 'samsung';
        buscador.dispatchEvent(new document.defaultView.Event('input'));
        await tick(300);

        const tarjetas = document.querySelectorAll('#lista-catalogo .tarjeta-catalogo');
        assert.equal(tarjetas.length, 1, 'solo debe quedar la coincidencia (sin duplicados)');
        assert.match(tarjetas[0].textContent, /Samsung/);

        buscador.value = 'zzz';
        buscador.dispatchEvent(new document.defaultView.Event('input'));
        await tick(300);
        assert.equal(document.querySelectorAll('#lista-catalogo .tarjeta-catalogo').length, 0);
        assert.match(document.getElementById('lista-catalogo').textContent, /No se encontraron precios/);
    });
});

describe('Arranque', () => {
    test('sin Firebase avisa en pantalla en vez de morir en silencio', async () => {
        const { window, document, errores } = montarApp({ sinFirebase: true });
        await tick(10);
        const aviso = document.getElementById('aviso-dependencias');
        assert.equal(aviso.hidden, false, 'debe mostrarse el aviso de dependencias');
        assert.match(aviso.textContent, /Firebase/);
        assert.equal(window.TechFix.iniciada, false);
        assert.equal(errores.length, 0, 'no debe haber excepciones sin capturar');
    });
});

describe('Robustez', () => {
    test('un error al cambiar estado se informa y no queda silencioso', async () => {
        const { window, swal } = await sesionIniciada({ equipos: { a: equipo() } });
        await window.TechFix.cambiarEstado('inexistente', 'reparado');
        await tick(10);
        assert.ok(swal.llamadas.some((c) => /error/i.test(JSON.stringify(c))), 'debe mostrarse un error al usuario');
    });

    test('un cambio de estado sobre un documento borrado no rompe la app', async () => {
        const { window, db, swal } = await sesionIniciada({ equipos: { a: equipo() } });
        db._datos.get('equipos').delete('a');
        await window.TechFix.cambiarEstado('a', 'reparado');
        await tick(10);
        assert.ok(swal.llamadas.some((c) => /error/i.test(JSON.stringify(c))));
        assert.ok(window.TechFix.proyectos().length >= 0, 'la app sigue funcionando');
    });

    test('el buscador filtra por cliente, IMEI, numero de orden y falla', async () => {
        const { document } = await sesionIniciada({
            equipos: {
                a: equipo({ cliente: 'Ana Soto', imei: '111', idOrden: 'TF-251002-001' }),
                b: equipo({ cliente: 'Beto Lara', imei: '222', falla: 'No carga', idOrden: 'TF-251002-002' })
            }
        });
        const buscador = document.getElementById('buscador');

        for (const [aguja, esperado] of [['222', 'Beto Lara'], ['TF-251002-001', 'Ana Soto'], ['no carga', 'Beto Lara']]) {
            buscador.value = aguja;
            buscador.dispatchEvent(new document.defaultView.Event('input'));
            await tick(400);
            const texto = document.getElementById('lista-proyectos').textContent;
            assert.ok(texto.includes(esperado), `"${aguja}" deberia encontrar a ${esperado}`);
            assert.equal(texto.includes(esperado === 'Ana Soto' ? 'Beto Lara' : 'Ana Soto'), false, `"${aguja}" no debe mostrar el otro equipo`);
        }
    });
});
