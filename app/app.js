/* =============================================================================
 * TechFix Tracker Pro
 * Gestion de ordenes de reparacion (Firebase Auth + Firestore, sin bundler).
 *
 * Modelo de datos:
 *   equipos/{id}      datos privados de la orden. Solo el tecnico dueno.
 *   catalogo/{id}     precios del tecnico. Solo el tecnico dueno.
 *   seguimiento/{id}  espejo PUBLICO minimo (estado + modelo) para el QR.
 * ========================================================================== */

// ========================
// CONFIGURACION DE FIREBASE
// (la apiKey web no es un secreto: la proteccion real son firestore.rules)
// ========================
const firebaseConfig = {
    apiKey: 'AIzaSyC5hHgmyDXEWmzKzHRoywJk__iHgRcJ8F8',
    authDomain: 'techfix-tracker-9a128.firebaseapp.com',
    projectId: 'techfix-tracker-9a128',
    storageBucket: 'techfix-tracker-9a128.firebasestorage.app',
    messagingSenderId: '434780023940',
    appId: '1:434780023940:web:e595dc76ac51d865a7a6d1'
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

const COL_EQUIPOS = 'equipos';
const COL_CATALOGO = 'catalogo';
const COL_SEGUIMIENTO = 'seguimiento';
const LIMITE_EQUIPOS = 500;

let persistenciaActiva = false;
db.enablePersistence()
    .then(() => {
        persistenciaActiva = true;
    })
    .catch((err) => console.warn('Persistencia offline no disponible:', err && err.code));

// ========================
// REFERENCIAS AL DOM
// ========================
const $ = (id) => document.getElementById(id);

const loginScreen = $('login-screen');
const appContent = $('app-content');
const loginForm = $('login-form');
const btnLogout = $('btn-logout');
const btnTheme = $('btn-theme');
const userEmailDisplay = $('user-email-display');
const form = $('proyecto-form');
const listaProyectos = $('lista-proyectos');
const buscador = $('buscador');
const filtroEstado = $('filtro-estado');
const ticketImpresion = $('ticket-impresion');
const loader = $('loader');
const statActivos = $('stat-activos');
const statReparados = $('stat-reparados');
const statIngresos = $('stat-ingresos');
const modalFirma = $('modal-firma');
const canvas = $('canvas-firma');
const ctx = canvas ? canvas.getContext('2d') : null;

let proyectos = [];
let catalogoDB = [];
let unsubscribeDB = null;
let unsubscribeCatalogo = null;
let currentUser = null;
let currentFirmaId = null;
let fotoComprimidaBase64 = null;
let firmaTieneTrazos = false;
let ultimoFoco = null;
const pinesVisibles = new Set();

const ESTADOS = ['ingresado', 'revision', 'repuesto', 'reparado', 'entregado'];
const ESTADO_TEXTO = {
    ingresado: 'Ingresado',
    revision: 'En Revision',
    repuesto: 'Esperando Repuesto',
    reparado: 'Listo para Entregar',
    entregado: 'Entregado'
};

// ========================
// UTILIDADES
// ========================

/** Escapa texto para interpolarlo en HTML, incluidas comillas (atributos). */
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const CLP = (v) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(Number(v) || 0);

/** Deja solo digitos; descarta prefijos "+" y separadores para usar en wa.me. */
function normalizarTelefono(valor) {
    return String(valor || '').replace(/\D+/g, '');
}

/** URL publica de seguimiento basada en el origen actual (no hardcodeada). */
function urlSeguimiento(id) {
    return new URL('status.html?id=' + encodeURIComponent(id), window.location.href).toString();
}

function toast(icon, title) {
    Swal.fire({ toast: true, position: 'top-end', icon, title, showConfirmButton: false, timer: 2500 });
}

function avisarError(titulo, err) {
    if (err) console.error(titulo, err);
    const esPermiso = err && (err.code === 'permission-denied' || /permission/i.test(err.message || ''));
    Swal.fire(
        titulo,
        esPermiso
            ? 'No tienes permiso para esta operacion. Revisa firestore.rules.'
            : 'Ocurrio un problema. Revisa tu conexion e intentalo de nuevo.',
        'error'
    );
}

function debounce(fn, ms) {
    let t = null;
    return (...args) => {
        if (t) clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
}

/** Crea un elemento con clase/texto/atributos en una sola llamada. */
function el(tag, opciones = {}, hijos = []) {
    const nodo = document.createElement(tag);
    if (opciones.class) nodo.className = opciones.class;
    if (opciones.text !== undefined) nodo.textContent = opciones.text;
    if (opciones.html !== undefined) nodo.innerHTML = opciones.html;
    for (const [k, v] of Object.entries(opciones.attrs || {})) {
        if (v !== null && v !== undefined && v !== false) nodo.setAttribute(k, String(v));
    }
    for (const h of hijos) if (h) nodo.appendChild(h);
    return nodo;
}

/** Datos minimos y NO sensibles que se publican para el QR. */
function documentoSeguimiento(uid, estado, modelo) {
    return {
        uid,
        estado,
        modelo: String(modelo || '').slice(0, 80),
        actualizado: Date.now()
    };
}

// ========================
// 1. TEMA
// (el valor inicial ya lo aplica un script en <head> para evitar el destello)
// ========================
function etiquetaTema(tema) {
    return tema === 'dark' ? '☀️ Modo Claro' : '🌙 Modo Oscuro';
}

if (btnTheme) {
    const temaInicial = document.documentElement.getAttribute('data-theme');
    btnTheme.textContent = etiquetaTema(temaInicial);
    btnTheme.setAttribute('aria-pressed', String(temaInicial === 'dark'));
    btnTheme.addEventListener('click', () => {
        const nuevo = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', nuevo);
        try {
            localStorage.setItem('theme', nuevo);
        } catch (_e) {
            /* modo privado */
        }
        btnTheme.textContent = etiquetaTema(nuevo);
        btnTheme.setAttribute('aria-pressed', String(nuevo === 'dark'));
    });
}

// ========================
// 2. AUTENTICACION
// ========================
function cancelarSuscripciones() {
    if (unsubscribeDB) {
        unsubscribeDB();
        unsubscribeDB = null;
    }
    if (unsubscribeCatalogo) {
        unsubscribeCatalogo();
        unsubscribeCatalogo = null;
    }
}

auth.onAuthStateChanged((user) => {
    // Siempre se parte de cero: evita listeners duplicados si el callback se
    // dispara mas de una vez (refresco de token, reconexion, etc.).
    cancelarSuscripciones();

    if (user) {
        const mismoUsuario = currentUser && currentUser.uid === user.uid;
        currentUser = user;
        loginScreen.style.display = 'none';
        appContent.style.display = 'block';
        if (userEmailDisplay) userEmailDisplay.textContent = user.email;
        cargarDatos();
        cargarCatalogo();
        if (!mismoUsuario) toast('success', 'Bienvenido!');
    } else {
        currentUser = null;
        proyectos = [];
        catalogoDB = [];
        pinesVisibles.clear();
        loginScreen.style.display = 'flex';
        appContent.style.display = 'none';
        if (listaProyectos) listaProyectos.innerHTML = '';
    }
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('login-email').value.trim();
    const pass = $('login-password').value;
    const btn = loginForm.querySelector('button[type="submit"]');
    const etiqueta = btn.textContent;
    btn.textContent = 'Ingresando...';
    btn.disabled = true;
    try {
        await auth.signInWithEmailAndPassword(email, pass);
        loginForm.reset();
    } catch (error) {
        const mensajes = {
            'auth/too-many-requests': 'Demasiados intentos fallidos. Espera unos minutos.',
            'auth/network-request-failed': 'Sin conexion con el servidor de autenticacion.',
            'auth/invalid-email': 'El correo no tiene un formato valido.'
        };
        // Para credenciales erroneas se usa un mensaje generico a proposito:
        // no se revela si el correo existe o no (enumeracion de usuarios).
        Swal.fire('Error de Acceso', mensajes[error.code] || 'Credenciales incorrectas.', 'error');
    } finally {
        btn.textContent = etiqueta;
        btn.disabled = false;
    }
});

btnLogout.addEventListener('click', async () => {
    try {
        cancelarSuscripciones();
        await auth.signOut();
        proyectos = [];
        catalogoDB = [];
        pinesVisibles.clear();
        if (listaProyectos) listaProyectos.innerHTML = '';
        statActivos.textContent = '0';
        statReparados.textContent = '0';
        statIngresos.textContent = CLP(0);

        // Privacidad: la cache offline de Firestore guarda las ordenes en el
        // dispositivo. Al cerrar sesion se borra para que el siguiente usuario
        // del equipo no pueda leerlas.
        if (persistenciaActiva && db.terminate && db.clearPersistence) {
            await db.terminate();
            await db.clearPersistence();
            persistenciaActiva = false;
            if (window.location && typeof window.location.reload === 'function') window.location.reload();
        }
    } catch (err) {
        console.warn('Cierre de sesion:', err);
    }
});

// ========================
// 3. BASE DE DATOS
// ========================
function cargarDatos() {
    if (!currentUser) return;
    loader.style.display = 'block';

    // El filtro por uid va en el SERVIDOR. Filtrar en el cliente (como antes)
    // descargaba datos de otros tecnicos y, con limit(500), podia dejar fuera
    // los equipos propios.
    unsubscribeDB = db
        .collection(COL_EQUIPOS)
        .where('uid', '==', currentUser.uid)
        .orderBy('timestamp', 'desc')
        .limit(LIMITE_EQUIPOS)
        .onSnapshot(
            (snapshot) => {
                proyectos = [];
                snapshot.forEach((doc) => proyectos.push({ id: doc.id, ...doc.data() }));
                loader.style.display = 'none';
                renderizarProyectos();
                actualizarDashboard();
            },
            (error) => {
                loader.style.display = 'none';
                if (error && error.code === 'failed-precondition') {
                    Swal.fire(
                        'Falta un indice',
                        'Firestore necesita el indice compuesto (uid + timestamp). Ejecuta: firebase deploy --only firestore:indexes',
                        'error'
                    );
                } else {
                    avisarError('Error al cargar los equipos', error);
                }
            }
        );
}

/** Momento en que el equipo quedo reparado (con respaldo a la fecha de ingreso). */
function fechaDeCierre(p) {
    return Number(p.fechaReparacion || p.timestamp || 0);
}

function actualizarDashboard() {
    const ahora = new Date();
    const mes = ahora.getMonth();
    const anio = ahora.getFullYear();

    const cerradosEsteMes = proyectos.filter((p) => {
        if (p.estado !== 'reparado' && p.estado !== 'entregado') return false;
        const f = new Date(fechaDeCierre(p));
        return f.getMonth() === mes && f.getFullYear() === anio;
    });

    statActivos.textContent = String(proyectos.filter((p) => p.estado !== 'entregado').length);
    statReparados.textContent = String(cerradosEsteMes.length);
    statIngresos.textContent = CLP(cerradosEsteMes.reduce((sum, p) => sum + (Number(p.costo) || 0), 0));
}

function construirTarjeta(p) {
    const saldo = (Number(p.costo) || 0) - (Number(p.abono) || 0);
    const tarjeta = el('article', {
        class: 'tarjeta-proyecto' + (p.estado === 'entregado' ? ' entregado-style' : ''),
        attrs: { 'data-id': p.id }
    });

    tarjeta.appendChild(
        el('div', { class: 'tarjeta-header' }, [
            el('span', {
                class: 'badge-estado estado-' + (ESTADOS.includes(p.estado) ? p.estado : 'ingresado'),
                text: ESTADO_TEXTO[p.estado] || p.estado || 'Sin estado'
            }),
            el('span', { class: 'tarjeta-fecha', text: p.fecha || '' })
        ])
    );

    tarjeta.appendChild(el('h3', { text: p.cliente || 'Sin nombre' }));
    tarjeta.appendChild(el('p', { text: [p.equipo, p.modelo].filter(Boolean).join(' - ') }));
    if (p.imei) tarjeta.appendChild(el('p', { class: 'detalle-extra', text: 'IMEI: ' + p.imei }));

    if (p.pin) {
        const visible = pinesVisibles.has(p.id);
        const fila = el('p', { class: 'detalle-extra fila-pin' }, [
            // Mascara de largo fijo: no revela cuantos digitos tiene el PIN.
            el('span', { text: 'PIN: ' + (visible ? p.pin : '●●●●') })
        ]);
        fila.appendChild(
            el('button', {
                class: 'btn-mini',
                text: visible ? 'Ocultar' : 'Ver',
                attrs: { type: 'button', 'data-accion': 'pin', 'data-id': p.id, 'aria-label': 'Mostrar u ocultar el PIN' }
            })
        );
        tarjeta.appendChild(fila);
    }

    tarjeta.appendChild(el('p', { text: 'Falla: ' + (p.falla || 'Sin detalle') }));
    if (p.accesorios) tarjeta.appendChild(el('p', { class: 'detalle-extra', text: p.accesorios }));

    const precio = el('p', { class: 'precio', text: 'Costo: ' + CLP(p.costo) });
    precio.appendChild(el('br'));
    precio.appendChild(
        el('span', { class: 'detalle-extra', text: 'Abono: ' + CLP(p.abono) + ' | Saldo: ' + CLP(saldo) })
    );
    tarjeta.appendChild(precio);

    if (p.evidencia) {
        const img = el('img', {
            class: 'miniatura-evidencia',
            attrs: { src: p.evidencia, alt: 'Evidencia fotografica de ' + (p.cliente || ''), 'data-accion': 'foto', 'data-id': p.id, loading: 'lazy' }
        });
        tarjeta.appendChild(el('div', { class: 'bloque-media' }, [img, el('p', { class: 'detalle-extra', text: 'Evidencia fotografica' })]));
    }
    if (p.firmaCliente) {
        const img = el('img', { class: 'firma-guardada', attrs: { src: p.firmaCliente, alt: 'Firma de conformidad', loading: 'lazy' } });
        tarjeta.appendChild(el('div', { class: 'bloque-media' }, [img, el('p', { class: 'detalle-extra', text: 'Firma de conformidad' })]));
    }

    const acciones = el('div', { class: 'acciones-tarjeta' });
    const select = el('select', {
        class: 'select-estado-rapido estado-' + (p.estado || 'ingresado'),
        attrs: { 'data-accion': 'estado', 'data-id': p.id, 'aria-label': 'Cambiar estado de ' + (p.cliente || 'el equipo') }
    });
    for (const est of ESTADOS) {
        if (est === 'entregado' && p.estado !== 'entregado') continue; // se entrega con firma
        const opt = el('option', { text: ESTADO_TEXTO[est], attrs: { value: est } });
        if (p.estado === est) opt.selected = true;
        select.appendChild(opt);
    }
    acciones.appendChild(select);
    acciones.appendChild(
        el('button', { class: 'btn-icon btn-whatsapp', text: '💬 WhatsApp', attrs: { type: 'button', 'data-accion': 'wa', 'data-id': p.id } })
    );
    acciones.appendChild(
        el('button', { class: 'btn-icon btn-imprimir', text: '🧾 Ticket', attrs: { type: 'button', 'data-accion': 'ticket', 'data-id': p.id } })
    );
    if (p.estado !== 'entregado') {
        acciones.appendChild(
            el('button', { class: 'btn-icon btn-entregar', text: '✅ Entregar con firma', attrs: { type: 'button', 'data-accion': 'entregar', 'data-id': p.id } })
        );
    }
    acciones.appendChild(
        el('button', { class: 'btn-icon btn-eliminar', text: '🗑 Borrar', attrs: { type: 'button', 'data-accion': 'borrar', 'data-id': p.id } })
    );
    tarjeta.appendChild(acciones);
    return tarjeta;
}

function renderizarProyectos() {
    if (!listaProyectos) return;
    const txt = (buscador.value || '').trim().toLowerCase();
    const filtro = filtroEstado.value;

    const filtrados = proyectos.filter((p) => {
        const campos = [p.cliente, p.equipo, p.modelo, p.falla, p.imei, p.accesorios, p.telefono]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
        if (txt && !campos.includes(txt)) return false;
        if (filtro === 'activos') return p.estado !== 'entregado';
        if (filtro !== 'todos') return p.estado === filtro;
        return true;
    });

    listaProyectos.innerHTML = '';
    if (filtrados.length === 0) {
        listaProyectos.appendChild(
            el('p', { class: 'sin-resultados', text: txt ? 'Ningun equipo coincide con la busqueda.' : 'No hay equipos registrados.' })
        );
        return;
    }

    // Un solo reflow: se arma todo en memoria y se inserta de una vez.
    const frag = document.createDocumentFragment();
    filtrados.forEach((p) => frag.appendChild(construirTarjeta(p)));
    listaProyectos.appendChild(frag);
}

// Delegacion de eventos: sin onclick inline, compatible con CSP estricta y a
// prueba de comillas en los datos.
if (listaProyectos) {
    listaProyectos.addEventListener('click', (e) => {
        const destino = e.target.closest('[data-accion]');
        if (!destino) return;
        const id = destino.getAttribute('data-id');
        switch (destino.getAttribute('data-accion')) {
            case 'wa':
                enviarWhatsApp(id);
                break;
            case 'ticket':
                imprimirBoleta(id);
                break;
            case 'entregar':
                archivarProyecto(id);
                break;
            case 'borrar':
                eliminarProyectoPermanente(id);
                break;
            case 'pin':
                revelarPin(id);
                break;
            case 'foto':
                verFoto(id);
                break;
        }
    });
    listaProyectos.addEventListener('change', (e) => {
        const destino = e.target.closest('[data-accion="estado"]');
        if (destino) cambiarEstado(destino.getAttribute('data-id'), destino.value);
    });
}

// ========================
// 4. FOTOGRAFIA DE EVIDENCIA
// ========================
const MAX_FOTO_BYTES = 700 * 1024; // margen bajo el limite de 1 MiB por documento

$('foto-evidencia').addEventListener('change', function (e) {
    const file = e.target.files && e.target.files[0];
    const preview = $('preview-foto');
    if (!file) {
        fotoComprimidaBase64 = null;
        preview.style.display = 'none';
        return;
    }
    if (!/^image\//.test(file.type)) {
        Swal.fire('Archivo invalido', 'Selecciona una imagen.', 'warning');
        e.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onerror = () => Swal.fire('Error', 'No se pudo leer la imagen.', 'error');
    reader.onload = function (ev) {
        const img = new Image();
        img.onerror = () => Swal.fire('Error', 'El archivo no es una imagen valida.', 'error');
        img.onload = function () {
            const max = 600;
            let w = img.width;
            let h = img.height;
            if (w > h) {
                if (w > max) {
                    h = Math.round(h * (max / w));
                    w = max;
                }
            } else if (h > max) {
                w = Math.round(w * (max / h));
                h = max;
            }
            const c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);

            let calidad = 0.5;
            let dataUrl = c.toDataURL('image/jpeg', calidad);
            while (dataUrl.length > MAX_FOTO_BYTES && calidad > 0.2) {
                calidad -= 0.1;
                dataUrl = c.toDataURL('image/jpeg', calidad);
            }
            if (dataUrl.length > MAX_FOTO_BYTES) {
                Swal.fire('Imagen muy pesada', 'No se pudo comprimir lo suficiente. Prueba con otra foto.', 'warning');
                e.target.value = '';
                fotoComprimidaBase64 = null;
                preview.style.display = 'none';
                return;
            }
            fotoComprimidaBase64 = dataUrl;
            $('img-evidencia-preview').src = dataUrl;
            preview.style.display = 'block';
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
});

function verFoto(id) {
    const p = proyectos.find((x) => x.id === id);
    if (p && p.evidencia) Swal.fire({ imageUrl: p.evidencia, imageAlt: 'Evidencia', width: '90%', padding: 0 });
}

function revelarPin(id) {
    if (pinesVisibles.has(id)) pinesVisibles.delete(id);
    else pinesVisibles.add(id);
    renderizarProyectos();
}

// ========================
// 5. FORMULARIO DE NUEVO INGRESO
// ========================
function valorMarca() {
    const sel = $('marca').value;
    return sel === 'Otro' ? $('marca-otro').value.trim() : sel;
}
function valorModelo() {
    const sel = $('modelo');
    if (sel.disabled || sel.value === 'Otro') return $('modelo-otro').value.trim();
    return sel.value;
}

function reiniciarFormulario() {
    form.reset();
    fotoComprimidaBase64 = null;
    $('preview-foto').style.display = 'none';
    $('marca-otro').hidden = true;
    $('marca-otro').disabled = true;
    $('modelo-otro').hidden = true;
    $('modelo-otro').disabled = true;
    const modelo = $('modelo');
    modelo.hidden = false;
    modelo.innerHTML = '<option value="">-- Selecciona Marca Primero --</option>';
    modelo.disabled = true;
    const rep = $('tipo-reparacion');
    rep.innerHTML = '<option value="">-- Selecciona Modelo Primero --</option>';
    rep.disabled = true;
}

form.addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!currentUser) {
        Swal.fire('Sesion requerida', 'Inicia sesion primero.', 'error');
        return;
    }

    const cliente = $('cliente').value.trim();
    const telefono = normalizarTelefono($('telefono').value);
    const marca = valorMarca();
    const modelo = valorModelo();
    const costo = Number($('costo').value);
    const abono = Number($('abono').value || 0);

    // ---- Validaciones de negocio (antes solo existian en el navegador) ----
    if (!cliente) {
        Swal.fire('Falta el cliente', 'Escribe el nombre del cliente.', 'warning');
        return;
    }
    if (telefono.length < 8) {
        Swal.fire('Telefono invalido', 'Ingresa el numero con codigo de pais, solo digitos. Ej: 56912345678', 'warning');
        return;
    }
    if (!marca || !modelo) {
        Swal.fire('Falta el equipo', 'Indica marca y modelo del equipo.', 'warning');
        return;
    }
    if (!Number.isFinite(costo) || costo < 0) {
        Swal.fire('Costo invalido', 'El presupuesto no puede ser negativo.', 'warning');
        return;
    }
    if (!Number.isFinite(abono) || abono < 0) {
        Swal.fire('Abono invalido', 'El abono no puede ser negativo.', 'warning');
        return;
    }
    if (abono > costo) {
        Swal.fire('Abono invalido', 'El abono no puede superar el presupuesto total.', 'warning');
        return;
    }

    const selRep = $('tipo-reparacion');
    const repTxt = selRep.selectedIndex >= 0 && selRep.options[selRep.selectedIndex] ? selRep.options[selRep.selectedIndex].text : '';
    const detalle = $('falla').value.trim();
    const generico = ['-- Selecciona Reparacion --', '-- Selecciona Reparación --', 'Otra (precio manual)', '-- Selecciona Modelo Primero --', ''];
    const fallaFinal = !generico.includes(repTxt) ? repTxt + (detalle ? ' - ' + detalle : '') : detalle;
    const estado = $('estado').value;

    const nuevoProyecto = {
        uid: currentUser.uid,
        cliente,
        telefono,
        equipo: marca,
        modelo,
        imei: $('imei').value.trim(),
        pin: $('pin').value,
        accesorios: $('accesorios').value.trim(),
        falla: fallaFinal,
        estado,
        costo,
        abono,
        fecha: new Date().toLocaleDateString('es-CL'),
        timestamp: Date.now(),
        evidencia: fotoComprimidaBase64 || null
    };

    const btnSubmit = form.querySelector('button[type="submit"]');
    const etiqueta = btnSubmit.textContent;
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Guardando...';
    try {
        // Se reserva el id para que el espejo publico comparta la misma clave
        // y el QR del ticket apunte al documento correcto.
        const ref = db.collection(COL_EQUIPOS).doc();
        const lote = db.batch ? db.batch() : null;
        if (lote) {
            lote.set(ref, nuevoProyecto);
            lote.set(db.collection(COL_SEGUIMIENTO).doc(ref.id), documentoSeguimiento(currentUser.uid, estado, modelo));
            await lote.commit();
        } else {
            await ref.set(nuevoProyecto);
            await db.collection(COL_SEGUIMIENTO).doc(ref.id).set(documentoSeguimiento(currentUser.uid, estado, modelo));
        }

        reiniciarFormulario();
        if (filtroEstado.value === 'entregado') filtroEstado.value = 'activos';
        toast('success', 'Equipo guardado');
        if (listaProyectos.scrollIntoView) listaProyectos.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
        avisarError('No se pudo guardar el equipo', err);
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.textContent = etiqueta;
    }
});

// ========================
// 6. ACCIONES DE TARJETA
// ========================
async function cambiarEstado(id, nuevoEstado) {
    if (!ESTADOS.includes(nuevoEstado)) return;
    const previo = proyectos.find((x) => x.id === id);
    try {
        const parche = { estado: nuevoEstado, uid: currentUser ? currentUser.uid : (previo && previo.uid) };
        // Se registra cuando el equipo quedo reparado para que las estadisticas
        // del mes usen la fecha real de cierre y no la de ingreso.
        if (nuevoEstado === 'reparado') parche.fechaReparacion = Date.now();

        const lote = db.batch ? db.batch() : null;
        const refEquipo = db.collection(COL_EQUIPOS).doc(id);
        const refSeguimiento = db.collection(COL_SEGUIMIENTO).doc(id);
        const seguimiento = documentoSeguimiento(parche.uid, nuevoEstado, previo ? previo.modelo : '');

        if (lote) {
            lote.update(refEquipo, parche);
            lote.set(refSeguimiento, seguimiento);
            await lote.commit();
        } else {
            await refEquipo.update(parche);
            await refSeguimiento.set(seguimiento);
        }
    } catch (err) {
        avisarError('No se pudo cambiar el estado', err);
        renderizarProyectos(); // revierte el select a su valor real
    }
}

function archivarProyecto(id) {
    currentFirmaId = id;
    firmaTieneTrazos = false;
    // El canvas se dimensiona DESPUES de mostrar el modal: mientras esta
    // oculto getBoundingClientRect() devuelve 0 y la escala saldria mal.
    abrirModalFirma();
    prepararCanvas();
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
}

async function eliminarProyectoPermanente(id) {
    const r = await Swal.fire({
        title: 'Eliminar permanentemente?',
        text: 'Se borrara la orden, su evidencia y su firma. No se puede deshacer.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Si, eliminar',
        cancelButtonText: 'Cancelar',
        confirmButtonColor: '#ef4444'
    });
    if (!r.isConfirmed) return;
    try {
        const lote = db.batch ? db.batch() : null;
        if (lote) {
            lote.delete(db.collection(COL_EQUIPOS).doc(id));
            lote.delete(db.collection(COL_SEGUIMIENTO).doc(id));
            await lote.commit();
        } else {
            await db.collection(COL_EQUIPOS).doc(id).delete();
            await db.collection(COL_SEGUIMIENTO).doc(id).delete();
        }
        toast('success', 'Eliminado');
    } catch (err) {
        avisarError('No se pudo eliminar', err);
    }
}

function enviarWhatsApp(id) {
    const p = proyectos.find((x) => x.id === id);
    if (!p) return;
    const tel = normalizarTelefono(p.telefono);
    if (tel.length < 8) {
        Swal.fire('Telefono invalido', 'Este equipo no tiene un numero de WhatsApp valido.', 'warning');
        return;
    }
    const textos = {
        ingresado: 'recibido en el taller',
        revision: 'en revision tecnica',
        repuesto: 'esperando repuesto',
        reparado: 'reparado y listo para retirar',
        entregado: 'entregado'
    };
    const msg =
        'Hola ' + (p.cliente || '') + ', tu equipo ' + (p.equipo || '') + ' ' + (p.modelo || '') + ' esta ' +
        (textos[p.estado] || p.estado) + '. Puedes seguirlo aqui: ' + urlSeguimiento(id) + ' . Gracias!';
    // 'noopener' evita que la pestana destino manipule esta (reverse tabnabbing).
    window.open('https://wa.me/' + tel + '?text=' + encodeURIComponent(msg), '_blank', 'noopener,noreferrer');
}

function imprimirBoleta(id) {
    const p = proyectos.find((x) => x.id === id);
    if (!p) return;
    const url = urlSeguimiento(id);
    const qrApiUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=' + encodeURIComponent(url);

    ticketImpresion.innerHTML =
        '<div class="boleta-pos">' +
        '<div class="boleta-cabecera"><img src="logo.jpg" alt="" height="40"><h2>TechFix Pro</h2>' +
        '<p>Servicio Tecnico de Electronica</p></div><hr>' +
        '<p><b>N Orden:</b> ' + escapeHtml(String(p.id).substring(0, 8).toUpperCase()) + '</p>' +
        '<p><b>Cliente:</b> ' + escapeHtml(p.cliente) + '</p>' +
        '<p><b>Telefono:</b> ' + escapeHtml(p.telefono) + '</p>' +
        '<p><b>Equipo:</b> ' + escapeHtml(p.equipo) + ' ' + escapeHtml(p.modelo) + '</p>' +
        (p.imei ? '<p><b>IMEI:</b> ' + escapeHtml(p.imei) + '</p>' : '') +
        '<p><b>Falla:</b> ' + escapeHtml(p.falla) + '</p>' +
        (p.accesorios ? '<p><b>Accesorios:</b> ' + escapeHtml(p.accesorios) + '</p>' : '') +
        '<p><b>Fecha:</b> ' + escapeHtml(p.fecha) + '</p><hr>' +
        '<p><b>Presupuesto:</b> ' + escapeHtml(CLP(p.costo)) + '</p>' +
        '<p><b>Abono:</b> ' + escapeHtml(CLP(p.abono)) + '</p>' +
        '<p class="total"><b>Saldo:</b> ' + escapeHtml(CLP((Number(p.costo) || 0) - (Number(p.abono) || 0))) + '</p><hr>' +
        '<p class="nota">Escanea para ver el estado:</p>' +
        '<div class="boleta-qr"><img id="qr-img-print" src="' + escapeHtml(qrApiUrl) + '" width="120" height="120" alt="">' +
        '<p class="url-respaldo">' + escapeHtml(url) + '</p></div>' +
        '<p class="nota">El PIN del equipo no se imprime por seguridad.</p>' +
        '<p class="gracias">Equipos no retirados en 60 dias seran donados.</p>' +
        '</div>';

    const qrImg = $('qr-img-print');
    let impreso = false;
    const imprimir = () => {
        if (impreso) return;
        impreso = true;
        window.print();
    };
    // Si el servicio externo de QR no responde (sin red), igual se imprime:
    // la URL queda escrita como texto de respaldo.
    if (!qrImg || qrImg.complete) setTimeout(imprimir, 100);
    else {
        qrImg.onload = imprimir;
        qrImg.onerror = () => {
            qrImg.remove();
            imprimir();
        };
        setTimeout(imprimir, 2000);
    }
}

// ========================
// 7. MODAL DE FIRMA DIGITAL
// ========================

/** Ajusta el buffer del canvas al tamano real en pantalla (y a la densidad). */
function prepararCanvas() {
    if (!canvas || !ctx) return;
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (r.width > 0 && r.height > 0 && canvas.width !== Math.round(r.width * dpr)) {
        canvas.width = Math.round(r.width * dpr);
        canvas.height = Math.round(r.height * dpr);
    }
    ctx.lineWidth = Math.max(2, 2 * dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111827';
}

/**
 * Convierte coordenadas de pantalla al espacio interno del canvas.
 * Antes se restaba solo el offset: con `width:100%` en CSS el canvas se dibuja
 * escalado y la firma salia desplazada respecto del puntero.
 */
function getPointerPos(e) {
    const r = canvas.getBoundingClientRect();
    const punto = e.touches && e.touches.length ? e.touches[0] : e;
    const escalaX = r.width ? canvas.width / r.width : 1;
    const escalaY = r.height ? canvas.height / r.height : 1;
    return { x: (punto.clientX - r.left) * escalaX, y: (punto.clientY - r.top) * escalaY };
}

let isDrawing = false;
function startDrawing(e) {
    if (!ctx) return;
    isDrawing = true;
    const p = getPointerPos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    if (e.cancelable) e.preventDefault();
}
function draw(e) {
    if (!isDrawing || !ctx) return;
    const p = getPointerPos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    firmaTieneTrazos = true;
    if (e.cancelable) e.preventDefault();
}
function stopDrawing() {
    isDrawing = false;
}

if (canvas) {
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseleave', stopDrawing);
    canvas.addEventListener('touchstart', startDrawing, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stopDrawing);
    canvas.addEventListener('touchcancel', stopDrawing);
}

function abrirModalFirma() {
    ultimoFoco = document.activeElement;
    modalFirma.style.display = 'flex';
    modalFirma.removeAttribute('aria-hidden');
    const primero = modalFirma.querySelector('button');
    if (primero && primero.focus) primero.focus();
}

function cerrarModalFirma() {
    modalFirma.style.display = 'none';
    modalFirma.setAttribute('aria-hidden', 'true');
    currentFirmaId = null;
    firmaTieneTrazos = false;
    if (ultimoFoco && ultimoFoco.focus) ultimoFoco.focus();
}

$('btn-limpiar-firma').addEventListener('click', () => {
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    firmaTieneTrazos = false;
});
$('btn-cancelar-firma').addEventListener('click', cerrarModalFirma);
modalFirma.addEventListener('click', (e) => {
    if (e.target === modalFirma) cerrarModalFirma();
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalFirma.style.display === 'flex') cerrarModalFirma();
});

$('btn-guardar-firma').addEventListener('click', async () => {
    const btn = $('btn-guardar-firma');
    if (!currentFirmaId) return;
    if (!firmaTieneTrazos) {
        Swal.fire('Falta la firma', 'El cliente debe firmar antes de registrar la entrega.', 'warning');
        return;
    }
    const equipoActual = proyectos.find((x) => x.id === currentFirmaId);
    const etiqueta = btn.textContent;
    btn.textContent = 'Guardando...';
    btn.disabled = true;
    try {
        const t = document.createElement('canvas');
        t.width = 240;
        t.height = 96;
        t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
        const dataUrl = t.toDataURL('image/jpeg', 0.5);

        const parche = {
            estado: 'entregado',
            firmaCliente: dataUrl,
            fechaEntrega: Date.now(),
            uid: currentUser ? currentUser.uid : equipoActual && equipoActual.uid
        };
        if (!(equipoActual && equipoActual.fechaReparacion)) parche.fechaReparacion = Date.now();

        const idFirmado = currentFirmaId;
        const lote = db.batch ? db.batch() : null;
        if (lote) {
            lote.update(db.collection(COL_EQUIPOS).doc(idFirmado), parche);
            lote.set(
                db.collection(COL_SEGUIMIENTO).doc(idFirmado),
                documentoSeguimiento(parche.uid, 'entregado', equipoActual ? equipoActual.modelo : '')
            );
            await lote.commit();
        } else {
            await db.collection(COL_EQUIPOS).doc(idFirmado).update(parche);
            await db
                .collection(COL_SEGUIMIENTO)
                .doc(idFirmado)
                .set(documentoSeguimiento(parche.uid, 'entregado', equipoActual ? equipoActual.modelo : ''));
        }
        cerrarModalFirma();
        toast('success', 'Equipo entregado con firma');
    } catch (err) {
        avisarError('No se pudo guardar la firma', err);
    } finally {
        btn.textContent = etiqueta;
        btn.disabled = false;
    }
});

// ========================
// 8. PWA / SERVICE WORKER
// ========================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register('sw.js')
            .then((reg) => {
                // Si hay una version nueva esperando, se avisa en vez de dejar
                // al usuario con codigo viejo indefinidamente.
                reg.addEventListener('updatefound', () => {
                    const nuevo = reg.installing;
                    if (!nuevo) return;
                    nuevo.addEventListener('statechange', () => {
                        if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
                            toast('info', 'Hay una version nueva: recarga la pagina.');
                        }
                    });
                });
            })
            .catch((e) => console.warn('No se pudo registrar el service worker:', e));
    });
}

