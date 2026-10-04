/* Banco de pruebas visual: reproduce las tarjetas que genera app.js con datos
   ficticios, para comprobar que todas las clases tienen estilo definido.
   No se despliega (firebase.json solo publica app/). */
/* global document */

const ESTADOS = ['ingresado', 'revision', 'repuesto', 'reparado', 'entregado'];
const TEXTO = {
    ingresado: 'Ingresado',
    revision: 'En Revision',
    repuesto: 'Esperando Repuesto',
    reparado: 'Listo para Entregar',
    entregado: 'Entregado'
};
const CLP = (v) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(v || 0);

const DEMO = [
    { cliente: 'Juan Perez', equipo: 'Apple', modelo: 'iPhone 13', idOrden: 'TF-251002-001', imei: '354890123456789', pin: '1234', falla: 'Cambio de pantalla - trizada', accesorios: 'Trae funda y cargador', costo: 85000, abono: 30000, estado: 'ingresado' },
    { cliente: 'Maria Gonzalez', equipo: 'Samsung', modelo: 'Galaxy S22', idOrden: 'TF-251002-002', falla: 'No carga, revision de placa', costo: 45000, abono: 0, estado: 'revision' },
    { cliente: 'Pedro Soto', equipo: 'Xiaomi', modelo: 'Redmi Note 12', idOrden: 'TF-251002-003', falla: 'Cambio de bateria original', costo: 32000, abono: 32000, estado: 'repuesto' },
    { cliente: 'Ana Lara', equipo: 'Motorola', modelo: 'Moto G54', idOrden: 'TF-251002-004', falla: 'Reemplazo de puerto de carga', costo: 28000, abono: 10000, estado: 'reparado', diasEspera: 34 },
    { cliente: 'Luis Rojas', equipo: 'Huawei', modelo: 'P40 Lite', idOrden: 'TF-251002-005', falla: 'Mojado, limpieza ultrasonica', costo: 55000, abono: 55000, estado: 'entregado' }
];

const cont = document.getElementById('demo');

/** Equivalente simplificado de construirTarjeta() de app.js (solo pintado). */
function pintarTarjeta(p) {
    const saldo = p.costo - p.abono;
    const art = document.createElement('article');
    art.className = 'tarjeta-proyecto' + (p.estado === 'entregado' ? ' entregado-style' : '');

    const encabezado = document.createElement('div');
    encabezado.className = 'tarjeta-header';
    encabezado.innerHTML =
        `<span class="badge-estado estado-${p.estado}">${TEXTO[p.estado]}</span>` +
        '<span class="tarjeta-fecha">02-10-2025</span>';
    art.appendChild(encabezado);

    if (p.diasEspera) {
        const espera = document.createElement('span');
        espera.className = 'badge-espera';
        espera.textContent = `⏱ En taller hace ${p.diasEspera} dias`;
        art.appendChild(espera);
    }

    const cuerpo = document.createElement('div');
    cuerpo.innerHTML =
        `<h3>${p.cliente}</h3><p class="tarjeta-dispositivo">${p.equipo} - ${p.modelo}</p>` +
        `<p class="detalle-extra orden-chip">Orden: ${p.idOrden}</p>` +
        (p.imei ? `<p class="detalle-extra">IMEI: ${p.imei}</p>` : '') +
        (p.pin ? '<p class="detalle-extra fila-pin"><span>PIN: ●●●●</span><button type="button" class="btn-mini">Ver</button></p>' : '') +
        `<p class="tarjeta-falla">Falla: ${p.falla}</p>` +
        (p.accesorios ? `<p class="detalle-extra">${p.accesorios}</p>` : '') +
        `<p class="precio">Costo: ${CLP(p.costo)}<br><span class="detalle-extra">Abono: ${CLP(p.abono)} | Saldo: ${CLP(saldo)}</span></p>`;
    art.appendChild(cuerpo);

    const acciones = document.createElement('div');
    acciones.className = 'acciones-tarjeta';
    acciones.innerHTML =
        `<select class="select-estado-rapido estado-${p.estado}" aria-label="Cambiar estado">` +
        ESTADOS.map((e) => `<option${e === p.estado ? ' selected' : ''}>${TEXTO[e]}</option>`).join('') +
        '</select>' +
        '<button type="button" class="btn-icon btn-whatsapp">💬 WhatsApp</button>' +
        '<button type="button" class="btn-icon btn-imprimir">🧾 Ticket</button>' +
        '<button type="button" class="btn-icon btn-compartir">📤 Compartir</button>' +
        '<button type="button" class="btn-icon btn-editar">✏️ Editar</button>' +
        '<button type="button" class="btn-icon btn-historial">🕒 Historial</button>' +
        (p.estado !== 'entregado' ? '<button type="button" class="btn-icon btn-entregar">✅ Entregar con firma</button>' : '') +
        '<button type="button" class="btn-icon btn-eliminar">🗑 Borrar</button>';
    art.appendChild(acciones);
    return art;
}

for (const p of DEMO) cont.appendChild(pintarTarjeta(p));

// Aviso de equipos sin retirar, tal como lo genera app.js
const aviso = document.getElementById('aviso-demo');
aviso.className = 'aviso-bloque';
aviso.hidden = false;
aviso.innerHTML =
    '<span class="aviso-titulo">⚠ 1 equipo(s) listo(s) hace mas de 30 dias esperando al cliente</span>' +
    '<p class="detalle-extra">Clientes: Ana Lara</p>' +
    '<button type="button" class="btn-icon">Ver listos para entregar</button>';

document.getElementById('toggle-tema').addEventListener('click', () => {
    const actual = document.documentElement.getAttribute('data-theme');
    document.documentElement.setAttribute('data-theme', actual === 'dark' ? 'light' : 'dark');
});
