/**
 * Prioridades del taller: la lógica que responde "¿qué ataco hoy?".
 *
 * Son funciones puras: no tocan red ni DOM. Se prueban por separado para que un
 * error aquí no pueda cobrar dinero ni esconder órdenes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const FUENTE = readFileSync(new URL('../app/taller-prioridades.js', import.meta.url), 'utf8');
const P = (() => {
    const ventana = {};
    runInNewContext(FUENTE, { window: ventana });
    return ventana.KryoFixTallerPrioridades;
})();

const DIA = 86400000;
const AHORA = 1800000000000;
const hace = (d) => AHORA - d * DIA;


// ---------------------------------------------------------------------------
// Búsqueda dentro de la ficha
// ---------------------------------------------------------------------------

test('la búsqueda alcanza diagnóstico, notas y presupuesto, no solo la tarjeta', () => {
    const orden = {
        cliente: 'María González', equipo: 'Apple', modelo: 'iPhone 13',
        notas: 'el cliente dijo que se mojo',
        diagnostico: { hipotesis: 'no carga el connector', variante: 'A2633' },
        presupuesto: { condiciones: 'no cubredamage por liquidación' }
    };
    const texto = P.textoBuscable(orden);
    assert.match(texto, /no carga/, 'debe encontrar texto del diagnóstico');
    assert.match(texto, /a2633/, 'debe encontrar la variante exacta');
    assert.match(texto, /liquidacion/, 'debe encontrar las condiciones del presupuesto');
});

test('la búsqueda ignora tildes, mayúsculas y acentos en las notas', () => {
    const orden = { cliente: 'Ana', notas: 'El equipo quedó con CAÍDA de pantalla y se mojó' };
    const texto = P.textoBuscable(orden);
    for (const t of P.terminos('caida')) assert.ok(texto.includes(t), 'debe encontrar "caida" sin tilde');
    for (const t of P.terminos('mojo')) assert.ok(texto.includes(t), 'debe encontrar "mojo" sin tilde');
});

test('varios términos deben cumplirse todos, en cualquier orden', () => {
    const orden = { cliente: 'Juan Pérez', equipo: 'Samsung', modelo: 'Galaxy S21' };
    assert.ok(P.coincide(orden, P.terminos('juan samsung')));
    assert.ok(P.coincide(orden, P.terminos('samsung juan')));
    assert.ok(!P.coincide(orden, P.terminos('juan xiaomi')));
});

test('el presupuesto y los eventos anidados se aplanan sin romperse', () => {
    const orden = {
        cliente: 'Luis', estado: 'reparado',
        presupuesto: { lineas: [{ concepto: 'Cambio de pantalla', precio: 45000 }], total: 45000 },
        eventos: [{ resumen: 'Pago recibido: 20000 CLP', en: {} }]
    };
    const texto = P.textoBuscable(orden);
    assert.match(texto, /cambio de pantalla/, 'leer el concepto de la línea del presupuesto');
    assert.match(texto, /pago recibido/, 'debe leer el resumen del evento');
});

test('un objeto con ciclo o sin campos utilizables no rompe la búsqueda', () => {
    const orden = { cliente: 'Ana', diagnostico: {}, procedimiento: [], notas: null };
    assert.doesNotThrow(() => P.textoBuscable(orden));
    assert.equal(typeof P.textoBuscable(orden), 'string');
});

// ---------------------------------------------------------------------------
// Prioridades del día
// ---------------------------------------------------------------------------

test('el saldo de un equipo ya entregado es lo más urgente', () => {
    const puntos = P.prioridades([        { cliente: 'Ana', estado: 'entregado', costo: 50000, abono: 20000, idOrden: 'KRF-1', fechaEntrega: hace(40) }], { ahora: AHORA });
    assert.equal(puntos[0].clave, 'cobro');
    assert.equal(puntos[0].urgente, true, 'debe ir primero: es dinero que ya no está en el taller');
    assert.match(puntos[0].detalle[0], /\$30\.000/);
});

test('los equipos listos hace mucho se avisan para chamar al cliente', () => {
    const puntos = P.prioridades([        { cliente: 'Luis', estado: 'reparado', costo: 0, abono: 0, fechaReparacion: hace(45) }], { ahora: AHORA });
    const retiro = puntos.find((x) => x.clave === 'retiro');
    assert.ok(retiro, 'debe avisar de la espera');
    assert.match(retiro.detalle[0], /45 días/);
});

test('un presupuesto aprobado no aparece dos veces', () => {
    const puntos = P.prioridades([        { cliente: 'Pedro', estado: 'reparado', costo: 32000, abono: 0, fechaReparacion: hace(2), presupuesto: { autorizacion: { estado: 'aprobado' } } }], { ahora: AHORA });
    const apariciones = puntos.filter((x) => x.detalle.some((d) => d.includes('Pedro'))).length;
    assert.equal(apariciones, 1, 'la misma orden no debe cobrarse en dos listas');
    assert.ok(puntos.some((x) => x.clave === 'cobrar-aprobado'));
});

test('una garantía vencida genera su propio aviso con los días', () => {
    const puntos = P.prioridades([        { cliente: 'María', estado: 'entregado', costo: 0, abono: 0, fechaEntrega: hace(40), garantia: { estado: 'abierta', en: hace(35) } }], { ahora: AHORA });
    const g = puntos.find((x) => x.clave === 'garantia');
    assert.ok(g, 'debe avisar de la garantía');
    assert.match(g.detalle[0], /35 días/);
});

test('una garantía ya cerrada no genera aviso', () => {
    const puntos = P.prioridades([        { cliente: 'María', estado: 'entregado', costo: 0, abono: 0, fechaEntrega: hace(90), garantia: { estado: 'cerrada', en: hace(85) } }], { ahora: AHORA });
    assert.equal(puntos.find((x) => x.clave === 'garantia'), undefined);
});

test('una orden sin problemas no aparece en ninguna prioridad', () => {
    const puntos = P.prioridades([        { cliente: 'Tranquila', estado: 'ingresado', costo: 0, abono: 0, timestamp: hace(1) }], { ahora: AHORA });
    assert.equal(puntos.length, 0, 'una orden sin nada pendiente no genera trabajo falso');
});

test('la lista no crece sin límite al mostrar el detalle', () => {
    const muchas = Array.from({ length: 50 }, (_, i) => ({
        cliente: 'C' + i, estado: 'entregado', costo: 1000, abono: 0, fechaEntrega: hace(5)
    }));
    const puntos = P.prioridades(muchas, { ahora: AHORA });
    assert.equal(puntos[0].cuenta, 50, 'el conteo real sí se conserva');
    assert.ok(puntos[0].detalle.length <= 6, 'el detalle visible se acota');
});

// ---------------------------------------------------------------------------
// Clientes duplicados
// ---------------------------------------------------------------------------

test('detecta el mismo teléfono escrito con y sin prefijo', () => {
    const grupos = P.duplicados([
        { id: 'a', nombre: 'Juan Pérez', telefono: '56911112222' },
        { id: 'b', nombre: 'J. Perez', telefono: '+56 9 1111 2222' }
    ]);
    assert.equal(grupos.length, 1);
    assert.equal(grupos[0].motivo, 'mismo teléfono');
});

test('detecta nombres parecidos aunque el teléfono sea distinto', () => {
    const grupos = P.duplicados([
        { id: 'a', nombre: 'María González', telefono: '56911112222' },
        { id: 'b', nombre: 'Maria Gonzalez', telefono: '56999999999' }
    ]);
    assert.equal(grupos.length, 1, 'tildes y mayúsculas no deben impedir el cruce');
    assert.equal(grupos[0].motivo, 'nombre muy parecido');
});

test('no fusiona homónimos distintos ni clientes sin nada en común', () => {
    const grupos = P.duplicados([
        { id: 'a', nombre: 'Juan Pérez', telefono: '56911112222' },
        { id: 'b', nombre: 'Pedro Soto', telefono: '56922223333' },
        { id: 'c', nombre: 'Ana Ruiz', telefono: '56933334444' }
    ]);
    assert.equal(grupos.length, 0, 'sin similitud no se propone nada: ' + JSON.stringify(grupos));
});

test('un teléfono incompleto no fuerza un cruce', () => {
    assert.equal(P.mismoTelefono({ telefono: '5691' }, { telefono: '5691' }), false);
});

// ---------------------------------------------------------------------------
// Clientes frecuentes
// ---------------------------------------------------------------------------

test('los clientes frecuentes priorizan a quien vuelve recientemente', () => {
    const lista = P.frecuentes([
        { nombre: 'Antiguo', ordenes: 9, actualizado: hace(400) },
        { nombre: 'Reciente', ordenes: 1, actualizado: hace(2) }
    ], { ahora: AHORA });
    assert.equal(lista[0].nombre, 'Reciente', 'un cliente de hace 400 días no es frecuente hoy');
});

test('dentro de los activos manda quien más visita', () => {
    const lista = P.frecuentes([
        { nombre: 'Una vez', ordenes: 1, actualizado: hace(5) },
        { nombre: 'Cinco veces', ordenes: 5, actualizado: hace(10) }
    ], { ahora: AHORA });
    assert.equal(lista[0].nombre, 'Cinco veces');
});

test('no propone clientes sin nombre', () => {
    assert.equal(P.frecuentes([{ telefono: '569' }]).length, 0, 'un cliente sin nombre no se propone');
});
// ---------------------------------------------------------------------------
// Rendimiento y datosolation
// ---------------------------------------------------------------------------

test('textoBuscable no explota con documentos anidados profundos', () => {
    let profundo = { texto: 'hoja' };
    for (let i = 0; i < 30; i++) profundo = { nivel: profundo };
    const inicio = Date.now();
    P.textoBuscable({ cliente: 'Ana', procedimiento: profundo, eventos: profundo });
    assert.ok(Date.now() - inicio < 200, 'la búsqueda no debe bloquear la interfaz');
});

test('textoBuscable sobrevive a un ciclo de referencias', () => {
    const a = { cliente: 'Ana' };
    a.siMismo = a;
    assert.doesNotThrow(() => P.textoBuscable(a));
});