// ========================
// 9. NAVEGACION
// ========================
function mostrarVista(vista) {
    const esTaller = vista === 'taller';
    $('vista-taller').hidden = !esTaller;
    $('vista-catalogo').hidden = esTaller;
    $('btn-nav-taller').setAttribute('aria-current', esTaller ? 'page' : 'false');
    $('btn-nav-catalogo').setAttribute('aria-current', esTaller ? 'false' : 'page');
    $('btn-nav-taller').classList.toggle('activo', esTaller);
    $('btn-nav-catalogo').classList.toggle('activo', !esTaller);
}
$('btn-nav-taller').addEventListener('click', () => mostrarVista('taller'));
$('btn-nav-catalogo').addEventListener('click', () => mostrarVista('catalogo'));

// ========================
// 10. CATALOGO DE PRECIOS
// ========================
function cargarCatalogo() {
    if (!currentUser) return;
    unsubscribeCatalogo = db
        .collection(COL_CATALOGO)
        .where('uid', '==', currentUser.uid)
        .onSnapshot(
            (snapshot) => {
                catalogoDB = [];
                snapshot.forEach((doc) => catalogoDB.push({ id: doc.id, ...doc.data() }));
                renderizarCatalogo();
            },
            (error) => avisarError('Error al cargar el catalogo', error)
        );
}

