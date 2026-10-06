/* =============================================================================
 * Pagina publica de seguimiento (la que abre el QR del ticket).
 *
 * IMPORTANTE: lee la coleccion 'seguimiento', un espejo publico que solo
 * contiene uid, estado, modelo y actualizado. Nunca lee las colecciones
 * privadas del taller, de modo que ningun dato personal (nombre, telefono,
 * IMEI, PIN, foto o firma) queda expuesto.
 *
 * Esta pagina NO se autentica y no debe contener nunca datos personales.
 * ========================================================================== */

(function () {
    'use strict';

    const Dominio = window.TechFixDominio;

    const btnTheme = document.getElementById('btn-status-theme');
    if (btnTheme) {
        const temaInicial = document.documentElement.getAttribute('data-theme');
        btnTheme.setAttribute('aria-pressed', String(temaInicial === 'dark'));
        btnTheme.addEventListener('click', () => {
            const actual = document.documentElement.getAttribute('data-theme');
            const nuevo = actual === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', nuevo);
            btnTheme.setAttribute('aria-pressed', String(nuevo === 'dark'));
            try {
                localStorage.setItem('theme', nuevo);
            } catch (_e) {
                /* modo privado */
            }
        });
    }

    if (typeof firebase === 'undefined' || !Dominio) {
        // Sin SDK (red bloqueada, primer arranque sin conexion): se avisa en vez
        // de dejar el mensaje de "buscando tu equipo..." para siempre.
        document.getElementById('loader').style.display = 'none';
        const error = document.getElementById('error');
        error.textContent = 'No pudimos cargar el sistema de consulta. Revisa tu conexion e intentalo de nuevo.';
        error.style.display = 'block';
        return;
    }

    const firebaseConfig = window.KryoFixEntorno?.firebase || {
        apiKey: 'AIzaSyC5hHgmyDXEWmzKzHRoywJk__iHgRcJ8F8',
        authDomain: 'techfix-tracker-9a128.firebaseapp.com',
        projectId: 'techfix-tracker-9a128',
        storageBucket: 'techfix-tracker-9a128.firebasestorage.app',
        messagingSenderId: '434780023940',
        appId: '1:434780023940:web:e595dc76ac51d865a7a6d1'
    };

    if (!firebase.apps || !firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
    }
    const db = firebase.firestore();

    const loader = document.getElementById('loader');
    const content = document.getElementById('content');
    const errorDiv = document.getElementById('error');
    const lblModelo = document.getElementById('lbl-modelo');
    const lblId = document.getElementById('lbl-id');
    const lblActualizado = document.getElementById('lbl-actualizado');
    const badgeEstadoActual = document.getElementById('badge-estado-actual');
    const progresoBarra = document.getElementById('progreso-barra');
    const progresoPorcentaje = document.getElementById('progreso-porcentaje');
    const msgEstado = document.getElementById('msg-estado');
    const msgReparado = document.getElementById('msg-reparado');
    const formBuscar = document.getElementById('form-buscar-orden');
    const inputCodigo = document.getElementById('input-codigo-orden');

    const PASOS = Dominio.ESTADOS;

    const ETIQUETAS = {
        ingresado: 'Ingresado',
        revision: 'En Revision',
        repuesto: 'Esperando Repuesto',
        reparado: 'Listo para Retirar',
        entregado: 'Entregado'
    };

    const PORCENTAJES = Dominio.PORCENTAJES_ESTADO;

    // Mensaje en lenguaje claro para cada estado (lo primero que busca el cliente).
    const MENSAJES = {
        ingresado: 'Recibimos tu equipo. Lo revisaremos a la brevedad.',
        revision: 'Nuestro tecnico esta revisando tu equipo.',
        repuesto: 'Estamos esperando el repuesto necesario para continuar.',
        reparado: 'Tu equipo esta listo. Te esperamos en el local para la entrega.',
        entregado: 'El equipo ya fue entregado. Gracias por preferirnos.'
    };

    let cancelarSuscripcion = null;

    /**
     * Extrae y sanea el ID de seguimiento aunque el usuario pegue la URL
     * completa del ticket, un query string (?id=...) o un codigo con "#".
     */
    const extraerCodigoOrden = Dominio.extraerCodigoOrden;

    function formatearActualizado(ts) {
        if (!ts || !Number.isFinite(Number(ts))) return 'Sincronizado en tiempo real';
        const f = new Date(Number(ts));
        if (Number.isNaN(f.getTime())) return 'Sincronizado en tiempo real';
        return 'Actualizado: ' + f.toLocaleDateString('es-CL');
    }

    function mostrarError(mensaje) {
        loader.style.display = 'none';
        content.style.display = 'none';
        errorDiv.textContent = mensaje;
        errorDiv.style.display = 'block';
    }

    function mostrarEstado(estadoActual, modelo, id, actualizado) {
        loader.style.display = 'none';
        content.style.display = 'block';
        errorDiv.style.display = 'none';

        const estValido = PASOS.includes(estadoActual) ? estadoActual : 'ingresado';
        lblModelo.textContent = modelo || 'Equipo en taller';
        lblId.textContent = '#' + String(id).slice(-6).toUpperCase();
        if (lblActualizado) lblActualizado.textContent = formatearActualizado(actualizado);

        if (badgeEstadoActual) {
            badgeEstadoActual.textContent = ETIQUETAS[estValido] || 'En taller';
            badgeEstadoActual.className = 'badge-estado estado-' + estValido;
        }

        const pct = PORCENTAJES[estValido] || 20;
        if (progresoPorcentaje) progresoPorcentaje.textContent = pct + '%';
        if (progresoBarra) progresoBarra.style.width = pct + '%';

        if (msgEstado) msgEstado.textContent = MENSAJES[estValido] || 'Estamos trabajando en tu equipo.';

        // Cascada: se encienden todos los pasos hasta el actual.
        const indice = PASOS.indexOf(estValido);
        PASOS.forEach((paso, i) => {
            const nodo = document.getElementById('step-' + paso);
            if (!nodo) return;
            // 'repuesto' es opcional: solo se marca si el equipo paso realmente por ahi.
            const alcanzado = indice >= 0 && i <= indice && !(paso === 'repuesto' && indice > PASOS.indexOf('repuesto'));
            nodo.classList.toggle('active', alcanzado);
            nodo.classList.toggle('current', estValido === paso);
            nodo.setAttribute('aria-current', estValido === paso ? 'step' : 'false');
        });

        // Solo se invita a retirar cuando esta listo, no cuando ya fue entregado.
        msgReparado.style.display = estValido === 'reparado' ? 'block' : 'none';
    }

    function consultarOrden(codigoRaw) {
        const limpio = extraerCodigoOrden(codigoRaw);
        if (cancelarSuscripcion) {
            cancelarSuscripcion();
            cancelarSuscripcion = null;
        }
        if (!limpio) {
            mostrarError('Falta el codigo del equipo. Vuelve a escanear el QR de tu ticket o escribe un codigo valido.');
            return;
        }

        content.style.display = 'none';
        loader.style.display = 'block';
        errorDiv.style.display = 'none';
        if (inputCodigo) inputCodigo.value = limpio;

        cancelarSuscripcion = db
            .collection('seguimiento')
            .doc(limpio)
            .onSnapshot(
                (doc) => {
                    if (!doc.exists) {
                        mostrarError('No se encontro el equipo. Verifica el codigo QR o consulta en el local con tu numero de orden.');
                        return;
                    }
                    const data = doc.data() || {};
                    mostrarEstado(data.estado, data.modelo, limpio, data.actualizado);
                },
                (error) => {
                    console.error('Error al leer el seguimiento:', error);
                    if (error && error.code === 'permission-denied') {
                        mostrarError('La consulta no esta disponible en este momento. Consulta el estado en el local.');
                    } else {
                        mostrarError('No pudimos conectar con el servidor. Intentalo nuevamente en unos minutos.');
                    }
                }
            );
    }

    if (formBuscar) {
        formBuscar.addEventListener('submit', (e) => {
            e.preventDefault();
            const valor = inputCodigo ? inputCodigo.value.trim() : '';
            consultarOrden(valor);
        });
    }

    window.TechFixStatus = {
        extraerCodigoOrden,
        consultarOrden,
        mostrarEstado
    };

    const ticketId = new URLSearchParams(window.location.search).get('id');
    consultarOrden(ticketId);
})();
