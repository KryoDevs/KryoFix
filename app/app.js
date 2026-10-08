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
    const firebaseConfig = window.KryoFixEntorno?.firebase;

    const COL_EQUIPOS = 'equipos';
    const COL_CATALOGO = 'catalogo';
    const COL_SEGUIMIENTO = 'seguimiento';

    // Tope de documentos que se mantienen en memoria (la lista se filtra en el
    // cliente). Con mas de 500 ordenes historicas hace falta paginacion real.
    const SPARK = window.KryoFixEntorno?.modo === 'spark';
    const LIMITE_EQUIPOS = SPARK ? 100 : 500;

    // Dias que un equipo listo puede esperar al cliente antes de avisar.
    const PLAZO_ENTREGA_DIAS = 30;
    const AVISO_TALLER_DIAS = 7;

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
        if (!firebaseConfig?.projectId) faltantes.push('Configuración del taller');
        if (typeof firebase === 'undefined') faltantes.push('Firebase');
        if (typeof Swal === 'undefined') faltantes.push('SweetAlert2');
        if (!window.TechFixDominio) faltantes.push('Dominio');
        if (!window.KryoFixBorradores || !window.KryoFixOrdenes || !window.KryoFixTallerServicio || !window.KryoFixTallerDominio || !window.KryoFixFicha) faltantes.push('Módulos de órdenes');
        return faltantes;
    }

    if (dependenciasFaltantes().length) {
        // Sin Firebase no hay app: se avisa y no se sigue ejecutando.
        faltaDependencia(dependenciasFaltantes());
        window.TechFix = window.TechFix || { iniciada: false, sinDependencias: true };
        return;
    }

    const Dominio = window.TechFixDominio;
    const { ESTADOS, ESTADO_TEXTO, PRIORIDAD_TEXTO, PRIORIDAD_PESO,
        escapeHtml, normalizarTelefono, permiteEstado, calcularSaldo } = Dominio;

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
    let sincronizacionOrdenes = null;
    let errorSincronizacion = false;
    const borradores = window.KryoFixBorradores.crear(() => Dominio.crearProcedimiento());
    const ordenesRepositorio = window.KryoFixOrdenes.crear({
        db, usuario: () => currentUser, enLinea: () => navigator.onLine !== false,
        timestampServidor: () => CampoValor.serverTimestamp()
    });
    let problemaAplicado = null;
    let catalogoDB = [];
    let unsubscribeDB = null;
    let unsubscribeCatalogo = null;
    let currentUser = null;
    let epocaSesion = 0;
    let currentFirmaId = null;
    let firmaBaseRevision = 0;
    let seleccionFoto = 0;
    let procesandoFoto = false;
    let fotoComprimidaBase64 = null;
    let clienteSeleccionadoId = null;
    let ingresoPendienteId = null;
    let firmaTieneTrazos = false;
    let isDrawing = false;
    let punteroFirma = null;
    let solicitudFirma = 0;
    let ultimoFoco = null;
    let filtroCatalogo = '';
    const pinesVisibles = new Set();
    const tallerServicio = window.KryoFixTallerServicio.crear({ db, usuario: () => currentUser,
        enLinea: () => navigator.onLine !== false, timestampServidor: () => CampoValor.serverTimestamp() });
    const ficha = window.KryoFixFicha.crear({ servicio: tallerServicio, usuario: () => currentUser,
        alOrden: p => { const i = proyectos.findIndex(x => x.id === p.id); if (i >= 0) proyectos[i] = p; else proyectos.push(p); },
        procedimiento: p => seccionProcedimiento(p),
        procedimientoPendiente: p => borradores.obtener(p.id, p.procedimiento).sucio, alCerrar: () => { window.history.replaceState(null, '', window.location.pathname + window.location.search); renderizarProyectos(); },
        urlSeguimiento });
    async function migrarArchivoNuevo(id, tipo, uid, epoca) {
        if (SPARK) return; // La evidencia limitada permanece privada en Firestore.
        if (!currentUser?.getIdToken || currentUser.uid !== uid || epocaSesion !== epoca) return;
        try {
            const capacidad = await tallerServicio.remoto('capacidades');
            if (!currentUser || currentUser.uid !== uid || epocaSesion !== epoca) return;
            if (!capacidad.storage) throw new Error('Storage aún no configurado');
            await tallerServicio.remoto('migrar-archivo', { id, tipo });
        } catch (_e) {
            if (currentUser?.uid === uid && epocaSesion === epoca) toast('warning', 'Orden guardada. Archivo conservado en Firestore; migra desde Evidencias cuando Storage esté disponible.');
        }
    }
    escuchar('btn-gestion', 'click', () => ficha.gestion());
    escuchar('btn-cliente-recurrente', 'click', async () => {
        if (!currentUser) return;
        const uid = currentUser.uid;
        try {
            const clientes = await tallerServicio.listar(uid, 'clientes');
            if (!currentUser || currentUser.uid !== uid) return;
            const telefono = normalizarTelefono($('telefono').value);
            const encontrados = clientes.filter(c => c.telefono === telefono);
            if (!encontrados.length) { Swal.fire('Sin coincidencias', 'No hay clientes guardados con ese teléfono. El ingreso creará un registro nuevo.', 'info'); return; }
            const opciones = Object.fromEntries(encontrados.map(c => [c.id, c.nombre + ' · ' + c.telefono]));
            const r = await Swal.fire({ title: 'Seleccionar cliente existente', input: 'select', inputOptions: opciones,
                showCancelButton: true, confirmButtonText: 'Usar cliente', cancelButtonText: 'Cancelar' });
            if (!currentUser || currentUser.uid !== uid || !r.isConfirmed) return;
            const c = encontrados.find(c => c.id === r.value);
            if (c) { $('cliente').value = c.nombre; $('telefono').value = c.telefono; clienteSeleccionadoId = c.id; }
        } catch (err) { avisarError('No se pudo consultar la agenda', err); }
    });
    escuchar('cliente', 'input', () => { clienteSeleccionadoId = null; });
    escuchar('telefono', 'input', () => { clienteSeleccionadoId = null; });

    // ========================
    // UTILIDADES
    // ========================

    const CLP = Dominio.formatearCLP;

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
                ? 'Cuenta no autorizada o reglas pendientes. Comprueba que se publicaron las reglas con el UID de tu usuario del taller.'
                : err?.code === 'resource-exhausted' ? 'Se alcanzó una cuota de Firebase. No actives facturación: revisa Uso en la consola y espera el restablecimiento de la cuota aplicable.'
                : (err?.message || 'Ocurrió un problema. Revisa tu conexión e inténtalo de nuevo.'),
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
        epocaSesion++;
        if (form) {
            form.inert = false;
            const guardar = form.querySelector('button[type="submit"]');
            if (guardar) { guardar.disabled = false; guardar.textContent = '💾 Guardar y generar ticket'; }
        }
        borradores.limpiar();
        ficha.limpiar();
        if (typeof Swal !== 'undefined') Swal.close();
        sincronizacionOrdenes = null;
        errorSincronizacion = false;
        actualizarEstadoRed();
        proyectos = [];
        catalogoDB = [];
        pinesVisibles.clear();
        filtroCatalogo = '';
        if (form) reiniciarFormulario();
        if ($('lista-catalogo')) $('lista-catalogo').replaceChildren();
        if (capaImpresion) capaImpresion.replaceChildren();
        if (modalFirma) cerrarModalFirma();
        if (userEmailDisplay) userEmailDisplay.textContent = '';
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

        if (user && window.KryoFixEntorno?.propietarioUid && user.uid !== window.KryoFixEntorno.propietarioUid) {
            currentUser = null;
            limpiarSesionEnPantalla();
            loginScreen.style.display = 'flex'; appContent.style.display = 'none';
            auth.signOut().catch(() => {});
            Swal.fire('Cuenta no autorizada', 'Inicia sesión con el usuario del taller cuyo UID se configuró al publicar. No se consultaron sus datos.', 'warning');
            return;
        }
        if (user) {
            const mismoUsuario = currentUser && currentUser.uid === user.uid;
            if (!mismoUsuario) limpiarSesionEnPantalla();
            currentUser = user;
            loginScreen.style.display = 'none';
            appContent.style.display = 'block';
            if (userEmailDisplay) userEmailDisplay.textContent = user.email + (SPARK ? ' · Spark: sin facturación' : '');
            cargarDatos();
            cargarCatalogo();
            if (!mismoUsuario) {
                toast('success', 'Bienvenido!');
                const id = new URLSearchParams(window.location.hash.slice(1)).get('orden');
                if (id && Dominio.extraerCodigoOrden(id)) ficha.abrir(id);
            }
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
        if (borradores.pendientes().length || ficha.tienePendientes()) {
            const respuesta = await Swal.fire({ title: '¿Salir con cambios pendientes?',
                text: 'Los borradores se conservan solo en esta pestaña y se borrarán al salir. Una operación ya enviada puede completarse en el servidor.',
                icon: 'warning', showCancelButton: true, confirmButtonText: 'Salir y descartar borradores', cancelButtonText: 'Volver' });
            if (!respuesta.isConfirmed) return;
        }
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
        const uid = currentUser.uid;
        unsubscribeDB = ordenesRepositorio.suscribir(uid, LIMITE_EQUIPOS,
                (snapshot) => {
                    if (!currentUser || currentUser.uid !== uid) return;
                    sincronizacionOrdenes = snapshot.metadata || null;
                    errorSincronizacion = false;
                    proyectos = [];
                    snapshot.forEach((doc) => proyectos.push({ ...doc.data(), id: doc.id }));
                    loader.style.display = 'none';
                    revisarRecordatorios();
                    renderizarProyectos();
                    actualizarDashboard();
                    actualizarEstadoRed();
                },
                (error) => {
                    if (!currentUser || currentUser.uid !== uid) return;
                    errorSincronizacion = true;
                    actualizarEstadoRed();
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

        const saldoPorCobrar = proyectos.reduce(
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
            filtroEstado.value = destino === 'saldo' ? 'con-saldo' : destino;
            if (destino === 'saldo' && ordenarProyectos) ordenarProyectos.value = 'saldo';
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

    function construirTarjeta(p) {
        const saldo = calcularSaldo(p);
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

        if (p.prioridad && p.prioridad !== 'normal' && PRIORIDAD_TEXTO[p.prioridad]) {
            tarjeta.appendChild(el('span', { class: 'badge-prioridad prioridad-' + p.prioridad, text: PRIORIDAD_TEXTO[p.prioridad] }));
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

        tarjeta.appendChild(el('p', { class: 'proxima-accion', text: 'Próxima acción: ' + window.KryoFixTallerDominio.siguienteAccion(p) }));
        tarjeta.appendChild(el('p', { class: 'tarjeta-falla', text: 'Falla: ' + (p.falla || 'Sin detalle') }));
        if (p.problemaComun) tarjeta.appendChild(el('p', { class: 'detalle-extra', text: 'Síntoma de recepción: ' + p.problemaComun.titulo + ' (pendiente de validación técnica)' }));
        tarjeta.appendChild(seccionProcedimiento(p));
        if (p.notas) tarjeta.appendChild(el('p', { class: 'nota-interna', text: 'Nota interna: ' + p.notas }));
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

        if (p.archivos) tarjeta.appendChild(el('p', { class: 'detalle-extra', text: 'Archivos privados: consultar la sección Evidencias de la ficha.' }));
        const acciones = el('div', { class: 'acciones-tarjeta' });
        acciones.appendChild(el('button', { class: 'btn-icon btn-ficha', text: 'Abrir ficha de trabajo',
            attrs: { type: 'button', 'data-accion': 'ficha', 'data-id': p.id } }));
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
        const secundarias = el('details', { class: 'acciones-secundarias' }, [el('summary', { text: 'Más acciones' })]);
        for (const boton of [...acciones.querySelectorAll('button')]) {
            if (!boton.classList.contains('btn-ficha')) secundarias.appendChild(boton);
        }
        acciones.appendChild(secundarias);
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
            if (filtro === 'con-saldo') return calcularSaldo(p) > 0;
            if (filtro !== 'todos') return p.estado === filtro;
            return true;
        });

        if (criterio === 'prioridad') {
            lista.sort((a, b) => (PRIORIDAD_PESO[b.prioridad] || 1) - (PRIORIDAD_PESO[a.prioridad] || 1));
        } else if (criterio === 'antiguos') {
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
        renderizarFiltrosRapidos();
        if (contadorResultados) {
            contadorResultados.textContent = filtrados.length + (filtrados.length === 1 ? ' orden' : ' ordenes');
        }

        // El evento toggle se entrega de forma asíncrona; capturar también el DOM
        // antes de reconstruir evita perder una apertura seguida de un snapshot.
        for (const tarjeta of listaProyectos.children) {
            const detalle = tarjeta.querySelector('.procedimiento');
            if (detalle) borradores.recordarApertura(tarjeta.getAttribute('data-id'), detalle.open);
        }
        const activo = document.activeElement;
        const tarjetaActiva = activo && activo.closest('[data-id]');
        const focoId = tarjetaActiva && tarjetaActiva.getAttribute('data-id');
        const campoFoco = activo && activo.getAttribute('data-proc-campo');
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
        if (focoId && campoFoco) {
            const tarjeta = [...listaProyectos.children].find(n => n.getAttribute('data-id') === focoId);
            const campo = tarjeta && [...tarjeta.querySelectorAll('[data-proc-campo]')].find(n => n.getAttribute('data-proc-campo') === campoFoco);
            if (campo && !campo.disabled) campo.focus({ preventScroll: true });
        }
    }

    /** Aviso de equipos listos que el cliente no ha venido a retirar. */
    function revisarRecordatorios() {
        renderizarAvisos(
            proyectos.filter((p) => {
                const desde = Number(p.fechaReparacion || p.timestamp);
                const d = desde ? Math.floor((Date.now() - desde) / 86400000) : null;
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
            case 'ficha':
                ficha.abrir(id);
                break;
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
    const MAX_FOTO_BYTES = (SPARK ? 80 : 200) * 1024;

    escuchar('foto-evidencia', 'change', function (e) {
        const seleccion = ++seleccionFoto;
        procesandoFoto = false;
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
            if (seleccion !== seleccionFoto) return;
            procesandoFoto = false;
            if (typeof Swal !== 'undefined') Swal.fire('Error', 'No se pudo leer la imagen.', 'error');
        };
        reader.onload = function (ev) {
            if (seleccion !== seleccionFoto) return;
            const img = new Image();
            img.onerror = () => {
                if (seleccion !== seleccionFoto) return;
                procesandoFoto = false;
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'El archivo no es una imagen valida.', 'error');
            };
            img.onload = function () {
                if (seleccion !== seleccionFoto) return;
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

                procesandoFoto = false;
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
        procesandoFoto = true;
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

    function refrescarProblemas() {
        const teniaAsociacion = !!problemaAplicado;
        problemaAplicado = null;
        $('btn-quitar-problema').hidden = true;
        $('problema-resultado').textContent = teniaAsociacion && $('falla').value
            ? 'Se quitó la asociación anterior. El texto de síntomas se conserva; revísalo y aplica una sugerencia para el equipo actual.' : '';
        $('problema-detalle').replaceChildren();
        $('btn-aplicar-problema').disabled = true;
        const selector = $('problema-comun');
        selector.replaceChildren(el('option', { text: '-- Selecciona un síntoma --', attrs: { value: '' } }));
        const problemas = Dominio.obtenerProblemas(valorMarca(), valorModelo(), proyectos);
        selector.disabled = !problemas.length;
        $('problemas-contexto').textContent = problemas.length ?
            'Revisión para ' + valorMarca() + ' ' + valorModelo() + '. Sugerencias generales, priorizadas por tu historial de este modelo.' :
            'Selecciona marca y modelo para ver sugerencias.';
        for (const problema of problemas) selector.appendChild(el('option', {
            text: problema.titulo + (problema.registros ? ' · ' + problema.registros + ' registro(s) en este modelo' : ''),
            attrs: { value: problema.id }
        }));
    }

    escuchar('problema-comun', 'change', () => {
        const problema = Dominio.obtenerProblemas(valorMarca(), valorModelo(), proyectos).find(p => p.id === $('problema-comun').value);
        $('btn-aplicar-problema').disabled = !problema;
        $('problema-detalle').replaceChildren();
        if (problema) $('problema-detalle').append(
            el('p', { text: problema.comprobacion }), el('p', { text: problema.contexto }),
            el('p', { text: 'Al usarlo se añade el síntoma sin borrar tus notas y se prepara una guía de evaluación. No autoriza reparaciones ni cambia precios.' })
        );
    });

    escuchar('btn-aplicar-problema', 'click', () => {
        const problema = Dominio.obtenerProblemas(valorMarca(), valorModelo(), proyectos).find(p => p.id === $('problema-comun').value);
        if (!problema) return;
        const detalle = $('falla').value.trim();
        const texto = detalle.includes(problema.titulo) ? detalle : [detalle, problema.titulo].filter(Boolean).join(' · ');
        if (texto.length > $('falla').maxLength) {
            $('problema-resultado').textContent = 'No se aplicó: el detalle supera 200 caracteres. Acórtalo sin perder información y vuelve a intentarlo.';
            return;
        }
        $('falla').value = texto;
        problemaAplicado = { id: problema.id, titulo: problema.titulo, marca: valorMarca(), modelo: valorModelo() };
        $('btn-quitar-problema').hidden = false;
        $('problema-resultado').textContent = 'Aplicado: ' + problema.titulo + '. La guía se guardará al registrar el equipo. Puedes editar los síntomas; presupuesto y notas no se modificaron.';
    });

    escuchar('btn-quitar-problema', 'click', () => {
        refrescarProblemas();
        $('problema-resultado').textContent = 'Asociación quitada; se usará diagnóstico inicial. El texto de síntomas se conserva para que puedas editarlo.';
    });

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
        seleccionFoto++;
        procesandoFoto = false;
        form.reset();
        clienteSeleccionadoId = null;
        ingresoPendienteId = null;
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
        refrescarProblemas();
    }

    escuchar('btn-limpiar-ingreso', 'click', async () => {
        if (form.inert) return;
        const respuesta = await Swal.fire({ title: '¿Limpiar la recepción?',
            text: 'Se descartarán los datos escritos aquí, no las órdenes guardadas. Si hubo un error de conexión, revisa el historial antes de repetir el ingreso.',
            icon: 'warning', showCancelButton: true, confirmButtonText: 'Limpiar formulario', cancelButtonText: 'Volver' });
        if (respuesta.isConfirmed && !form.inert) reiniciarFormulario();
    });

    escuchar(form, 'submit', async (e) => {
        e.preventDefault();
        const sesionDeIngreso = epocaSesion;
        if (!currentUser) {
            if (typeof Swal !== 'undefined') Swal.fire('Sesion requerida', 'Inicia sesion primero.', 'error');
            return;
        }
        marcarFormulario(null);
        if (procesandoFoto) { Swal.fire('Fotografía en proceso', 'Espera a que termine la compresión de la evidencia antes de guardar.', 'info'); return; }

        const cliente = $('cliente').value.trim();
        const telefono = normalizarTelefono($('telefono').value);
        const marca = valorMarca();
        const modelo = valorModelo();
        const costo = Number($('costo').value);
        const abono = Number($('abono').value || 0);

        // ---- Validaciones de negocio (ademas de las de firestore.rules) ----
        const fallo = (campo, titulo, mensaje) => {
            marcarFormulario(campo);
            const nodo = $(campo);
            if (nodo) nodo.focus();
            if (typeof Swal !== 'undefined') Swal.fire(titulo, mensaje, 'warning');
        };
        if (!cliente || cliente.length > 120) return fallo('cliente', 'Falta el cliente', 'Escribe el nombre del cliente.');
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
            clienteId: clienteSeleccionadoId,
            idOrden: 'Pendiente de asignación',
            cliente,
            telefono,
            equipo: marca,
            modelo,
            imei: $('imei').value.trim(),
            pin: $('pin').value,
            accesorios: $('accesorios').value.trim(),
            falla: fallaFinal,
            problemaComun: problemaAplicado && problemaAplicado.marca === marca && problemaAplicado.modelo === modelo
                ? { id: problemaAplicado.id, titulo: problemaAplicado.titulo } : null,
            procedimiento: problemaAplicado && problemaAplicado.marca === marca && problemaAplicado.modelo === modelo
                ? Dominio.procedimientoParaProblema(problemaAplicado.id, marca, modelo) : Dominio.crearProcedimiento(),
            estado,
            prioridad: $('prioridad').value,
            notas: $('notas').value.trim(),
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
        form.inert = true;
        try {
            const imei = nuevoProyecto.imei.replace(/\s+/g, '').toLowerCase();
            if (imei && proyectos.some(p => p.estado !== 'entregado' && String(p.imei || '').replace(/\s+/g, '').toLowerCase() === imei)) {
                const confirmar = await Swal.fire({ title: 'Posible ingreso duplicado',
                    text: 'Existe una orden activa cargada con este IMEI/serie. Revisa el historial antes de continuar.',
                    icon: 'warning', showCancelButton: true, confirmButtonText: 'Registrar de todos modos', cancelButtonText: 'Revisar' });
                if (!confirmar.isConfirmed) return;
            }
            if (!currentUser || currentUser.uid !== nuevoProyecto.uid || sesionDeIngreso !== epocaSesion) return;
            ingresoPendienteId = ingresoPendienteId || tallerServicio.nuevoId();
            const creado = await tallerServicio.crearOrden(currentUser.uid, nuevoProyecto, ingresoPendienteId);
            if (!currentUser || currentUser.uid !== nuevoProyecto.uid || sesionDeIngreso !== epocaSesion) return;
            const ref = { id: creado.id };
            nuevoProyecto.idOrden = creado.idOrden;

            reiniciarFormulario();
            if (filtroEstado.value === 'entregado') filtroEstado.value = 'activos';
            toast('success', 'Equipo guardado - Orden ' + nuevoProyecto.idOrden);
            if (listaProyectos.scrollIntoView) listaProyectos.scrollIntoView({ behavior: 'smooth' });
            // El snapshot puede no haber llegado todavia: se usa el registro
            // recien creado como respaldo para poder imprimir el ticket ya.
            const recienCreado = proyectos.find((x) => x.id === ref.id) || creado;
            ofrecerTicket(recienCreado);
            if (creado.evidencia) migrarArchivoNuevo(creado.id, 'evidencia', nuevoProyecto.uid, sesionDeIngreso);
        } catch (err) {
            if (sesionDeIngreso === epocaSesion) avisarError('No se pudo guardar el equipo', err);
        } finally {
            if (sesionDeIngreso === epocaSesion) {
                btnSubmit.disabled = false;
                form.inert = false;
                btnSubmit.textContent = etiqueta;
            }
        }
    });

    // ========================
    // 6. ACCIONES DE TARJETA (ESTADO, EDICION, HISTORIAL, ENTREGA)
    // ========================
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
            if (!currentUser) return;
            await tallerServicio.ejecutar({ id, uid: currentUser.uid, revision: previo.revisionOrden || 0,
                opId: tallerServicio.nuevoId(), accion: 'estado', datos: { estado: nuevoEstado } });

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
                    '<label for="edit-notas" class="etiqueta-modal">Notas internas</label>' +
                    '<input id="edit-notas" maxlength="240" value="' + escapeHtml(previo.notas || '') + '">' +
                    '<label for="edit-prioridad" class="etiqueta-modal">Prioridad</label>' +
                    '<select id="edit-prioridad">' + Dominio.PRIORIDADES.map((v) => '<option value="' + v + '"' + (v === (previo.prioridad || 'normal') ? ' selected' : '') + '>' + PRIORIDAD_TEXTO[v] + '</option>').join('') + '</select>' +
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
                    return { cliente, telefono, falla, accesorios, costo, abono, notas: $('edit-notas').value.trim(), prioridad: $('edit-prioridad').value };
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

        if (!cliente || cliente.length > 120 || telefono.length < 8 || !Number.isFinite(costo) || costo < 0 || !Number.isFinite(abono) || abono < 0 || abono > costo) {
            if (typeof Swal !== 'undefined') Swal.fire('Datos invalidos', 'Revisa el cliente, telefono y montos.', 'warning');
            return false;
        }

        try {
            if (!currentUser) return false;
            await tallerServicio.ejecutar({ id, uid: currentUser.uid, revision: previo.revisionOrden || 0,
                opId: tallerServicio.nuevoId(), accion: 'editar', datos: { cliente, telefono, falla, accesorios,
                    notas: String(valores.notas ?? previo.notas ?? '').slice(0, 240),
                    prioridad: valores.prioridad || previo.prioridad || 'normal', costo, abono } });
            toast('success', 'Orden actualizada');
            return true;
        } catch (err) {
            avisarError('No se pudo actualizar la orden', err);
            return false;
        }
    }

    /** Guía privada: el borrador vive en memoria de sesión, no en la tarjeta. */
    function seccionProcedimiento(p) {
        const entrada = borradores.obtener(p.id, p.procedimiento);
        const uid = currentUser && currentUser.uid;
        const vigente = () => currentUser && currentUser.uid === uid && borradores.vigente(p.id, entrada);
        const actual = () => proyectos.find(item => item.id === p.id);
        const entregado = () => !actual() || actual().estado === 'entregado';
        const bloque = el('details', { class: 'procedimiento' });
        bloque.open = entrada.abierto;
        bloque.addEventListener('toggle', () => {
            if (bloque.isConnected && vigente()) entrada.abierto = bloque.open;
        });
        const resumen = el('summary', { attrs: { 'data-proc-campo': 'abrir' } });
        bloque.appendChild(resumen);
        bloque.appendChild(el('p', { class: 'texto-ayuda', text:
            'Guía general, no manual específico de ' + [p.equipo, p.modelo].filter(Boolean).join(' ') +
            '. Confirma la variante y consulta al fabricante. Solo para personal capacitado. No cambia el estado de la orden.' }));
        bloque.appendChild(el('p', { class: 'texto-ayuda', text:
            'El borrador se conserva al filtrar, pero solo durante esta sesión. Guarda con conexión antes de cerrar o recargar la pestaña.' }));
        const selector = el('select', { attrs: { 'aria-label': 'Procedimiento a realizar', 'data-proc-campo': 'tipo' } });
        for (const [tipo, plantilla] of Object.entries(Dominio.PROCEDIMIENTOS)) {
            selector.appendChild(el('option', { text: plantilla.titulo, attrs: { value: tipo } }));
        }
        const progreso = el('p', { class: 'detalle-extra', attrs: { 'aria-live': 'polite' } });
        const lista = el('ol', { class: 'procedimiento-pasos' });
        const mensaje = el('p', { class: 'detalle-extra', attrs: { role: 'status' } });
        const guardar = el('button', { class: 'btn-icon', text: 'Guardar procedimiento y avance', attrs: { type: 'button', 'data-proc-campo': 'guardar' } });
        const comparar = el('details', {}, [el('summary', { text: 'Ver última versión recibida' })]);
        const remoto = el('ol', { class: 'procedimiento-pasos' });
        comparar.appendChild(remoto);
        const descartar = el('button', { class: 'btn-icon', text: 'Descartar borrador y cargar versión recibida', attrs: { type: 'button', 'data-proc-campo': 'descartar' } });
        const actualizar = () => {
            const bloqueado = entregado() || entrada.guardando || entrada.confirmando;
            resumen.textContent = 'Procedimiento: ' + entrada.guia.titulo;
            selector.value = entrada.guia.tipo;
            selector.disabled = bloqueado;
            guardar.disabled = bloqueado || entrada.conflicto;
            guardar.textContent = entrada.guardando ? 'Validando y guardando…' : 'Guardar procedimiento y avance';
            lista.querySelectorAll('input').forEach(input => { input.disabled = bloqueado; });
            progreso.textContent = entrada.guia.pasos.filter(paso => paso.completado).length + ' de ' + entrada.guia.pasos.length + ' pasos completados';
            descartar.hidden = !entrada.sucio && !entrada.conflicto;
            descartar.disabled = entrada.guardando || entrada.confirmando;
            comparar.hidden = !entrada.conflicto;
            remoto.replaceChildren();
            if (entrada.conflicto) {
                remoto.appendChild(el('li', { text: entrada.remoto ? entrada.remoto.titulo : 'Sin procedimiento guardado.' }));
                for (const paso of entrada.remoto?.pasos || []) remoto.appendChild(el('li', { text: (paso.completado ? 'Completado: ' : 'Pendiente: ') + paso.texto }));
            }
            if (entrada.guardando) mensaje.textContent = 'Guardando: pendiente de confirmación del servidor.';
            else if (entrada.conflicto) mensaje.textContent = 'Conflicto: otra sesión cambió el procedimiento. Tu borrador se conserva, pero no sobrescribiremos el remoto. Compara las versiones y descarta el borrador solo cuando hayas revisado tus cambios.';
            else if (entrada.error) mensaje.textContent = entrada.error;
            else if (entregado()) mensaje.textContent = 'Orden entregada o no disponible: solo lectura.' + (entrada.sucio ? ' Tu borrador sin guardar se conserva para revisión.' : '');
            else if (entrada.sucio) mensaje.textContent = 'Cambios sin guardar. Borrador conservado en esta pestaña.';
            else if (!entrada.remoto) mensaje.textContent = 'Guía inicial pendiente de confirmar y guardar.';
            else if (navigator.onLine === false || errorSincronizacion || sincronizacionOrdenes?.fromCache !== false || sincronizacionOrdenes?.hasPendingWrites !== false) mensaje.textContent = 'Versión local disponible; sincronización con el servidor pendiente.';
            else mensaje.textContent = 'Procedimiento sincronizado con el servidor.';
            actualizarEstadoRed();
        };
        const dibujar = () => {
            lista.replaceChildren();
            entrada.guia.pasos.forEach((paso, i) => {
                const check = el('input', { attrs: { type: 'checkbox', 'data-proc-campo': 'paso-' + i } });
                check.checked = !!paso.completado;
                check.addEventListener('change', () => {
                    if (!vigente() || entregado() || entrada.guardando || entrada.confirmando) return;
                    entrada.guia.pasos[i].completado = check.checked;
                    borradores.editar(entrada);
                    actualizar();
                });
                lista.appendChild(el('li', {}, [el('label', {}, [check, el('span', { text: paso.texto })])]));
            });
            actualizar();
        };
        selector.addEventListener('change', async () => {
            const tipo = selector.value;
            if (!vigente() || entregado() || entrada.guardando || entrada.confirmando || tipo === entrada.guia.tipo) return;
            entrada.confirmando = true;
            actualizar();
            const respuesta = await Swal.fire({ target: $('ficha-dialog').open ? $('ficha-dialog') : 'body', title: '¿Cambiar procedimiento?',
                text: 'Se reemplazarán los pasos y se reiniciará el avance al guardar.',
                icon: 'warning', showCancelButton: true, confirmButtonText: 'Cambiar', cancelButtonText: 'Cancelar' });
            if (!vigente()) return;
            entrada.confirmando = false;
            if (respuesta.isConfirmed && !entregado()) {
                entrada.guia = Dominio.crearProcedimiento(tipo);
                borradores.editar(entrada);
            }
            dibujar();
            if (!bloque.isConnected) renderizarProyectos();
        });
        descartar.addEventListener('click', async () => {
            if (!vigente() || entrada.guardando || entrada.confirmando) return;
            entrada.confirmando = true;
            actualizar();
            const respuesta = await Swal.fire({ target: $('ficha-dialog').open ? $('ficha-dialog') : 'body', title: '¿Descartar tus cambios?',
                text: 'Se perderá solo el borrador local y se cargará la última versión recibida. No se escribirá en la base.',
                icon: 'warning', showCancelButton: true, confirmButtonText: 'Descartar borrador', cancelButtonText: 'Conservar' });
            if (!vigente()) return;
            entrada.confirmando = false;
            if (respuesta.isConfirmed) borradores.aceptar(entrada, actual()?.procedimiento);
            dibujar();
            if (!bloque.isConnected) renderizarProyectos();
        });
        guardar.addEventListener('click', async () => {
            if (!vigente() || entregado() || entrada.guardando || entrada.confirmando || entrada.conflicto) return;
            borradores.editar(entrada); // Una guía por defecto también es un borrador si el envío falla.
            entrada.guardando = true;
            actualizar();
            try {
                const resultado = await ordenesRepositorio.guardarProcedimiento({ id: p.id, uid,
                    base: entrada.base, guia: entrada.guia });
                if (!vigente()) return;
                borradores.aceptar(entrada, resultado);
                toast('success', 'Procedimiento confirmado por el servidor');
            } catch (err) {
                if (!vigente()) return;
                if (err.code === 'conflicto') entrada.conflicto = true;
                entrada.error = err.code === 'sin-conexion' ? 'Sin conexión: borrador conservado. Reconecta y pulsa Guardar para validarlo; no se enviará automáticamente.' :
                    'No se pudo guardar. Tu borrador sigue aquí. ' + (err.code === 'orden-entregada' ? 'La orden fue entregada.' : 'Revisa la conexión y vuelve a intentarlo.');
            } finally {
                if (vigente()) {
                    entrada.guardando = false;
                    actualizar();
                    renderizarProyectos();
                }
            }
        });
        bloque.append(selector, progreso, lista, mensaje, guardar, comparar, descartar);
        dibujar();
        return bloque;
    }

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
        const p = proyectos.find((x) => x.id === id);
        if (!p || !currentUser || p.estado === 'entregado') return;
        $('resumen-entrega-firma').textContent = p.cliente + ' · Saldo: ' + CLP(calcularSaldo(p));
        $('chk-saldar-entrega').checked = false;
        $('excepcion-entrega').value = '';
        currentFirmaId = id;
        solicitudFirma++;
        firmaBaseRevision = p.revisionOrden || 0;
        firmaTieneTrazos = false;
        // El canvas se dimensiona DESPUES de mostrar el modal: mientras esta
        // oculto getBoundingClientRect() devuelve 0 y la escala saldria mal.
        abrirModalFirma();
        prepararCanvas();
    }

    async function eliminarProyectoPermanente(id) {
        const orden = proyectos.find(p => p.id === id);
        if (orden && (orden.schemaVersion >= 2 || orden.revisionOrden > 0)) {
            Swal.fire('Orden con trazabilidad', 'Las órdenes nuevas o con operaciones registradas se conservan en el historial; no se eliminan pagos, firmas ni eventos.', 'info');
            return;
        }
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
                await navigator.share({ title: 'KryoFix', text: texto, url });
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
                const contenedor = el('div', { html: qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true }) });
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
                el('h2', { text: 'KryoFix' }),
                el('p', { text: 'Servicio técnico de electrónica' }),
                el('p', { text: 'Desarrollado por KryoDevs' })
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
        bloqueQr.appendChild(el('p', { class: 'url-respaldo', text: 'Codigo de seguimiento: ' + p.id }));
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
        isDrawing = false; punteroFirma = null;
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

    if (canvas && window.PointerEvent) {
        canvas.addEventListener('pointerdown', e => {
            if (punteroFirma !== null || e.isPrimary === false || (e.pointerType === 'mouse' && e.button !== 0)) return;
            punteroFirma = e.pointerId;
            startDrawing(e);
            try { canvas.setPointerCapture(e.pointerId); } catch (_e) { /* Evento sintético o puntero ya liberado. */ }
        });
        canvas.addEventListener('pointermove', e => { if (e.pointerId === punteroFirma) draw(e); });
        const terminar = e => { if (e.pointerId === punteroFirma) { stopDrawing(); punteroFirma = null; } };
        canvas.addEventListener('pointerup', terminar);
        canvas.addEventListener('pointercancel', terminar);
        canvas.addEventListener('lostpointercapture', terminar);
    } else if (canvas) {
        canvas.addEventListener('mousedown', startDrawing);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', stopDrawing);
        canvas.addEventListener('mouseleave', stopDrawing);
        canvas.addEventListener('touchstart', startDrawing, { passive: false });
        canvas.addEventListener('touchmove', draw, { passive: false });
        canvas.addEventListener('touchend', stopDrawing);
        canvas.addEventListener('touchcancel', stopDrawing);
    }

    const ajustarAltoVisible = () => document.documentElement.style.setProperty('--alto-visible',
        (window.visualViewport?.height || window.innerHeight) + 'px');
    window.visualViewport?.addEventListener('resize', ajustarAltoVisible);
    window.addEventListener('resize', ajustarAltoVisible);
    ajustarAltoVisible();

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
        solicitudFirma++;
        const guardar = $('btn-guardar-firma');
        if (guardar) { guardar.disabled = false; guardar.textContent = 'Confirmar y entregar'; }
        isDrawing = false; punteroFirma = null;
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
        isDrawing = false; punteroFirma = null;
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
        if (!currentFirmaId || !currentUser || btn.disabled) return;
        if (!firmaTieneTrazos) {
            Swal.fire('Falta la firma', 'El cliente debe firmar antes de registrar la entrega.', 'warning');
            return;
        }
        const equipoActual = proyectos.find((x) => x.id === currentFirmaId);
        if (!equipoActual || !currentUser) return;
        const uidFirma = currentUser.uid, sesionFirma = epocaSesion, solicitudEnviada = solicitudFirma;
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
            if (SPARK && pesoEnBytes(dataUrl) > 32 * 1024) throw new Error('La firma supera 32 KiB. Limpia el lienzo y vuelve a firmar.');

            if (!currentUser) return;
            const idFirmado = currentFirmaId;
            await tallerServicio.ejecutar({ id: idFirmado, uid: currentUser.uid, revision: firmaBaseRevision,
                opId: tallerServicio.nuevoId(), accion: 'entregar', datos: {
                    firma: dataUrl, saldar: $('chk-saldar-entrega').checked,
                    excepcion: $('excepcion-entrega').value.trim()
                } });
            if (currentUser?.uid !== uidFirma || epocaSesion !== sesionFirma || solicitudFirma !== solicitudEnviada) return;
            cerrarModalFirma();
            toast('success', 'Equipo entregado con firma');
            migrarArchivoNuevo(idFirmado, 'firmaCliente', uidFirma, sesionFirma);
        } catch (err) {
            if (currentUser?.uid === uidFirma && epocaSesion === sesionFirma && solicitudFirma === solicitudEnviada) avisarError('No se pudo guardar la firma', err);
        } finally {
            if (epocaSesion === sesionFirma && solicitudFirma === solicitudEnviada) { btn.textContent = etiqueta; btn.disabled = false; }
        }
    });

    // ========================
    // 8. PWA / SERVICE WORKER
    // ========================
    function avisarVersionNueva(reg) {
        if ($('actualizacion-disponible')) return;
        const aviso = el('aside', { class: 'aviso-actualizacion', attrs: { id: 'actualizacion-disponible', role: 'status' } });
        const mensaje = el('span', { text: 'Hay una versión nueva de KryoFix. Puedes actualizar cuando termines de guardar.' });
        const actualizar = el('button', { class: 'btn-icon', text: 'Actualizar KryoFix', attrs: { type: 'button' } });
        actualizar.addEventListener('click', () => {
            const recepcionPendiente = ['cliente', 'telefono', 'falla'].some(id => $(id)?.value.trim()) || fotoComprimidaBase64 || procesandoFoto;
            if (ficha.tienePendientes() || borradores.pendientes().length || recepcionPendiente || modalFirma?.style.display === 'flex') {
                mensaje.textContent = 'Guarda o descarta los borradores y la recepción, y cierra la firma antes de actualizar.';
                return;
            }
            actualizar.disabled = true;
            if (reg.waiting) {
                navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
                reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            } else window.location.reload();
        });
        aviso.append(mensaje, actualizar); document.body.prepend(aviso);
    }

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker
            .register('sw.js')
            .then((reg) => {
                if (reg.waiting && reg.active && navigator.serviceWorker.controller) avisarVersionNueva(reg);
                reg.addEventListener('updatefound', () => {
                    const nuevo = reg.installing;
                    if (!nuevo) return;
                    const reemplazaVersion = !!reg.active && reg.active !== nuevo;
                    nuevo.addEventListener('statechange', () => {
                        if (reemplazaVersion && nuevo.state === 'installed' && reg.waiting) avisarVersionNueva(reg);
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
                    snapshot.forEach((doc) => catalogoDB.push({ ...doc.data(), id: doc.id }));
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
        refrescarProblemas();
        if (esOtro || !marca) return;

        const modelos = Dominio.obtenerModelos(marca, catalogoDB, proyectos);
        for (const m of modelos) selModelo.appendChild(el('option', { text: m, attrs: { value: m } }));
        selModelo.appendChild(el('option', { text: 'Otro (fuera de catalogo)', attrs: { value: 'Otro' } }));
        selModelo.disabled = false;
    });

    escuchar('modelo', 'change', (e) => {
        const modelo = e.target.value;
        resetearReparaciones();
        mostrarCampoLibre('modelo-otro', modelo === 'Otro');
        refrescarProblemas();
        if (!modelo || modelo === 'Otro') return;

        const selRep = $('tipo-reparacion');
        const marca = valorMarca().toLowerCase();
        const reps = catalogoDB.filter((c) => c.modelo === modelo && String(c.marca || '').toLowerCase() === marca);
        for (const r of reps) selRep.appendChild(el('option', { text: r.reparacion, attrs: { value: r.id } }));
        selRep.appendChild(el('option', { text: 'Otra (precio manual)', attrs: { value: 'Otra' } }));
        selRep.disabled = false;
    });

    escuchar('marca-otro', 'input', refrescarProblemas);
    escuchar('modelo-otro', 'input', refrescarProblemas);

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
        let texto = String(valor === null || valor === undefined ? '' : valor);
        if (typeof valor === 'string' && /^[\s]*[=+@-]|^[\t\r\n]/.test(texto)) texto = "'" + texto;
        return '"' + texto.replace(/"/g, '""') + '"';
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
        const nombre = 'kryofix_ordenes_' + new Date().toISOString().split('T')[0] + '.csv';
        const ok = descargarArchivo(nombre, exportCSV(visibles), 'text/csv;charset=utf-8;');
        if (ok) toast('success', visibles.length + ' orden(es) exportadas');
        else if (typeof Swal !== 'undefined') Swal.fire('No se pudo exportar', 'El navegador bloqueo la descarga.', 'error');
    });

    // ========================
    // 14. MIGRACION HEREDADA BLOQUEADA
    // ========================
    async function migrar() {
        await Swal.fire('Migración administrativa requerida',
            'La adopción de órdenes sin propietario desde el navegador fue deshabilitada. Usa un respaldo, un mapa de propietarios verificado y una herramienta administrativa auditada.', 'warning');
        return { bloqueada: true };
    }

    // ========================
    // 15. INDICADOR DE RED
    // ========================
    function actualizarEstadoRed() {
        const statusObj = $('red-status');
        if (!statusObj) return;
        const enLinea = navigator.onLine !== false;
        let texto = 'Online · Verificando sincronización de órdenes…';
        let estado = 'revision';
        if (errorSincronizacion) texto = 'Error de sincronización de órdenes. Reintenta la conexión o inicia sesión nuevamente.';
        else if (!enLinea) texto = 'Offline · Datos locales; sincronización no confirmada';
        else if (sincronizacionOrdenes?.hasPendingWrites) texto = 'Online · Órdenes pendientes de sincronizar';
        else if (sincronizacionOrdenes?.fromCache) texto = 'Online · Datos en caché; esperando al servidor';
        else if (sincronizacionOrdenes?.fromCache === false && sincronizacionOrdenes?.hasPendingWrites === false) { texto = 'Online · Órdenes sincronizadas'; estado = 'reparado'; }
        statusObj.textContent = texto;
        statusObj.className = 'badge-estado estado-' + estado;
        statusObj.style.display = 'inline-block';
        const resumen = $('borradores-status');
        if (resumen) {
            const pendientes = borradores.pendientes();
            const conflictos = pendientes.filter(e => e.conflicto).length;
            resumen.hidden = !pendientes.length;
            resumen.textContent = pendientes.length + ' procedimiento(s) pendiente(s) de guardar o confirmar' +
                (conflictos ? ' · ' + conflictos + ' con conflicto' : '') + '. Los borradores viven solo en esta pestaña; guarda antes de salir.';
        }
    }
    window.addEventListener('online', actualizarEstadoRed);
    window.addEventListener('offline', actualizarEstadoRed);
    window.addEventListener('beforeunload', event => {
        if (!borradores.pendientes().length && !ficha.tienePendientes()) return;
        event.preventDefault();
        event.returnValue = '';
    });

    function renderizarFiltrosRapidos() {
        const contenedor = $('filtros-rapidos');
        if (!contenedor) return;
        contenedor.replaceChildren();
        for (const estado of ESTADOS) {
            const cantidad = proyectos.filter((p) => p.estado === estado).length;
            const boton = el('button', { class: 'filtro-chip', text: ESTADO_TEXTO[estado] + ' · ' + cantidad,
                attrs: { type: 'button', 'aria-pressed': String(filtroEstado.value === estado) } });
            boton.addEventListener('click', () => { filtroEstado.value = estado; renderizarProyectos(); });
            contenedor.appendChild(boton);
        }
    }

    document.querySelectorAll('[data-filtro-kpi]').forEach((nodo) => {
        nodo.setAttribute('role', 'button');
        nodo.tabIndex = 0;
        nodo.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nodo.click(); }
        });
    });
    escuchar(document, 'keydown', (e) => {
        if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || !currentUser ||
            e.target.closest('input, textarea, select, [contenteditable], [role="dialog"]') ||
            modalFirma.style.display === 'flex' || document.querySelector('.swal2-container')) return;
        e.preventDefault();
        mostrarVista('taller');
        buscador.focus();
    });

    let importandoCatalogo = false;
    escuchar('btn-catalogo-base', 'click', async () => {
        if (!currentUser || importandoCatalogo) return;
        importandoCatalogo = true;
        const uid = currentUser.uid;
        try {
            const respuesta = await Swal.fire({ title: 'Cargar tarifario de ejemplo',
                text: 'Precios orientativos en CLP, no cotizaciones actuales. Revisa y ajusta cada servicio antes de usarlo.',
                showCancelButton: true, confirmButtonText: 'Agregar ejemplos', cancelButtonText: 'Cancelar' });
            if (!respuesta.isConfirmed || !currentUser || currentUser.uid !== uid) return;
            const lote = db.batch();
            for (const item of Dominio.CATALOGO_SUGERIDO) {
                if (catalogoDB.some((c) => c.marca === item.marca && c.modelo === item.modelo && c.reparacion === item.reparacion)) continue;
                const clave = encodeURIComponent(uid + '|' + item.marca + '|' + item.modelo + '|' + item.reparacion);
                lote.set(db.collection(COL_CATALOGO).doc(clave), { ...item, uid });
            }
            await lote.commit();
            toast('success', 'Tarifario de ejemplo agregado');
        } catch (err) { avisarError('No se pudo cargar el tarifario', err); }
        finally { importandoCatalogo = false; }
    });

    // ========================
    // API interna (navegacion por consola y pruebas automatizadas)
    // ========================
    window.TechFix = {
        iniciada: true,
        tallerServicio,
        abrirFicha: id => ficha.abrir(id),
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