function renderizarCatalogo() {
    const lista = $('lista-catalogo');
    if (!lista) return;
    lista.innerHTML = '';
    if (!catalogoDB.length) {
        lista.appendChild(el('p', { class: 'sin-resultados', text: 'Aun no hay precios guardados.' }));
        return;
    }
    const frag = document.createDocumentFragment();
    [...catalogoDB]
        .sort((a, b) => String(a.marca).localeCompare(String(b.marca)) || String(a.modelo).localeCompare(String(b.modelo)))
        .forEach((data) => {
            const card = el('article', { class: 'tarjeta-proyecto tarjeta-catalogo' }, [
                el('h3', { text: [data.marca, data.modelo].filter(Boolean).join(' - ') }),
                el('p', { text: 'Reparacion: ' + (data.reparacion || '') }),
                el('p', { class: 'precio', text: CLP(data.precio) })
            ]);
            card.appendChild(
                el('div', { class: 'acciones-tarjeta' }, [
                    el('button', {
                        class: 'btn-icon btn-eliminar',
                        text: '🗑 Eliminar',
                        attrs: { type: 'button', 'data-accion': 'borrar-catalogo', 'data-id': data.id }
                    })
                ])
            );
            frag.appendChild(card);
        });
    lista.appendChild(frag);
}

