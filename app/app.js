/* =============================================================================
 * TechFix Tracker Pro
 * Gestion de ordenes de reparacion (Firebase Auth + Firestore, sin bundler).
 *
 * Modelo de datos:
 *   equipos/{id}      datos privados de la orden. Solo el tecnico dueno.
 *   catalogo/{id}     precios del tecnico. Solo el tecnico dueno.
 *   seguimiento/{id}  espejo PUBLICO minimo (estado + modelo) para el QR.
 *
 * El modulo se carga con <script defer>, es decir DESPUES del HTML pero ANTES
 * de que se dispare 'load'. Eso importa: el service worker se registra con los
 * listeners ya puestos (si se registrara en 'load' desde un modulo cargado a
 * destiempo, el aviso de version nueva nunca llegaria a mostrarse).
 * ========================================================================== */

(function () {
    'use strict';

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

    const COL_EQUIPOS = 'equipos';
    const COL_CATALOGO = 'catalogo';
    const COL_SEGUIMIENTO = 'seguimiento';

    // Tope de documentos que se mantienen en memoria (la lista se filtra en el
    // cliente). Con mas de 500 ordenes historicas hace falta paginacion real.
    const LIMITE_EQUIPOS = 500;

    // Dias que un equipo listo puede esperar al cliente antes de avisar.
    const PLAZO_ENTREGA_DIAS = 30;
    const AVISO_TALLER_DIAS = 7;

    const ESTADOS = ['ingresado', 'revision', 'repuesto', 'reparado', 'entregado'];
    const ESTADO_TEXTO = {
        ingresado: 'Ingresado',
        revision: 'En Revision',
        repuesto: 'Esperando Repuesto',
        reparado: 'Listo para Entregar',
        entregado: 'Entregado'
    };
    const ESTADO_ETAPAS = { ingresado: 1, revision: 2, repuesto: 3, reparado: 4, entregado: 5 };

    const PREFIJO_ORDEN = 'TF-';
    const CLAVE_CONTADOR = 'techfix.contadorOrden';

    // Libreria de QR servida desde el propio origen (sincronizada con tools/vendor.mjs y sw.js).
    const URL_QR_LIB = 'vendor/qrcode.js';
    const QR_ESTATICO = 'ticket-qr.png';

    // ========================
    // ARRANQUE TOLERANTE A FALLOS
    // Si una dependencia externa no carga (primer arranque sin red, red que
    // bloquea el CDN), antes la app moria con "firebase is not defined" y
    // pantalla en blanco. Ahora se muestra un aviso entendible y un reintento.
    // ========================
    function faltaDependencia(nombresFaltantes) {
        console.error('No se pudieron cargar:', nombresFaltantes.join(', '));
        const aviso = document.getElementById('aviso-dependencias');
        if (aviso) {
            aviso.innerHTML = '';
            const titulo = document.createElement('h2');
            titulo.textContent = 'No se pudo iniciar la aplicacion';
            const texto = document.createElement('p');
            texto.textContent =
                'No se cargaron estas librerias: ' + nombresFaltantes.join(', ') +
                '. Comprueba tu conexion a internet y vuelve a intentarlo.';
            const boton = document.createElement('button');
            boton.type = 'button';
            boton.className = 'btn-guardar';
            boton.textContent = 'Reintentar';
            boton.addEventListener('click', () => window.location.reload());
            aviso.appendChild(titulo);
            aviso.appendChild(texto);
            aviso.appendChild(boton);
            aviso.hidden = false;
        }
        return true;
    }

    function dependenciasFaltantes() {
        const faltantes = [];
        if (typeof firebase === 'undefined') faltantes.push('Firebase');
        if (typeof Swal === 'undefined') faltantes.push('SweetAlert2');
        return faltantes;
    }

    if (typeof firebase === 'undefined') {
        // Sin Firebase no hay app: se avisa y no se sigue ejecutando.
        faltaDependencia(dependenciasFaltantes());
        window.TechFix = window.TechFix || { iniciada: false, sinDependencias: true };
        return;
    }

    firebase.initializeApp(firebaseConfig);
    const db = firebase.firestore();
    const auth = firebase.auth();
    const CampoValor = firebase.firestore.FieldValue;

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

    /** Conecta un listener solo si el elemento existe (evita romper la carga). */
    function escuchar(id, evento, manejador, opciones) {
        const nodo = typeof id === 'string' ? $(id) : id;
        if (nodo) nodo.addEventListener(evento, manejador, opciones);
        return nodo;
    }

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
    const ordenarProyectos = $('ordenar-proyectos');
    const contadorResultados = $('contador-resultados');
    const contadorCatalogo = $('contador-catalogo');
    const capaImpresion = $('capa-impresion');
    const loader = $('loader');
    const statActivos = $('stat-activos');
    const statListos = $('stat-listos');
    const statReparados = $('stat-reparados');
    const statIngresos = $('stat-ingresos');
    const statPendiente = $('stat-pendiente');
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
    let filtroCatalogo = '';
    const pinesVisibles = new Set();

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

    /**
     * Fecha corta para mostrar y para el CSV, tolerante a datos viejos:
     * se acepta ISO 8601 ("2025-03-05T12:00:00.000Z") y el formato antiguo
     * ("05-03-2025") para no romper con las ordenes ya guardadas.
     */
    function fechaCorta(valor) {
        if (!valor) return '';
        if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(valor)) {
            const f = new Date(valor);
            return Number.isNaN(f.getTime()) ? valor : f.toLocaleDateString('es-CL');
        }
        if (typeof valor === 'number') return new Date(valor).toLocaleDateString('es-CL');
        return String(valor);
    }

    /** URL publica de seguimiento basada en el origen actual (no hardcodeada). */
    function urlSeguimiento(id) {
        return new URL('status.html?id=' + encodeURIComponent(id), window.location.href).toString();
    }

    function toast(icon, title) {
        if (typeof Swal === 'undefined') {
            console.log('[toast]', icon, title);
            return;
        }
        Swal.fire({ toast: true, position: 'top-end', icon, title, showConfirmButton: false, timer: 2500 });
    }

    function avisarError(titulo, err) {
        if (err) console.error(titulo, err);
        if (typeof Swal === 'undefined') return;
        const esPermiso = err && (err.code === 'permission-denied' || /permission/i.test(err.message || ''));
        Swal.fire(
            titulo,
            esPermiso
                ? 'No tienes permiso para esta operacion. Revisa firestore.rules.'
                : 'Ocurrio un problema. Revisa tu conexion e intentalo de nuevo.',
            'error'
        );
    }

    /** Los snapshots de Firestore no siempre entregan un Error: se normaliza. */
    function normalizarError(error) {
        if (!error) return null;
        if (error instanceof Error) return error;
        const e = new Error(error.message || 'Error de Firestore');
        e.code = error.code;
        return e;
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

    /** Parrafo "<b>Etiqueta:</b> valor" sin concatenar HTML a mano. */
    function parrafo(etiqueta, valor) {
        if (valor === null || valor === undefined || valor === '') return null;
        return el('p', {}, [el('b', { text: etiqueta + ': ' }), document.createTextNode(String(valor))]);
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

    /**
     * Numero de orden humano y estable por dispositivo (TF-241002-003).
     * Se guarda localmente: es una ayuda para el tecnico y el cliente (permite
     * dictarlo por telefono), no un documento contable.
     */
    let contadorMemoria = 0;
    function siguienteIdOrden(timestamp) {
        const f = new Date(timestamp || Date.now());
        const dia = String(f.getDate()).padStart(2, '0');
        const mes = String(f.getMonth() + 1).padStart(2, '0');
        const base = PREFIJO_ORDEN + String(f.getFullYear()).slice(2) + mes + dia;
        let contador = contadorMemoria;
        try {
            const guardado = JSON.parse(localStorage.getItem(CLAVE_CONTADOR) || '{}');
            if (guardado && guardado.base === base && Number.isFinite(guardado.n)) contador = guardado.n;
        } catch (_e) {
            /* localStorage bloqueado: se sigue con el contador en memoria */
        }
        contador += 1;
        contadorMemoria = contador;
        try {
            localStorage.setItem(CLAVE_CONTADOR, JSON.stringify({ base, n: contador }));
        } catch (_e) {
            /* modo privado: el contador solo vive mientras la pestana este abierta */
        }
        return base + '-' + String(contador).padStart(3, '0');
    }

    /** Numero de orden para mostrar (fallback: id corto en mayusculas). */
    function mostrarIdOrden(p) {
        if (p && p.idOrden) return p.idOrden;
        return String((p && p.id) || '').substring(0, 8).toUpperCase();
    }

    /** Peso real en bytes de una data URL (no el largo del string). */
    function pesoEnBytes(dataUrl) {
        const coma = String(dataUrl).indexOf(',');
        const b64 = coma >= 0 ? dataUrl.slice(coma + 1) : String(dataUrl);
        return Math.floor((b64.length * 3) / 4);
    }

    /** Carga un script propio una sola vez (dependencias opcionales). */
    let promesaScript = null;
    function cargarScript(src) {
        if (promesaScript) return promesaScript;
        promesaScript = new Promise((resolver, rechazar) => {
            const s = document.createElement('script');
            s.src = src;
            s.async = true;
            s.onload = () => resolver(true);
            s.onerror = () => {
                promesaScript = null; // permite reintentar
                rechazar(new Error('No se pudo cargar ' + src));
            };
            document.head.appendChild(s);
        });
        return promesaScript;
    }

    // ========================
    // 1. TEMA Y PANEL COLAPSABLE
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

    escuchar('btn-toggle-ingreso', 'click', () => {
        const cuerpo = $('cuerpo-ingreso');
        const boton = $('btn-toggle-ingreso');
        if (!cuerpo || !boton) return;
        const ocultar = !cuerpo.hidden;
        cuerpo.hidden = ocultar;
        boton.setAttribute('aria-expanded', String(!ocultar));
        boton.textContent = ocultar ? '➕ Nuevo ingreso' : 'Minimizar formulario';
    });

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

    function limpiarSesionEnPantalla() {
        proyectos = [];
        catalogoDB = [];
        pinesVisibles.clear();
        filtroCatalogo = '';
        if (listaProyectos) listaProyectos.innerHTML = '';
        if (statActivos) statActivos.textContent = '0';
        if (statListos) statListos.textContent = '0';
        if (statReparados) statReparados.textContent = '0';
        if (statIngresos) statIngresos.textContent = CLP(0);
        if (statPendiente) statPendiente.textContent = CLP(0);
        if (contadorResultados) contadorResultados.textContent = '0 ordenes';
        if (contadorCatalogo) contadorCatalogo.textContent = '0 servicios';
        renderizarAvisos();
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
            loginScreen.style.display = 'flex';
            appContent.style.display = 'none';
            limpiarSesionEnPantalla();
        }
    });

    escuchar(loginForm, 'submit', async (e) => {
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
            if (typeof Swal !== 'undefined') {
                Swal.fire('Error de Acceso', mensajes[error.code] || 'Credenciales incorrectas.', 'error');
            }
        } finally {
            btn.textContent = etiqueta;
            btn.disabled = false;
        }
    });

    escuchar('btn-recuperar', 'click', async () => {
        if (typeof Swal === 'undefined') return;
        const respuesta = await Swal.fire({
            title: 'Recuperar contrasena',
            input: 'email',
            inputLabel: 'Correo de la cuenta',
            inputValue: ($('login-email').value || '').trim(),
            showCancelButton: true,
            confirmButtonText: 'Enviar enlace',
            cancelButtonText: 'Cancelar'
        });
        const email = respuesta && respuesta.value ? String(respuesta.value).trim() : '';
        if (!email) return;
        try {
            await auth.sendPasswordResetEmail(email);
        } catch (err) {
            // Se registra el motivo real pero se responde siempre lo mismo: asi
            // no se puede averiguar que correos estan registrados.
            console.warn('Recuperacion de contrasena:', err && err.code);
        }
        toast('success', 'Si el correo esta registrado, te enviamos un enlace.');
    });

    escuchar(btnLogout, 'click', async () => {
        try {
            cancelarSuscripciones();
            await auth.signOut();
            limpiarSesionEnPantalla();

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

    /**
     * Cambio de contrasena del propio tecnico. Firebase exige un inicio de
     * sesion reciente para esta operacion.
     */
    async function cambiarContrasena() {
        if (typeof Swal === 'undefined' || !currentUser) return;
        const respuesta = await Swal.fire({
            title: 'Cambiar contrasena',
            html:
                '<label for="pwd-nueva" class="etiqueta-modal">Nueva contrasena</label>' +
                '<input id="pwd-nueva" type="password" autocomplete="new-password">' +
                '<label for="pwd-repetir" class="etiqueta-modal">Repite la contrasena</label>' +
                '<input id="pwd-repetir" type="password" autocomplete="new-password">',
            showCancelButton: true,
            confirmButtonText: 'Cambiar',
            cancelButtonText: 'Cancelar',
            preConfirm: () => {
                const nueva = document.getElementById('pwd-nueva').value;
                const repetir = document.getElementById('pwd-repetir').value;
                if (nueva.length < 8) return Swal.showValidationMessage('Usa al menos 8 caracteres.');
                if (nueva !== repetir) return Swal.showValidationMessage('Las contrasenas no coinciden.');
                return { nueva };
            }
        });
        const datos = respuesta && respuesta.value;
        if (!datos || !datos.nueva) return;
        try {
            await currentUser.updatePassword(datos.nueva);
            toast('success', 'Contrasena actualizada');
        } catch (err) {
            if (err && err.code === 'auth/requires-recent-login') {
                Swal.fire('Sesion antigua', 'Por seguridad, vuelve a iniciar sesion y repite el cambio.', 'warning');
            } else {
                avisarError('No se pudo cambiar la contrasena', err);
            }
        }
    }
    escuchar('btn-contrasena', 'click', cambiarContrasena);

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
                    revisarRecordatorios();
                    renderizarProyectos();
                    actualizarDashboard();
                },
                (error) => {
                    loader.style.display = 'none';
                    if (!error) {
                        avisarError('Error al cargar los equipos', null);
                    } else if (error.code === 'failed-precondition') {
                        Swal.fire(
                            'Falta un indice',
                            'Firestore necesita el indice compuesto (uid + timestamp). Ejecuta: firebase deploy --only firestore:indexes',
                            'error'
                        );
                    } else if (error.code === 'permission-denied') {
                        Swal.fire(
                            'Sin permisos de lectura',
                            'Firestore rechazo la consulta. Comprueba que firestore.rules este desplegado y que tus ordenes tengan tu uid.',
                            'error'
                        );
                    } else {
                        avisarError('Error al cargar los equipos', normalizarError(error));
                    }
                }
            );
    }

    function actualizarDashboard() {
        const ahora = new Date();
        const mes = ahora.getMonth();
        const anio = ahora.getFullYear();

        const activos = proyectos.filter((p) => p.estado !== 'entregado');
        const listos = proyectos.filter((p) => p.estado === 'reparado');
        const cerradosEsteMes = proyectos.filter((p) => {
            if (p.estado !== 'reparado' && p.estado !== 'entregado') return false;
            const f = new Date(fechaDeCierre(p));
            return f.getMonth() === mes && f.getFullYear() === anio;
        });

        const saldoPorCobrar = activos.reduce(
            (sum, p) => sum + Math.max(0, (Number(p.costo) || 0) - (Number(p.abono) || 0)),
            0
        );

        if (statActivos) statActivos.textContent = String(activos.length);
        if (statListos) statListos.textContent = String(listos.length);
        if (statReparados) statReparados.textContent = String(cerradosEsteMes.length);
        if (statIngresos) {
            statIngresos.textContent = CLP(cerradosEsteMes.reduce((sum, p) => sum + (Number(p.costo) || 0), 0));
        }
        if (statPendiente) statPendiente.textContent = CLP(saldoPorCobrar);
    }

    // Clic en tarjetas KPI del dashboard para filtrar rapidamente
    escuchar(document, 'click', (e) => {
        const card = e.target.closest && e.target.closest('[data-filtro-kpi]');
        if (!card || !filtroEstado) return;
        const destino = card.getAttribute('data-filtro-kpi');
        if (destino) {
            filtroEstado.value = destino;
            renderizarProyectos();
        }
    });

    /**
     * Momento de cierre de la orden: la fecha de reparacion real y, para datos
     * antiguos que no la tienen, la de entrega y por ultimo la de ingreso.
     */
    function fechaDeCierre(p) {
        return Number(p.fechaReparacion || p.fechaEntrega || p.timestamp || 0);
    }

    /** Dias que lleva la orden en el taller (null si ya se entrego). */
    function diasEnTaller(p) {
        if (!p || p.estado === 'entregado') return null;
        const desde = Number(p.timestamp || 0);
        if (!desde) return null;
        return Math.max(0, Math.floor((Date.now() - desde) / 86400000));
    }

    /**
     * Transiciones permitidas desde el estado actual:
     *   - hacia adelante, todos los estados posteriores;
     *   - hacia atras, solo un paso (corregir un clic equivocado).
     * 'entregado' se reserva para la entrega con firma.
     */
    function permiteEstado(p, nuevo) {
        if (!p) return false;
        const actual = ESTADO_ETAPAS[p.estado] || 1;
        const destino = ESTADO_ETAPAS[nuevo];
        if (!destino) return false;
        if (nuevo === 'entregado') return p.estado === 'entregado';
        return destino >= actual - 1;
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
                el('span', { class: 'tarjeta-fecha', text: fechaCorta(p.fecha) })
            ])
        );

        const dias = diasEnTaller(p);
        if (dias !== null && dias >= AVISO_TALLER_DIAS) {
            tarjeta.appendChild(el('span', { class: 'badge-espera', text: '⏱ En taller hace ' + dias + ' dias' }));
        }

        tarjeta.appendChild(el('h3', { text: p.cliente || 'Sin nombre' }));
        tarjeta.appendChild(el('p', { class: 'tarjeta-dispositivo', text: [p.equipo, p.modelo].filter(Boolean).join(' - ') }));
        if (p.idOrden) tarjeta.appendChild(el('p', { class: 'detalle-extra orden-chip', text: 'Orden: ' + p.idOrden }));
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
                    attrs: {
                        type: 'button',
                        'data-accion': 'pin',
                        'data-id': p.id,
                        'aria-label': 'Mostrar u ocultar el PIN'
                    }
                })
            );
            tarjeta.appendChild(fila);
        }

        tarjeta.appendChild(el('p', { class: 'tarjeta-falla', text: 'Falla: ' + (p.falla || 'Sin detalle') }));
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
                attrs: {
                    src: p.evidencia,
                    alt: 'Evidencia fotografica de ' + (p.cliente || ''),
                    'data-accion': 'foto',
                    'data-id': p.id,
                    loading: 'lazy'
                }
            });
            tarjeta.appendChild(
                el('div', { class: 'bloque-media' }, [
                    img,
                    el('p', { class: 'detalle-extra', text: 'Evidencia fotografica' })
                ])
            );
        }
        if (p.firmaCliente) {
            tarjeta.appendChild(
                el('div', { class: 'bloque-media' }, [
                    el('img', {
                        class: 'firma-guardada',
                        attrs: { src: p.firmaCliente, alt: 'Firma de conformidad', loading: 'lazy' }
                    }),
                    el('p', { class: 'detalle-extra', text: 'Firma de conformidad' })
                ])
            );
        }

        const acciones = el('div', { class: 'acciones-tarjeta' });
        const select = el('select', {
            class: 'select-estado-rapido estado-' + (p.estado || 'ingresado'),
            attrs: {
                'data-accion': 'estado',
                'data-id': p.id,
                'aria-label':
                    'Cambiar estado de ' + (p.cliente || 'el equipo') + ' (actual: ' + (ESTADO_TEXTO[p.estado] || p.estado) + ')'
            }
        });
        for (const est of ESTADOS) {
            const opt = el('option', { text: ESTADO_TEXTO[est], attrs: { value: est } });
            if (p.estado === est) opt.selected = true;
            if (!permiteEstado(p, est)) opt.disabled = true;
            select.appendChild(opt);
        }
        acciones.appendChild(select);
        acciones.appendChild(
            el('button', {
                class: 'btn-icon btn-whatsapp',
                text: '💬 WhatsApp',
                attrs: { type: 'button', 'data-accion': 'wa', 'data-id': p.id }
            })
        );
        acciones.appendChild(
            el('button', {
                class: 'btn-icon btn-imprimir',
                text: '🧾 Ticket',
                attrs: { type: 'button', 'data-accion': 'ticket', 'data-id': p.id }
            })
        );
        acciones.appendChild(
            el('button', {
                class: 'btn-icon btn-compartir',
                text: '📤 Compartir',
                attrs: { type: 'button', 'data-accion': 'compartir', 'data-id': p.id }
            })
        );
        acciones.appendChild(
            el('button', {
                class: 'btn-icon btn-editar',
                text: '✏️ Editar',
                attrs: { type: 'button', 'data-accion': 'editar', 'data-id': p.id }
            })
        );
        acciones.appendChild(
            el('button', {
                class: 'btn-icon btn-historial',
                text: '🕒 Historial',
                attrs: { type: 'button', 'data-accion': 'historial', 'data-id': p.id }
            })
        );
        if (p.estado !== 'entregado') {
            acciones.appendChild(
                el('button', {
                    class: 'btn-icon btn-entregar',
                    text: '✅ Entregar con firma',
                    attrs: { type: 'button', 'data-accion': 'entregar', 'data-id': p.id }
                })
            );
        }
        acciones.appendChild(
            el('button', {
                class: 'btn-icon btn-eliminar',
                text: '🗑 Borrar',
                attrs: { type: 'button', 'data-accion': 'borrar', 'data-id': p.id }
            })
        );
        tarjeta.appendChild(acciones);
        return tarjeta;
    }

    /** Ordenes que cumplen el buscador, el filtro y el criterio de orden activos. */
    function proyectosFiltrados() {
        const txt = (buscador && buscador.value ? buscador.value : '').trim().toLowerCase();
        const filtro = filtroEstado ? filtroEstado.value : 'activos';
        const criterio = ordenarProyectos ? ordenarProyectos.value : 'recientes';

        const lista = proyectos.filter((p) => {
            const campos = [p.cliente, p.equipo, p.modelo, p.falla, p.imei, p.accesorios, p.telefono, p.idOrden]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            if (txt && !campos.includes(txt)) return false;
            if (filtro === 'activos') return p.estado !== 'entregado';
            if (filtro !== 'todos') return p.estado === filtro;
            return true;
        });

        if (criterio === 'antiguos') {
            lista.sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0));
        } else if (criterio === 'saldo') {
            lista.sort((a, b) => {
                const sa = (Number(a.costo) || 0) - (Number(a.abono) || 0);
                const sb = (Number(b.costo) || 0) - (Number(b.abono) || 0);
                return sb - sa;
            });
        } else if (criterio === 'cliente') {
            lista.sort((a, b) => String(a.cliente || '').localeCompare(String(b.cliente || '')));
        }
        return lista;
    }

    function renderizarProyectos() {
        if (!listaProyectos) return;
        const filtrados = proyectosFiltrados();
        if (contadorResultados) {
            contadorResultados.textContent = filtrados.length + (filtrados.length === 1 ? ' orden' : ' ordenes');
        }

        listaProyectos.innerHTML = '';
        if (filtrados.length === 0) {
            const hayBusqueda = buscador && buscador.value.trim();
            listaProyectos.appendChild(
                el('p', {
                    class: 'sin-resultados',
                    text: hayBusqueda ? 'Ningun equipo coincide con la busqueda.' : 'No hay equipos registrados.'
                })
            );
            return;
        }

        // Un solo reflow: se arma todo en memoria y se inserta de una vez.
        const frag = document.createDocumentFragment();
        filtrados.forEach((p) => frag.appendChild(construirTarjeta(p)));
        listaProyectos.appendChild(frag);
    }

    /** Aviso de equipos listos que el cliente no ha venido a retirar. */
    function revisarRecordatorios() {
        renderizarAvisos(
            proyectos.filter((p) => {
                const d = diasEnTaller(p);
                return p.estado === 'reparado' && d !== null && d >= PLAZO_ENTREGA_DIAS;
            })
        );
    }

    function renderizarAvisos(vencidos = null) {
        const contenedor = $('aviso-vencidos');
        if (!contenedor) return;
        contenedor.innerHTML = '';
        const lista = vencidos || [];
        if (!lista.length) {
            contenedor.hidden = true;
            return;
        }
        const nombres = lista.slice(0, 5).map((p) => p.cliente || 'Sin nombre').join(', ');
        contenedor.appendChild(
            el('span', {
                class: 'aviso-titulo',
                text: '⚠ ' + lista.length + ' equipo(s) listo(s) hace mas de ' + PLAZO_ENTREGA_DIAS + ' dias esperando al cliente'
            })
        );
        contenedor.appendChild(el('p', { class: 'detalle-extra', text: 'Clientes: ' + nombres + (lista.length > 5 ? '…' : '') }));
        contenedor.appendChild(
            el('button', { class: 'btn-icon', text: 'Ver listos para entregar', attrs: { type: 'button', id: 'btn-ver-vencidos' } })
        );
        contenedor.hidden = false;
    }

    // Delegacion de eventos: sin onclick inline, compatible con CSP estricta y a
    // prueba de comillas en los datos.
    escuchar(listaProyectos, 'click', (e) => {
        const destino = e.target.closest && e.target.closest('[data-accion]');
        if (!destino) return;
        const id = destino.getAttribute('data-id');
        switch (destino.getAttribute('data-accion')) {
            case 'wa':
                enviarWhatsApp(id);
                break;
            case 'ticket':
                imprimirBoleta(id);
                break;
            case 'compartir':
                compartirTicket(id);
                break;
            case 'editar':
                editarProyecto(id);
                break;
            case 'historial':
                verHistorial(id);
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
    escuchar(listaProyectos, 'change', (e) => {
        const destino = e.target.closest && e.target.closest('[data-accion="estado"]');
        if (destino) cambiarEstado(destino.getAttribute('data-id'), destino.value);
    });

    escuchar(document, 'click', (e) => {
        const btn = e.target.closest && e.target.closest('#btn-ver-vencidos');
        if (!btn) return;
        if (filtroEstado) {
            filtroEstado.value = 'reparado';
            renderizarProyectos();
        }
    });

    // ========================
    // 4. FOTOGRAFIA DE EVIDENCIA
    // ========================
    // Limite de Firestore: 1 MiB por documento. Aqui se reserva un margen para
    // los demas campos; la solucion de fondo es mover las fotos a Storage.
    const MAX_FOTO_BYTES = 200 * 1024;

    escuchar('foto-evidencia', 'change', function (e) {
        const file = e.target.files && e.target.files[0];
        const preview = $('preview-foto');
        if (!file) {
            fotoComprimidaBase64 = null;
            if (preview) preview.style.display = 'none';
            return;
        }
        if (!/^image\//.test(file.type)) {
            if (typeof Swal !== 'undefined') Swal.fire('Archivo invalido', 'Selecciona una imagen.', 'warning');
            e.target.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onerror = () => {
            if (typeof Swal !== 'undefined') Swal.fire('Error', 'No se pudo leer la imagen.', 'error');
        };
        reader.onload = function (ev) {
            const img = new Image();
            img.onerror = () => {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'El archivo no es una imagen valida.', 'error');
            };
            img.onload = function () {
                // Se prueba de mayor a menor: primero bajando la calidad y, si
                // aun no alcanza, reduciendo el lado mayor. Con el while fijo de
                // calidad que habia antes, una foto muy detallada podia superar
                // el limite de 1 MiB por documento.
                let max = 600;
                let dataUrl = '';
                let bytes = Infinity;
                for (let intento = 0; intento < 6 && bytes > MAX_FOTO_BYTES; intento++) {
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

                    let calidad = 0.6;
                    dataUrl = c.toDataURL('image/jpeg', calidad);
                    bytes = pesoEnBytes(dataUrl);
                    while (bytes > MAX_FOTO_BYTES && calidad > 0.25) {
                        calidad -= 0.1;
                        dataUrl = c.toDataURL('image/jpeg', calidad);
                        bytes = pesoEnBytes(dataUrl);
                    }
                    max = Math.round(max * 0.75);
                }

                if (bytes > MAX_FOTO_BYTES) {
                    if (typeof Swal !== 'undefined') {
                        Swal.fire('Imagen muy pesada', 'No se pudo comprimir lo suficiente. Prueba con otra foto.', 'warning');
                    }
                    e.target.value = '';
                    fotoComprimidaBase64 = null;
                    if (preview) preview.style.display = 'none';
                    return;
                }
                fotoComprimidaBase64 = dataUrl;
                $('img-evidencia-preview').src = dataUrl;
                if (preview) preview.style.display = 'block';
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    });

    function verFoto(id) {
        const p = proyectos.find((x) => x.id === id);
        if (p && p.evidencia && typeof Swal !== 'undefined') {
            Swal.fire({ imageUrl: p.evidencia, imageAlt: 'Evidencia', width: '90%', padding: 0 });
        }
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

    /** Marca en rojo el campo que impide guardar (feedback inmediato). */
    function marcarFormulario(campoInvalido) {
        const ids = ['cliente', 'telefono', 'marca', 'modelo', 'marca-otro', 'modelo-otro', 'costo', 'abono'];
        for (const id of ids) {
            const nodo = $(id);
            if (nodo) nodo.classList.toggle('campo-invalido', id === campoInvalido);
        }
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
        marcarFormulario(null);
    }

    escuchar(form, 'submit', async (e) => {
        e.preventDefault();
        if (!currentUser) {
            if (typeof Swal !== 'undefined') Swal.fire('Sesion requerida', 'Inicia sesion primero.', 'error');
            return;
        }
        marcarFormulario(null);

        const cliente = $('cliente').value.trim();
        const telefono = normalizarTelefono($('telefono').value);
        const marca = valorMarca();
        const modelo = valorModelo();
        const costo = Number($('costo').value);
        const abono = Number($('abono').value || 0);

        // ---- Validaciones de negocio (ademas de las de firestore.rules) ----
        const fallo = (campo, titulo, mensaje) => {
            marcarFormulario(campo);
            if (typeof Swal !== 'undefined') Swal.fire(titulo, mensaje, 'warning');
        };
        if (!cliente) return fallo('cliente', 'Falta el cliente', 'Escribe el nombre del cliente.');
        if (telefono.length < 8) {
            return fallo(
                'telefono',
                'Telefono invalido',
                'Ingresa el numero con codigo de pais, solo digitos. Ej: 56912345678'
            );
        }
        if (!marca) return fallo('marca', 'Falta la marca', 'Indica la marca del equipo.');
        if (!modelo) return fallo('modelo', 'Falta el modelo', 'Indica el modelo del equipo.');
        if (!Number.isFinite(costo) || costo < 0) {
            return fallo('costo', 'Costo invalido', 'El presupuesto no puede ser negativo.');
        }
        if (!Number.isFinite(abono) || abono < 0) {
            return fallo('abono', 'Abono invalido', 'El abono no puede ser negativo.');
        }
        if (abono > costo) {
            return fallo('abono', 'Abono invalido', 'El abono no puede superar el presupuesto total.');
        }

        const selRep = $('tipo-reparacion');
        const repTxt =
            selRep.selectedIndex >= 0 && selRep.options[selRep.selectedIndex] ? selRep.options[selRep.selectedIndex].text : '';
        const detalle = $('falla').value.trim();
        const generico = [
            '-- Selecciona Reparacion --',
            '-- Selecciona Reparación --',
            'Otra (precio manual)',
            '-- Selecciona Modelo Primero --',
            ''
        ];
        const fallaFinal = !generico.includes(repTxt) ? repTxt + (detalle ? ' - ' + detalle : '') : detalle;
        const estado = $('estado').value;
        const ahora = Date.now();

        const nuevoProyecto = {
            uid: currentUser.uid,
            idOrden: siguienteIdOrden(ahora),
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
            // ISO 8601: ordenable, sin ambiguedad de zona horaria y compatible
            // con lo que validan las reglas de Firestore.
            fecha: new Date(ahora).toISOString(),
            timestamp: ahora,
            fechaReparacion: estado === 'reparado' ? ahora : null,
            fechaEntrega: null,
            historial: [{ estado, en: ahora, por: currentUser.uid }],
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
            toast('success', 'Equipo guardado - Orden ' + nuevoProyecto.idOrden);
            if (listaProyectos.scrollIntoView) listaProyectos.scrollIntoView({ behavior: 'smooth' });
            // El snapshot puede no haber llegado todavia: se usa el registro
            // recien creado como respaldo para poder imprimir el ticket ya.
            const recienCreado = proyectos.find((x) => x.id === ref.id) || { id: ref.id, ...nuevoProyecto };
            ofrecerTicket(recienCreado);
        } catch (err) {
            avisarError('No se pudo guardar el equipo', err);
        } finally {
            btnSubmit.disabled = false;
            btnSubmit.textContent = etiqueta;
        }
    });

    // ========================
    // 6. ACCIONES DE TARJETA (ESTADO, EDICION, HISTORIAL, ENTREGA)
    // ========================
    /** Entrada de historial lista para arrayUnion (null si no esta soportado). */
    function entradaHistorial(estado, uid) {
        if (!CampoValor || typeof CampoValor.arrayUnion !== 'function') return null;
        return CampoValor.arrayUnion({ estado, en: Date.now(), por: uid || '' });
    }

    async function cambiarEstado(id, nuevoEstado) {
        if (!ESTADOS.includes(nuevoEstado)) return;
        const previo = proyectos.find((x) => x.id === id);
        if (!previo) {
            avisarError('No se pudo cambiar el estado', new Error('La orden no esta en la lista actual.'));
            return;
        }
        if (!permiteEstado(previo, nuevoEstado)) {
            renderizarProyectos();
            return;
        }
        if (previo.estado === nuevoEstado) return;

        try {
            const uid = currentUser ? currentUser.uid : previo.uid;
            const parche = { estado: nuevoEstado, uid };
            // Se registra cuando el equipo quedo reparado para que las
            // estadisticas del mes usen la fecha real de cierre.
            if (nuevoEstado === 'reparado' && !previo.fechaReparacion) parche.fechaReparacion = Date.now();
            const historial = entradaHistorial(nuevoEstado, uid);
            if (historial) parche.historial = historial;

            const lote = db.batch ? db.batch() : null;
            const refEquipo = db.collection(COL_EQUIPOS).doc(id);
            const refSeguimiento = db.collection(COL_SEGUIMIENTO).doc(id);
            const seguimiento = documentoSeguimiento(uid, nuevoEstado, previo.modelo);

            if (lote) {
                lote.update(refEquipo, parche);
                lote.set(refSeguimiento, seguimiento);
                await lote.commit();
            } else {
                await refEquipo.update(parche);
                await refSeguimiento.set(seguimiento);
            }

            // Regla de negocio: quien se lleva el equipo deja su conformidad.
            if (nuevoEstado === 'entregado' && !previo.firmaCliente && typeof Swal !== 'undefined') {
                await Swal.fire({
                    title: 'Entrega sin firma',
                    text: 'El estado quedo como entregado, pero no hay firma de conformidad guardada.',
                    icon: 'warning'
                });
            }
        } catch (err) {
            avisarError('No se pudo cambiar el estado', err);
            renderizarProyectos(); // revierte el select a su valor real
        }
    }

    /**
     * Edita los datos operativos o financieros de una orden existente (por
     * ejemplo, asignar presupuesto tras diagnostico o registrar un abono).
     */
    async function editarProyecto(id, datosDirectos = null) {
        const previo = proyectos.find((x) => x.id === id);
        if (!previo) return false;

        let valores = datosDirectos;
        if (!valores && typeof Swal !== 'undefined') {
            const respuesta = await Swal.fire({
                title: 'Editar orden ' + mostrarIdOrden(previo),
                html:
                    '<label for="edit-cliente" class="etiqueta-modal">Cliente</label>' +
                    '<input id="edit-cliente" type="text" maxlength="120" value="' + escapeHtml(previo.cliente || '') + '">' +
                    '<label for="edit-telefono" class="etiqueta-modal">Telefono (WhatsApp)</label>' +
                    '<input id="edit-telefono" type="tel" value="' + escapeHtml(previo.telefono || '') + '">' +
                    '<label for="edit-falla" class="etiqueta-modal">Falla / Diagnostico</label>' +
                    '<input id="edit-falla" type="text" maxlength="200" value="' + escapeHtml(previo.falla || '') + '">' +
                    '<label for="edit-accesorios" class="etiqueta-modal">Condicion y accesorios</label>' +
                    '<input id="edit-accesorios" type="text" maxlength="200" value="' + escapeHtml(previo.accesorios || '') + '">' +
                    '<label for="edit-costo" class="etiqueta-modal">Presupuesto total ($)</label>' +
                    '<input id="edit-costo" type="number" min="0" step="1" value="' + Number(previo.costo || 0) + '">' +
                    '<label for="edit-abono" class="etiqueta-modal">Abono ($)</label>' +
                    '<input id="edit-abono" type="number" min="0" step="1" value="' + Number(previo.abono || 0) + '">',
                showCancelButton: true,
                confirmButtonText: 'Guardar cambios',
                cancelButtonText: 'Cancelar',
                preConfirm: () => {
                    const cliente = document.getElementById('edit-cliente').value.trim();
                    const telefono = normalizarTelefono(document.getElementById('edit-telefono').value);
                    const falla = document.getElementById('edit-falla').value.trim();
                    const accesorios = document.getElementById('edit-accesorios').value.trim();
                    const costo = Number(document.getElementById('edit-costo').value);
                    const abono = Number(document.getElementById('edit-abono').value || 0);
                    if (!cliente) return Swal.showValidationMessage('El nombre del cliente es obligatorio.');
                    if (telefono.length < 8) return Swal.showValidationMessage('El telefono debe tener al menos 8 digitos.');
                    if (!Number.isFinite(costo) || costo < 0) return Swal.showValidationMessage('El presupuesto no puede ser negativo.');
                    if (!Number.isFinite(abono) || abono < 0 || abono > costo) {
                        return Swal.showValidationMessage('El abono debe estar entre 0 y el presupuesto total.');
                    }
                    return { cliente, telefono, falla, accesorios, costo, abono };
                }
            });
            valores = respuesta && respuesta.value ? respuesta.value : null;
        }
        if (!valores) return false;

        const cliente = String(valores.cliente ?? previo.cliente ?? '').trim();
        const telefono = normalizarTelefono(valores.telefono ?? previo.telefono ?? '');
        const falla = String(valores.falla ?? previo.falla ?? '').trim();
        const accesorios = String(valores.accesorios ?? previo.accesorios ?? '').trim();
        const costo = Number(valores.costo ?? previo.costo ?? 0);
        const abono = Number(valores.abono ?? previo.abono ?? 0);

        if (!cliente || telefono.length < 8 || !Number.isFinite(costo) || costo < 0 || !Number.isFinite(abono) || abono < 0 || abono > costo) {
            if (typeof Swal !== 'undefined') Swal.fire('Datos invalidos', 'Revisa el cliente, telefono y montos.', 'warning');
            return false;
        }

        try {
            const uid = currentUser ? currentUser.uid : previo.uid;
            await db.collection(COL_EQUIPOS).doc(id).update({
                uid,
                cliente,
                telefono,
                falla,
                accesorios,
                costo,
                abono
            });
            toast('success', 'Orden actualizada');
            return true;
        } catch (err) {
            avisarError('No se pudo actualizar la orden', err);
            return false;
        }
    }

    /**
     * Muestra la trazabilidad completa de estados de la orden.
     */
    function verHistorial(id) {
        const p = proyectos.find((x) => x.id === id);
        if (!p || typeof Swal === 'undefined') return null;

        const entradas = Array.isArray(p.historial) && p.historial.length
            ? p.historial
            : [{ estado: p.estado || 'ingresado', en: p.timestamp || Date.now() }];

        const itemsHtml = entradas
            .map((item) => {
                const etiqueta = escapeHtml(ESTADO_TEXTO[item.estado] || item.estado || 'Estado');
                const fecha = escapeHtml(fechaCorta(item.en));
                return '<li class="historial-item"><strong>' + etiqueta + '</strong> <span>' + fecha + '</span></li>';
            })
            .join('');

        Swal.fire({
            title: 'Historial · ' + mostrarIdOrden(p),
            html:
                '<div class="historial-modal">' +
                '<p class="detalle-extra">' + escapeHtml([p.cliente, p.equipo, p.modelo].filter(Boolean).join(' · ')) + '</p>' +
                '<ul class="historial-lista">' + itemsHtml + '</ul>' +
                '</div>',
            confirmButtonText: 'Cerrar'
        });
        return entradas;
    }

    function archivarProyecto(id) {
        currentFirmaId = id;
        firmaTieneTrazos = false;
        // El canvas se dimensiona DESPUES de mostrar el modal: mientras esta
        // oculto getBoundingClientRect() devuelve 0 y la escala saldria mal.
        abrirModalFirma();
        prepararCanvas();
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

    function mensajeCliente(p) {
        const textos = {
            ingresado: 'recibido en el taller',
            revision: 'en revision tecnica',
            repuesto: 'esperando repuesto',
            reparado: 'reparado y listo para retirar',
            entregado: 'entregado'
        };
        return (
            'Hola ' + (p.cliente || '') + ', tu equipo ' + (p.equipo || '') + ' ' + (p.modelo || '') + ' esta ' +
            (textos[p.estado] || p.estado) + '. Puedes seguirlo aqui: ' + urlSeguimiento(p.id) + ' . Gracias!'
        );
    }

    function enviarWhatsApp(id) {
        const p = proyectos.find((x) => x.id === id);
        if (!p) return;
        const tel = normalizarTelefono(p.telefono);
        if (tel.length < 8) {
            Swal.fire('Telefono invalido', 'Este equipo no tiene un numero de WhatsApp valido.', 'warning');
            return;
        }
        // 'noopener' evita que la pestana destino manipule esta (reverse tabnabbing).
        window.open(
            'https://wa.me/' + tel + '?text=' + encodeURIComponent(mensajeCliente(p)),
            '_blank',
            'noopener,noreferrer'
        );
    }

    /**
     * Comparte el enlace publico de seguimiento con la Web Share API (el canal
     * natural en movil) y cae a "copiar al portapapeles" en escritorio.
     */
    async function compartirTicket(id) {
        const p = proyectos.find((x) => x.id === id);
        if (!p) return;
        const url = urlSeguimiento(id);
        const texto = 'Seguimiento de tu reparacion (' + (p.equipo || '') + ' ' + (p.modelo || '') + ')';

        if (navigator.share) {
            try {
                await navigator.share({ title: 'TechFix Tracker', text: texto, url });
                return;
            } catch (err) {
                if (err && err.name === 'AbortError') return; // el usuario cerro el dialogo
            }
        }
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(url);
                toast('success', 'Enlace copiado al portapapeles');
                return;
            }
        } catch (err) {
            console.warn('Portapapeles no disponible:', err);
        }
        // Ultimo recurso: mostrar el enlace para copiarlo a mano.
        Swal.fire({ title: 'Enlace de seguimiento', input: 'text', inputValue: url, confirmButtonText: 'Cerrar' });
    }

    /**
     * Dibuja el QR del ticket en el nodo dado.
     * 1) usa la libreria local (el QR lleva el id exacto de la orden);
     * 2) si no esta disponible, cae al QR estatico versionado (apunta a la
     *    pagina de seguimiento: el cliente escanea y escribe su codigo);
     * 3) en el ticket, la URL siempre queda impresa como texto de respaldo.
     */
    function ponerQr(destino, url) {
        if (typeof window.qrcode === 'function') {
            try {
                const qr = window.qrcode(0, 'M');
                qr.addData(url);
                qr.make();
                const contenedor = el('div', { html: qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }) });
                const svg = contenedor.querySelector('svg');
                if (svg) {
                    svg.setAttribute('width', '120');
                    svg.setAttribute('height', '120');
                    svg.setAttribute('aria-hidden', 'true');
                    destino.appendChild(svg);
                    return;
                }
            } catch (err) {
                console.warn('No se pudo generar el QR local:', err);
            }
        }
        destino.appendChild(el('img', { attrs: { src: QR_ESTATICO, width: '120', height: '120', alt: '' } }));
    }

    /** Construye la boleta imprimible de una orden (sin HTML concatenado). */
    function construirBoleta(p) {
        const url = urlSeguimiento(p.id);
        const boleta = el('div', { class: 'boleta-pos' });

        boleta.appendChild(
            el('div', { class: 'boleta-cabecera' }, [
                el('img', { attrs: { src: 'logo.jpg', alt: '', height: '40' } }),
                el('h2', { text: 'TechFix Pro' }),
                el('p', { text: 'Servicio Tecnico de Electronica' })
            ])
        );
        boleta.appendChild(el('hr'));

        for (const [etiqueta, valor] of [
            ['N Orden', mostrarIdOrden(p)],
            ['Cliente', p.cliente],
            ['Telefono', p.telefono],
            ['Equipo', [p.equipo, p.modelo].filter(Boolean).join(' ')],
            ['IMEI', p.imei],
            ['Falla', p.falla],
            ['Accesorios', p.accesorios],
            ['Fecha', fechaCorta(p.fecha)]
        ]) {
            const nodo = parrafo(etiqueta, valor);
            if (nodo) boleta.appendChild(nodo);
        }

        boleta.appendChild(el('hr'));
        for (const [etiqueta, valor] of [
            ['Presupuesto', CLP(p.costo)],
            ['Abono', CLP(p.abono)]
        ]) {
            const nodo = parrafo(etiqueta, valor);
            if (nodo) boleta.appendChild(nodo);
        }
        const total = el('p', { class: 'total' });
        total.appendChild(el('b', { text: 'Saldo: ' }));
        total.appendChild(document.createTextNode(CLP((Number(p.costo) || 0) - (Number(p.abono) || 0))));
        boleta.appendChild(total);
        boleta.appendChild(el('hr'));

        const bloqueQr = el('div', { class: 'boleta-qr' }, [
            el('p', { class: 'nota', text: 'Escanea para ver el estado de tu equipo:' })
        ]);
        ponerQr(bloqueQr, url);
        bloqueQr.appendChild(el('p', { class: 'url-respaldo', text: url }));
        bloqueQr.appendChild(el('p', { class: 'url-respaldo', text: 'Numero de orden: ' + mostrarIdOrden(p) }));
        boleta.appendChild(bloqueQr);

        boleta.appendChild(el('p', { class: 'nota', text: 'El PIN del equipo no se imprime por seguridad.' }));
        boleta.appendChild(el('p', { class: 'gracias', text: 'Equipos no retirados en 60 dias seran donados.' }));
        return boleta;
    }

    /** Pinta la boleta y lanza el dialogo de impresion. */
    function prepararBoleta(p) {
        if (!capaImpresion) {
            console.error('Falta el contenedor de impresion (#capa-impresion).');
            return;
        }
        capaImpresion.innerHTML = '';
        capaImpresion.appendChild(construirBoleta(p));

        let impreso = false;
        const imprimir = () => {
            if (impreso) return;
            impreso = true;
            window.print();
        };
        // Si el logo no carga (sin conexion), igual se imprime.
        const logo = capaImpresion.querySelector('img');
        if (!logo || logo.complete) setTimeout(imprimir, 100);
        else {
            logo.onload = imprimir;
            logo.onerror = imprimir;
            setTimeout(imprimir, 2000);
        }
    }

    function imprimirBoleta(id) {
        const p = proyectos.find((x) => x.id === id);
        if (!p) return;
        prepararBoleta(p);
    }

    /** Ofrece imprimir la boleta justo despues de guardar (la accion esperada). */
    async function ofrecerTicket(p) {
        if (typeof Swal === 'undefined' || !p) return;
        const r = await Swal.fire({
            title: 'Equipo registrado',
            text: 'Quieres imprimir la boleta de ingreso ahora?',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: '🖨 Imprimir ticket',
            cancelButtonText: 'Despues'
        });
        if (r.isConfirmed) prepararBoleta(p);
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
        // El lienzo es blanco: se pinta el fondo en vez de "borrar". Si no, al
        // exportar la firma a JPEG (que no tiene canal alfa) el fondo salia negro.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        firmaTieneTrazos = false;
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

    // Trampa de foco: el tabulador no debe escapar del modal.
    const SELECTOR_ENFOCABLES = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

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

    escuchar(modalFirma, 'keydown', (e) => {
        if (e.key !== 'Tab') return;
        const enfocables = [...modalFirma.querySelectorAll(SELECTOR_ENFOCABLES)].filter((n) => !n.disabled);
        if (!enfocables.length) return;
        const primero = enfocables[0];
        const ultimo = enfocables[enfocables.length - 1];
        if (e.shiftKey && document.activeElement === primero) {
            ultimo.focus();
            e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === ultimo) {
            primero.focus();
            e.preventDefault();
        }
    });

    escuchar('btn-limpiar-firma', 'click', () => {
        if (ctx) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        firmaTieneTrazos = false;
    });
    escuchar('btn-cancelar-firma', 'click', cerrarModalFirma);
    escuchar(modalFirma, 'click', (e) => {
        if (e.target === modalFirma) cerrarModalFirma();
    });
    escuchar(document, 'keydown', (e) => {
        if (e.key === 'Escape' && modalFirma && modalFirma.style.display === 'flex') cerrarModalFirma();
    });

    escuchar('btn-guardar-firma', 'click', async () => {
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
            const tctx = t.getContext('2d');
            tctx.fillStyle = '#ffffff';
            tctx.fillRect(0, 0, t.width, t.height);
            tctx.drawImage(canvas, 0, 0, t.width, t.height);
            const dataUrl = t.toDataURL('image/jpeg', 0.5);

            const uid = currentUser ? currentUser.uid : equipoActual && equipoActual.uid;
            const ahora = Date.now();
            const parche = {
                estado: 'entregado',
                firmaCliente: dataUrl,
                fechaEntrega: ahora,
                uid
            };
            if (!(equipoActual && equipoActual.fechaReparacion)) parche.fechaReparacion = ahora;
            const historial = entradaHistorial('entregado', uid);
            if (historial) parche.historial = historial;

            const idFirmado = currentFirmaId;
            const lote = db.batch ? db.batch() : null;
            if (lote) {
                lote.update(db.collection(COL_EQUIPOS).doc(idFirmado), parche);
                lote.set(
                    db.collection(COL_SEGUIMIENTO).doc(idFirmado),
                    documentoSeguimiento(uid, 'entregado', equipoActual ? equipoActual.modelo : '')
                );
                await lote.commit();
            } else {
                await db.collection(COL_EQUIPOS).doc(idFirmado).update(parche);
                await db
                    .collection(COL_SEGUIMIENTO)
                    .doc(idFirmado)
                    .set(documentoSeguimiento(uid, 'entregado', equipoActual ? equipoActual.modelo : ''));
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
    function avisarVersionNueva(reg) {
        if (typeof Swal === 'undefined') return;
        Swal.fire({
            title: 'Version nueva disponible',
            text: 'Hay una actualizacion de la aplicacion. Recarga para usarla.',
            icon: 'info',
            showCancelButton: true,
            confirmButtonText: 'Recargar ahora',
            cancelButtonText: 'Mas tarde'
        }).then((r) => {
            if (!r.isConfirmed) return;
            if (navigator.serviceWorker.controller) {
                navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
            }
            if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            else window.location.reload();
        });
    }

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker
            .register('sw.js')
            .then((reg) => {
                if (reg.waiting && navigator.serviceWorker.controller) avisarVersionNueva(reg);
                reg.addEventListener('updatefound', () => {
                    const nuevo = reg.installing;
                    if (!nuevo) return;
                    nuevo.addEventListener('statechange', () => {
                        if (nuevo.state === 'installed' && navigator.serviceWorker.controller) avisarVersionNueva(reg);
                    });
                });
            })
            .catch((e) => console.warn('No se pudo registrar el service worker:', e));
    }

    // ========================
    // 9. NAVEGACION
    // ========================
    function mostrarVista(vista) {
        const esTaller = vista === 'taller';
        const vistaTaller = $('vista-taller');
        const vistaCatalogo = $('vista-catalogo');
        if (vistaTaller) vistaTaller.hidden = !esTaller;
        if (vistaCatalogo) vistaCatalogo.hidden = esTaller;
        const btnTaller = $('btn-nav-taller');
        const btnCatalogo = $('btn-nav-catalogo');
        if (btnTaller) {
            btnTaller.setAttribute('aria-current', esTaller ? 'page' : 'false');
            btnTaller.classList.toggle('activo', esTaller);
        }
        if (btnCatalogo) {
            btnCatalogo.setAttribute('aria-current', esTaller ? 'false' : 'page');
            btnCatalogo.classList.toggle('activo', !esTaller);
        }
    }
    escuchar('btn-nav-taller', 'click', () => mostrarVista('taller'));
    escuchar('btn-nav-catalogo', 'click', () => mostrarVista('catalogo'));

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
                (error) => avisarError('Error al cargar el catalogo', normalizarError(error))
            );
    }

    function renderizarCatalogo() {
        const lista = $('lista-catalogo');
        if (!lista) return;
        lista.innerHTML = '';

        const txt = filtroCatalogo.trim().toLowerCase();
        const filtrados = catalogoDB.filter((c) =>
            [c.marca, c.modelo, c.reparacion].filter(Boolean).join(' ').toLowerCase().includes(txt)
        );

        if (contadorCatalogo) {
            contadorCatalogo.textContent = filtrados.length + (filtrados.length === 1 ? ' servicio' : ' servicios');
        }

        if (!filtrados.length) {
            lista.appendChild(
                el('p', {
                    class: 'sin-resultados',
                    text: catalogoDB.length ? 'No se encontraron precios.' : 'Aun no hay precios guardados.'
                })
            );
            return;
        }

        const frag = document.createDocumentFragment();
        [...filtrados]
            .sort(
                (a, b) =>
                    String(a.marca).localeCompare(String(b.marca)) || String(a.modelo).localeCompare(String(b.modelo))
            )
            .forEach((data) => {
                const card = el('article', { class: 'tarjeta-proyecto tarjeta-catalogo' }, [
                    el('h3', { text: [data.marca, data.modelo].filter(Boolean).join(' - ') }),
                    el('p', { text: 'Reparacion: ' + (data.reparacion || '') }),
                    el('p', { class: 'precio', text: CLP(data.precio) })
                ]);
                card.appendChild(
                    el('div', { class: 'acciones-tarjeta' }, [
                        el('button', {
                            class: 'btn-icon btn-editar',
                            text: '✏️ Editar',
                            attrs: {
                                type: 'button',
                                'data-accion': 'editar-catalogo',
                                'data-id': data.id,
                                'aria-label':
                                    'Editar el precio de ' + [data.marca, data.modelo].filter(Boolean).join(' ')
                            }
                        }),
                        el('button', {
                            class: 'btn-icon btn-eliminar',
                            text: '🗑 Eliminar',
                            attrs: {
                                type: 'button',
                                'data-accion': 'borrar-catalogo',
                                'data-id': data.id,
                                'aria-label':
                                    'Eliminar el precio de ' + [data.marca, data.modelo].filter(Boolean).join(' ')
                            }
                        })
                    ])
                );
                frag.appendChild(card);
            });
        lista.appendChild(frag);
    }

    const listaCatalogo = $('lista-catalogo');
    escuchar(listaCatalogo, 'click', (e) => {
        const bBorrar = e.target.closest && e.target.closest('[data-accion="borrar-catalogo"]');
        if (bBorrar) {
            eliminarCatalogo(bBorrar.getAttribute('data-id'));
            return;
        }
        const bEditar = e.target.closest && e.target.closest('[data-accion="editar-catalogo"]');
        if (bEditar) editarCatalogo(bEditar.getAttribute('data-id'));
    });

    const catBuscador = $('cat-buscador');
    escuchar(
        catBuscador,
        'input',
        debounce(() => {
            filtroCatalogo = catBuscador.value || '';
            renderizarCatalogo();
        }, 200)
    );

    async function editarCatalogo(id, datosDirectos = null) {
        const previo = catalogoDB.find((x) => x.id === id);
        if (!previo) return false;

        let valores = datosDirectos;
        if (!valores && typeof Swal !== 'undefined') {
            const respuesta = await Swal.fire({
                title: 'Editar precio de catalogo',
                html:
                    '<label for="edit-cat-marca" class="etiqueta-modal">Marca</label>' +
                    '<input id="edit-cat-marca" type="text" maxlength="60" value="' + escapeHtml(previo.marca || '') + '">' +
                    '<label for="edit-cat-modelo" class="etiqueta-modal">Modelo</label>' +
                    '<input id="edit-cat-modelo" type="text" maxlength="80" value="' + escapeHtml(previo.modelo || '') + '">' +
                    '<label for="edit-cat-rep" class="etiqueta-modal">Reparacion</label>' +
                    '<input id="edit-cat-rep" type="text" maxlength="120" value="' + escapeHtml(previo.reparacion || '') + '">' +
                    '<label for="edit-cat-precio" class="etiqueta-modal">Precio ($)</label>' +
                    '<input id="edit-cat-precio" type="number" min="0" step="1" value="' + Number(previo.precio || 0) + '">',
                showCancelButton: true,
                confirmButtonText: 'Guardar',
                cancelButtonText: 'Cancelar',
                preConfirm: () => {
                    const marca = document.getElementById('edit-cat-marca').value.trim();
                    const modelo = document.getElementById('edit-cat-modelo').value.trim();
                    const reparacion = document.getElementById('edit-cat-rep').value.trim();
                    const precio = Number(document.getElementById('edit-cat-precio').value);
                    if (!marca || !modelo || !reparacion) {
                        return Swal.showValidationMessage('Completa marca, modelo y reparacion.');
                    }
                    if (!Number.isFinite(precio) || precio < 0) {
                        return Swal.showValidationMessage('El precio no puede ser negativo.');
                    }
                    return { marca, modelo, reparacion, precio };
                }
            });
            valores = respuesta && respuesta.value ? respuesta.value : null;
        }
        if (!valores) return false;

        const marca = String(valores.marca ?? previo.marca ?? '').trim();
        const modelo = String(valores.modelo ?? previo.modelo ?? '').trim();
        const reparacion = String(valores.reparacion ?? previo.reparacion ?? '').trim();
        const precio = Number(valores.precio ?? previo.precio ?? 0);
        if (!marca || !modelo || !reparacion || !Number.isFinite(precio) || precio < 0) return false;

        try {
            const uid = currentUser ? currentUser.uid : previo.uid;
            await db.collection(COL_CATALOGO).doc(id).update({ uid, marca, modelo, reparacion, precio });
            toast('success', 'Catalogo actualizado');
            return true;
        } catch (err) {
            avisarError('No se pudo actualizar el precio', err);
            return false;
        }
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

    escuchar('catalogo-form', 'submit', async (e) => {
        e.preventDefault();
        if (!currentUser) return;
        const precio = Number($('cat-precio').value);
        if (!Number.isFinite(precio) || precio < 0) {
            Swal.fire('Precio invalido', 'El precio no puede ser negativo.', 'warning');
            return;
        }
        const btn = e.target.querySelector('button[type="submit"]');
        const etiqueta = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Guardando...';
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
            btn.textContent = etiqueta;
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

    escuchar('marca', 'change', (e) => {
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

    escuchar('modelo', 'change', (e) => {
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

    escuchar('tipo-reparacion', 'change', (e) => {
        const repId = e.target.value;
        const item = repId && repId !== 'Otra' ? catalogoDB.find((c) => c.id === repId) : null;
        $('costo').value = item ? item.precio : '';
    });

    // ========================
    // 12. BUSCADOR, FILTRO Y ORDENAMIENTO
    // ========================
    escuchar(buscador, 'input', debounce(renderizarProyectos, 250));
    escuchar(filtroEstado, 'change', renderizarProyectos);
    escuchar(ordenarProyectos, 'change', renderizarProyectos);

    // ========================
    // 13. EXPORTACION A CSV
    // ========================
    /** Escapa un campo CSV (comillas dobles y separadores). */
    function campoCsv(valor) {
        return '"' + String(valor === null || valor === undefined ? '' : valor).replace(/"/g, '""') + '"';
    }

    function exportCSV(filas) {
        const cabeceras = [
            'Numero de orden',
            'ID',
            'Fecha ingreso',
            'Cliente',
            'Telefono',
            'Marca',
            'Modelo',
            'IMEI',
            'Falla',
            'Estado',
            'Costo',
            'Abono',
            'Saldo',
            'Fecha reparacion',
            'Fecha entrega'
        ];
        const lineas = [cabeceras.map(campoCsv).join(',')];
        for (const p of filas) {
            lineas.push(
                [
                    mostrarIdOrden(p),
                    p.id,
                    fechaCorta(p.fecha),
                    p.cliente || '',
                    p.telefono || '',
                    p.equipo || '',
                    p.modelo || '',
                    p.imei || '',
                    p.falla || '',
                    ESTADO_TEXTO[p.estado] || p.estado || '',
                    Number(p.costo) || 0,
                    Number(p.abono) || 0,
                    (Number(p.costo) || 0) - (Number(p.abono) || 0),
                    p.fechaReparacion ? new Date(p.fechaReparacion).toLocaleDateString('es-CL') : '',
                    p.fechaEntrega ? new Date(p.fechaEntrega).toLocaleDateString('es-CL') : ''
                ]
                    .map(campoCsv)
                    .join(',')
            );
        }
        // BOM: sin el, Excel abre las tildes en latin-1 y se ven mal.
        return '\ufeff' + lineas.join('\r\n');
    }

    function descargarArchivo(nombre, contenido, tipo) {
        try {
            const blob = new Blob([contenido], { type: tipo });
            if (!window.URL || !window.URL.createObjectURL) throw new Error('createObjectURL no disponible');
            const url = window.URL.createObjectURL(blob);
            const enlace = el('a', { attrs: { href: url, download: nombre } });
            document.body.appendChild(enlace);
            enlace.click();
            enlace.remove();
            setTimeout(() => window.URL.revokeObjectURL(url), 1000);
            return true;
        } catch (err) {
            console.warn('No se pudo descargar el archivo:', err);
            return false;
        }
    }

    escuchar('btn-exportar', 'click', () => {
        // Se exporta lo que el tecnico esta viendo (buscador + filtro), no
        // siempre todo: antes el boton ignoraba el filtro activo.
        const visibles = proyectosFiltrados();
        if (!visibles.length) {
            Swal.fire('Vacio', 'No hay equipos para exportar con el filtro actual.', 'info');
            return;
        }
        const nombre = 'techfix_ordenes_' + new Date().toISOString().split('T')[0] + '.csv';
        const ok = descargarArchivo(nombre, exportCSV(visibles), 'text/csv;charset=utf-8;');
        if (ok) toast('success', visibles.length + ' orden(es) exportadas');
        else if (typeof Swal !== 'undefined') Swal.fire('No se pudo exportar', 'El navegador bloqueo la descarga.', 'error');
    });

    // ========================
    // 14. MIGRACION DE DATOS ANTIGUOS (ejecucion manual, una sola vez)
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
                lote.set(
                    db.collection(COL_SEGUIMIENTO).doc(doc.id),
                    documentoSeguimiento(uid, data.estado || 'ingresado', data.modelo)
                );
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
    // 15. INDICADOR DE RED
    // ========================
    let temporizadorRed = null;
    function actualizarEstadoRed() {
        const statusObj = $('red-status');
        if (!statusObj) return;
        if (temporizadorRed) {
            clearTimeout(temporizadorRed);
            temporizadorRed = null;
        }
        const enLinea = typeof navigator.onLine === 'boolean' ? navigator.onLine : true;
        statusObj.textContent = enLinea ? '📶 Online' : '📵 Offline (se guardara al recuperar la conexion)';
        statusObj.className = 'badge-estado ' + (enLinea ? 'estado-reparado' : 'estado-revision');
        statusObj.style.display = 'inline-block';
        if (enLinea) {
            // Solo se oculta el aviso de "en linea": el de offline debe quedar visible.
            temporizadorRed = setTimeout(() => {
                statusObj.style.display = 'none';
            }, 3000);
        }
    }
    window.addEventListener('online', actualizarEstadoRed);
    window.addEventListener('offline', actualizarEstadoRed);

    // ========================
    // API interna (navegacion por consola y pruebas automatizadas)
    // ========================
    window.TechFix = {
        iniciada: true,
        ESTADOS,
        ESTADO_TEXTO,
        PLAZO_ENTREGA_DIAS,
        URL_QR_LIB,
        migrar,
        escapeHtml,
        normalizarTelefono,
        urlSeguimiento,
        enviarWhatsApp,
        imprimirBoleta,
        construirBoleta,
        compartirTicket,
        cambiarEstado,
        editarProyecto,
        verHistorial,
        archivarProyecto,
        eliminarProyectoPermanente,
        editarCatalogo,
        eliminarCatalogo,
        revelarPin,
        verFoto,
        siguienteIdOrden,
        fechaCorta,
        pesoEnBytes,
        diasEnTaller,
        permiteEstado,
        renderizarProyectos,
        renderizarCatalogo,
        mostrarVista,
        cambiarContrasena,
        exportCSV,
        actualizarEstadoRed,
        proyectos: () => proyectos.slice(),
        catalogo: () => catalogoDB.slice()
    };

    // ========================
    // ARRANQUE
    // ========================
    // La libreria de QR se pide en segundo plano: si no llega (sin red), el
    // ticket usa el QR estatico y la URL impresa.
    cargarScript(URL_QR_LIB).catch(() => {});
    actualizarEstadoRed();
})();
