/* =============================================================================
 * Pagina publica de seguimiento (la que abre el QR del ticket).
 *
 * IMPORTANTE: lee la coleccion 'seguimiento', un espejo publico que solo
 * contiene uid, estado, modelo y actualizado. La version anterior leia
 * 'equipos', de modo que cualquiera con el ID del ticket podia descargar el
 * documento completo: nombre, telefono, IMEI, PIN del equipo, foto y firma.
 *
 * Esta pagina NO se autentica y no debe contener nunca datos personales.
 * ========================================================================== */

(function () {
    'use strict';

    if (typeof firebase === 'undefined') {
        // Sin SDK (red bloqueada, primer arranque sin conexion): se avisa en vez
        // de dejar el mensaje de "buscando tu equipo..." para siempre.
        document.getElementById('loader').style.display = 'none';
        const error = document.getElementById('error');
        error.textContent = 'No pudimos cargar el sistema de consulta. Revisa tu conexion e intentalo de nuevo.';
        error.style.display = 'block';
        return;
    }

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

    const loader = document.getElementById('loader');
    const content = document.getElementById('content');
    const errorDiv = document.getElementById('error');
    const lblModelo = document.getElementById('lbl-modelo');
    const lblId = document.getElementById('lbl-id');
    const msgEstado = document.getElementById('msg-estado');
    const msgReparado = document.getElementById('msg-reparado');

    const PASOS = ['ingresado', 'revision', 'repuesto', 'reparado', 'entregado'];

    // Mensaje en lenguaje claro para cada estado (lo primero que busca el cliente).
    const MENSAJES = {
        ingresado: 'Recibimos tu equipo. Lo revisaremos a la brevedad.',
        revision: 'Nuestro tecnico esta revisando tu equipo.',
        repuesto: 'Estamos esperando el repuesto necesario para continuar.',
        reparado: 'Tu equipo esta listo. Te esperamos en el local para la entrega.',
        entregado: 'El equipo ya fue entregado. Gracias por preferirnos.'
    };

    const ticketId = new URLSearchParams(window.location.search).get('id');

    function mostrarError(mensaje) {
        loader.style.display = 'none';
        content.style.display = 'none';
        errorDiv.textContent = mensaje;
        errorDiv.style.display = 'block';
    }

    function mostrarEstado(estadoActual, modelo, id) {
        loader.style.display = 'none';
        content.style.display = 'block';
        errorDiv.style.display = 'none';

        lblModelo.textContent = modelo || 'Equipo en taller';
        lblId.textContent = '#' + String(id).slice(-6).toUpperCase();
        if (msgEstado) msgEstado.textContent = MENSAJES[estadoActual] || 'Estamos trabajando en tu equipo.';

        // Cascada: se encienden todos los pasos hasta el actual.
        const indice = PASOS.indexOf(estadoActual);
        PASOS.forEach((paso, i) => {
            const nodo = document.getElementById('step-' + paso);
            if (!nodo) return;
            // 'repuesto' es opcional: solo se marca si el equipo paso realmente por ahi.
            const alcanzado = indice >= 0 && i <= indice && !(paso === 'repuesto' && indice > PASOS.indexOf('repuesto'));
            nodo.classList.toggle('active', alcanzado);
            nodo.setAttribute('aria-current', estadoActual === paso ? 'step' : 'false');
        });

        // Solo se invita a retirar cuando esta listo, no cuando ya fue entregado.
        msgReparado.style.display = estadoActual === 'reparado' ? 'block' : 'none';
    }

    if (!ticketId) {
        mostrarError('Falta el codigo del equipo. Vuelve a escanear el QR de tu ticket.');
    } else {
        db.collection('seguimiento')
            .doc(ticketId)
            .onSnapshot(
                (doc) => {
                    if (!doc.exists) {
                        mostrarError('No se encontro el equipo. Verifica el codigo QR o consulta en el local con tu numero de orden.');
                        return;
                    }
                    const data = doc.data() || {};
                    mostrarEstado(data.estado, data.modelo, ticketId);
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
})();