const listaCatalogo = $('lista-catalogo');
if (listaCatalogo) {
    listaCatalogo.addEventListener('click', (e) => {
        const b = e.target.closest('[data-accion="borrar-catalogo"]');
        if (b) eliminarCatalogo(b.getAttribute('data-id'));
    });
}

async function eliminarCatalogo(id) {
    const r = await Swal.fire({
        title: 'Eliminar este precio?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Si',
        cancelButtonText: 'No',
        confirmButtonColor: '#ef4444'
    });
    if (!r.isConfirmed) return;
    try {
        await db.collection(COL_CATALOGO).doc(id).delete();
        toast('success', 'Precio eliminado');
    } catch (err) {
        avisarError('No se pudo eliminar el precio', err);
    }
}

$('catalogo-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return;
    const precio = Number($('cat-precio').value);
    if (!Number.isFinite(precio) || precio < 0) {
        Swal.fire('Precio invalido', 'El precio no puede ser negativo.', 'warning');
        return;
    }
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
        await db.collection(COL_CATALOGO).add({
            uid: currentUser.uid,
            marca: $('cat-marca').value.trim(),
            modelo: $('cat-modelo').value.trim(),
            reparacion: $('cat-reparacion').value.trim(),
            precio
        });
        $('catalogo-form').reset();
        toast('success', 'Precio guardado');
    } catch (err) {
        avisarError('No se pudo guardar el precio', err);
    } finally {
        btn.disabled = false;
    }
});

