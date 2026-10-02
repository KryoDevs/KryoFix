/* =============================================================================
 * Pagina publica de seguimiento (la que abre el QR del ticket).
 *
 * IMPORTANTE: lee la coleccion 'seguimiento', un espejo publico que solo
 * contiene estado y modelo. La version anterior leia 'equipos', de modo que
 * cualquiera con el ID del ticket podia descargar el documento completo:
 * nombre, telefono, IMEI, PIN del equipo, foto y firma del cliente.
 * ========================================================================== */

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
const msgReparado = document.getElementById('msg-reparado');

const PASOS = ['ingresado', 'revision', 'repuesto', 'reparado', 'entregado'];

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
                    mostrarError('No se encontro el equipo. Verifica el codigo QR.');
                    return;
                }
                const data = doc.data() || {};
                mostrarEstado(data.estado, data.modelo, ticketId);
            },
            (error) => {
                console.error('Error al leer el seguimiento:', error);
                mostrarError('No pudimos conectar con el servidor. Intentalo nuevamente en unos minutos.');
            }
        );
}
