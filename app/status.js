// Configuración de Firebase (Debe ser idéntica a la principal)
const firebaseConfig = {
    apiKey: "AIzaSyC5hHgmyDXEWmzKzHRoywJk__iHgRcJ8F8",
    authDomain: "techfix-tracker-9a128.firebaseapp.com",
    projectId: "techfix-tracker-9a128",
    storageBucket: "techfix-tracker-9a128.firebasestorage.app",
    messagingSenderId: "434780023940",
    appId: "1:434780023940:web:e595dc76ac51d865a7a6d1",
    measurementId: "G-0P1J1C9171"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Obtener el ID de la URL (ej: status.html?id=ABC123XYZ)
const urlParams = new URLSearchParams(window.location.search);
const ticketId = urlParams.get('id');

const loader = document.getElementById('loader');
const content = document.getElementById('content');
const errorDiv = document.getElementById('error');

const lblModelo = document.getElementById('lbl-modelo');
const lblId = document.getElementById('lbl-id');
const msgReparado = document.getElementById('msg-reparado');

if (!ticketId) {
    loader.style.display = 'none';
    errorDiv.style.display = 'block';
} else {
    // Escuchar el documento en tiempo real
    db.collection('equipos').doc(ticketId).onSnapshot((doc) => {
        if (doc.exists) {
            const data = doc.data();
            mostrarEstado(data.estado, data.modelo, ticketId);
        } else {
            loader.style.display = 'none';
            content.style.display = 'none';
            errorDiv.style.display = 'block';
        }
    }, (error) => {
        console.error("Error al leer:", error);
        loader.style.display = 'none';
        errorDiv.textContent = "Error de conexión o permiso denegado.";
        errorDiv.style.display = 'block';
    });
}

function mostrarEstado(estadoActual, modelo, id) {
    loader.style.display = 'none';
    content.style.display = 'block';
    errorDiv.style.display = 'none';

    lblModelo.textContent = modelo;
    lblId.textContent = "#" + id.slice(-6).toUpperCase();

    // Resetear todos los pasos
    document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));
    msgReparado.style.display = 'none';

    // Activar los pasos correspondientes (cascada)
    const steps = ['ingresado', 'revision', 'repuesto', 'reparado', 'entregado'];
    let estadoEncontrado = false;

    // Lógica para encender el actual
    document.getElementById('step-ingresado').classList.add('active'); // Siempre encendido

    if (estadoActual === 'revision') {
        document.getElementById('step-revision').classList.add('active');
    } else if (estadoActual === 'repuesto') {
        document.getElementById('step-revision').classList.add('active');
        document.getElementById('step-repuesto').classList.add('active');
    } else if (estadoActual === 'reparado' || estadoActual === 'entregado') {
        document.getElementById('step-revision').classList.add('active');
        document.getElementById('step-reparado').classList.add('active');
        msgReparado.style.display = 'block';
    }
}