// ========================
// 11. AUTOCOMPLETADO: Marca > Modelo > Reparacion > Precio
// ========================
function mostrarCampoLibre(id, visible) {
    const campo = $(id);
    if (!campo) return;
    campo.hidden = !visible;
    campo.disabled = !visible; // deshabilitado => excluido de la validacion HTML
    if (!visible) campo.value = '';
}

function resetearReparaciones() {
    const rep = $('tipo-reparacion');
    rep.innerHTML = '<option value="">-- Selecciona Reparacion --</option>';
    rep.disabled = true;
    $('costo').value = '';
}

$('marca').addEventListener('change', (e) => {
    const marca = e.target.value;
    const selModelo = $('modelo');
    selModelo.innerHTML = '<option value="">-- Selecciona Modelo --</option>';
    selModelo.disabled = true;
    resetearReparaciones();

    // "Otro" habilita texto libre: antes el equipo se guardaba literalmente
    // como "Otro" y se perdia el modelo real.
    const esOtro = marca === 'Otro';
    mostrarCampoLibre('marca-otro', esOtro);
    mostrarCampoLibre('modelo-otro', esOtro);
    selModelo.hidden = esOtro;
    if (esOtro || !marca) return;

    const modelos = [
        ...new Set(
            catalogoDB
                .filter((c) => String(c.marca || '').toLowerCase() === marca.toLowerCase())
                .map((c) => c.modelo)
                .filter(Boolean)
        )
    ].sort();
    for (const m of modelos) selModelo.appendChild(el('option', { text: m, attrs: { value: m } }));
    selModelo.appendChild(el('option', { text: 'Otro (fuera de catalogo)', attrs: { value: 'Otro' } }));
    selModelo.disabled = false;
});

