/* Banco de pruebas visual: reproduce las tarjetas que genera app.js con datos
   ficticios, para comprobar que todas las clases tienen estilo definido. */
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
    { cliente: 'Juan Perez', equipo: 'Apple', modelo: 'iPhone 13', imei: '354890123456789', pin: '1234', falla: 'Cambio de pantalla - trizada', accesorios: 'Trae funda y cargador', costo: 85000, abono: 30000, estado: 'ingresado' },
    { cliente: 'Maria Gonzalez', equipo: 'Samsung', modelo: 'Galaxy S22', falla: 'No carga', costo: 45000, abono: 0, estado: 'revision' },
    { cliente: 'Pedro Soto', equipo: 'Xiaomi', modelo: 'Redmi Note 12', falla: 'Cambio de bateria', costo: 32000, abono: 32000, estado: 'repuesto' },
    { cliente: 'Ana Lara', equipo: 'Motorola', modelo: 'Moto G54', falla: 'Reemplazo de puerto de carga', costo: 28000, abono: 10000, estado: 'reparado' },
    { cliente: 'Luis Rojas', equipo: 'Huawei', modelo: 'P40 Lite', falla: 'Mojado, limpieza de placa', costo: 55000, abono: 55000, estado: 'entregado' }
];

const cont = document.getElementById('demo');

for (const p of DEMO) {
    const saldo = p.costo - p.abono;
    const art = document.createElement('article');
    art.className = 'tarjeta-proyecto' + (p.estado === 'entregado' ? ' entregado-style' : '');
    art.innerHTML =
        '<div class="tarjeta-header">' +
        `<span class="badge-estado estado-${p.estado}">${TEXTO[p.estado]}</span>` +
        '<span class="tarjeta-fecha">02-10-2025</span></div>' +
        `<h3>${p.cliente}</h3><p>${p.equipo} - ${p.modelo}</p>` +
        (p.imei ? `<p class="detalle-extra">IMEI: ${p.imei}</p>` : '') +
        (p.pin ? '<p class="detalle-extra fila-pin"><span>PIN: ●●●●</span><button type="button" class="btn-mini">Ver</button></p>' : '') +
        `<p>Falla: ${p.falla}</p>` +
        (p.accesorios ? `<p class="detalle-extra">${p.accesorios}</p>` : '') +
        `<p class="precio">Costo: ${CLP(p.costo)}<br><span class="detalle-extra">Abono: ${CLP(p.abono)} | Saldo: ${CLP(saldo)}</span></p>` +
        '<div class="acciones-tarjeta">' +
        `<select class="select-estado-rapido estado-${p.estado}">${ESTADOS.map((e) => `<option${e === p.estado ? ' selected' : ''}>${TEXTO[e]}</option>`).join('')}</select>` +
        '<button type="button" class="btn-icon btn-whatsapp">💬 WhatsApp</button>' +
        '<button type="button" class="btn-icon btn-imprimir">🧾 Ticket</button>' +
        (p.estado !== 'entregado' ? '<button type="button" class="btn-icon btn-entregar">✅ Entregar con firma</button>' : '') +
        '<button type="button" class="btn-icon btn-eliminar">🗑 Borrar</button>' +
        '</div>';
    cont.appendChild(art);
}

document.getElementById('toggle-tema').addEventListener('click', () => {
    const actual = document.documentElement.getAttribute('data-theme');
    document.documentElement.setAttribute('data-theme', actual === 'dark' ? 'light' : 'dark');
});