$('modelo').addEventListener('change', (e) => {
    const modelo = e.target.value;
    resetearReparaciones();
    mostrarCampoLibre('modelo-otro', modelo === 'Otro');
    if (!modelo || modelo === 'Otro') return;

    const selRep = $('tipo-reparacion');
    const marca = valorMarca().toLowerCase();
    const reps = catalogoDB.filter((c) => c.modelo === modelo && String(c.marca || '').toLowerCase() === marca);
    for (const r of reps) selRep.appendChild(el('option', { text: r.reparacion, attrs: { value: r.id } }));
    selRep.appendChild(el('option', { text: 'Otra (precio manual)', attrs: { value: 'Otra' } }));
    selRep.disabled = false;
});

$('tipo-reparacion').addEventListener('change', (e) => {
    const repId = e.target.value;
    const item = repId && repId !== 'Otra' ? catalogoDB.find((c) => c.id === repId) : null;
    $('costo').value = item ? item.precio : '';
});

// ========================
// 12. BUSCADOR Y FILTRO
// ========================
buscador.addEventListener('input', debounce(renderizarProyectos, 250));
filtroEstado.addEventListener('change', renderizarProyectos);

// ========================
// 13. MIGRACION DE DATOS ANTIGUOS (ejecucion manual, una sola vez)
// ========================
/**
 * Prepara los datos creados por la version anterior:
 *   1. Rellena el campo `uid` en ordenes que no lo tienen (si no, con las
 *      reglas nuevas quedarian inaccesibles para siempre).
 *   2. Crea el espejo publico `seguimiento` de cada orden, para que los QR ya
 *      impresos sigan funcionando.
 *
 * IMPORTANTE: debe ejecutarse desde la consola del navegador, con sesion
 * iniciada y ANTES de desplegar firestore.rules:
 *     await TechFix.migrar()
 */
async function migrar() {
    if (!currentUser) {
        console.error('Inicia sesion antes de migrar.');
        return;
    }
    const snapshot = await db.collection(COL_EQUIPOS).get();
    let adoptados = 0;
    let espejos = 0;
    let lote = db.batch();
    let pendientes = 0;

    for (const doc of snapshot.docs) {
        const data = doc.data();
        const uid = data.uid || currentUser.uid;
        if (!data.uid) {
            lote.update(db.collection(COL_EQUIPOS).doc(doc.id), { uid });
            adoptados++;
            pendientes++;
        }
        if (uid === currentUser.uid) {
            lote.set(db.collection(COL_SEGUIMIENTO).doc(doc.id), documentoSeguimiento(uid, data.estado || 'ingresado', data.modelo));
            espejos++;
            pendientes++;
        }
        if (pendientes >= 400) {
            await lote.commit();
            lote = db.batch();
            pendientes = 0;
        }
    }
    if (pendientes) await lote.commit();

    const resumen = `Migracion lista: ${adoptados} orden(es) adoptadas, ${espejos} espejo(s) de seguimiento.`;
    console.log(resumen);
    Swal.fire('Migracion completada', resumen, 'success');
    return { adoptados, espejos };
}

// ========================
// API interna (navegacion por consola y pruebas automatizadas)
// ========================
window.TechFix = {
    migrar,
    escapeHtml,
    normalizarTelefono,
    urlSeguimiento,
    enviarWhatsApp,
    imprimirBoleta,
    cambiarEstado,
    archivarProyecto,
    eliminarProyectoPermanente,
    eliminarCatalogo,
    revelarPin,
    verFoto,
    proyectos: () => proyectos.slice(),
    catalogo: () => catalogoDB.slice()
};

// ========================
// NUEVAS MEJORAS (LOOP 3)
// ========================

// 1. Indicador de Red
function actualizarEstadoRed() {
    const statusObj = document.getElementById('red-status');
    if (!statusObj) return;
    if (navigator.onLine) {
        statusObj.textContent = '📶 Online';
        statusObj.className = 'badge-estado estado-reparado';
        statusObj.style.display = 'inline-block';
        setTimeout(() => statusObj.style.display = 'none', 3000);
    } else {
        statusObj.textContent = '📵 Offline (Guardando localmente)';
        statusObj.className = 'badge-estado estado-revision';
        statusObj.style.display = 'inline-block';
    }
}
window.addEventListener('online', actualizarEstadoRed);
window.addEventListener('offline', actualizarEstadoRed);
actualizarEstadoRed();

// 2. Buscador en Catalogo
const catBuscador = document.getElementById('cat-buscador');
if (catBuscador) {
    catBuscador.addEventListener('input', () => {
        const txt = catBuscador.value.toLowerCase();
        const lista = document.getElementById('lista-catalogo');
        if (!lista) return;
        lista.innerHTML = '';
        const filtrados = catalogoDB.filter(c => {
            const combinado = [c.marca, c.modelo, c.reparacion].join(' ').toLowerCase();
            return combinado.includes(txt);
        });
        
        if (!filtrados.length) {
            lista.innerHTML = '<p class="sin-resultados">No se encontraron precios.</p>';
            return;
        }
        
        const frag = document.createDocumentFragment();
        filtrados.sort((a, b) => String(a.marca).localeCompare(String(b.marca)) || String(a.modelo).localeCompare(String(b.modelo)))
            .forEach((data) => {
                const card = document.createElement('article');
                card.className = 'tarjeta-proyecto tarjeta-catalogo';
                card.innerHTML = '<h3>' + escapeHtml([data.marca, data.modelo].filter(Boolean).join(' - ')) + '</h3>' +
                                 '<p>Reparacion: ' + escapeHtml(data.reparacion || '') + '</p>' +
                                 '<p class="precio">' + CLP(data.precio) + '</p>' +
                                 '<div class="acciones-tarjeta"><button class="btn-icon btn-eliminar" type="button" data-accion="borrar-catalogo" data-id="' + escapeHtml(data.id) + '">🗑️ Eliminar</button></div>';
                frag.appendChild(card);
            });
        lista.appendChild(frag);
    });
}

// 3. Exportar a CSV
const btnExportar = document.getElementById('btn-exportar');
if (btnExportar) {
    btnExportar.addEventListener('click', () => {
        if (!proyectos || !proyectos.length) {
            Swal.fire('Vacio', 'No hay equipos para exportar.', 'info');
            return;
        }
        
        const cabeceras = ['ID', 'Fecha', 'Cliente', 'Telefono', 'Marca', 'Modelo', 'Falla', 'Estado', 'Costo', 'Abono'];
        const lineas = [cabeceras.join(',')];
        
        proyectos.forEach(p => {
            const fila = [
                p.id,
                p.fecha,
                `"${p.cliente || ''}"`,
                p.telefono || '',
                `"${p.equipo || ''}"`,
                `"${p.modelo || ''}"`,
                `"${p.falla || ''}"`,
                p.estado || '',
                p.costo || 0,
                p.abono || 0
            ];
            lineas.push(fila.join(','));
        });
        
        const csvContent = lineas.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', 'techfix_proyectos_' + new Date().toISOString().split('T')[0] + '.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
}