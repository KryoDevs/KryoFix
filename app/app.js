// 1. Configuración de Firebase (usando las claves proporcionadas)
const firebaseConfig = {
    apiKey: "AIzaSyC5hHgmyDXEWmzKzHRoywJk__iHgRcJ8F8",
    authDomain: "techfix-tracker-9a128.firebaseapp.com",
    projectId: "techfix-tracker-9a128",
    storageBucket: "techfix-tracker-9a128.firebasestorage.app",
    messagingSenderId: "434780023940",
    appId: "1:434780023940:web:e595dc76ac51d865a7a6d1",
    measurementId: "G-0P1J1C9171"
};

// 2. Inicializar Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Referencias al DOM
const form = document.getElementById('proyecto-form');
const listaProyectos = document.getElementById('lista-proyectos');
const alerta = document.getElementById('alerta-exito');
const buscador = document.getElementById('buscador');
const filtroEstado = document.getElementById('filtro-estado');
const ticketImpresion = document.getElementById('ticket-impresion');

let proyectos = [];

// 3. Migración automática (opcional) de localStorage a Firebase
const datosLocales = JSON.parse(localStorage.getItem('registrosTaller'));
if (datosLocales && datosLocales.length > 0) {
    console.log("Migrando datos locales a Firebase...");
    datosLocales.forEach(async (proyecto) => {
        await db.collection('equipos').add({
            ...proyecto,
            timestamp: Date.now() // para mantener un orden
        });
    });
    // Una vez migrados, limpiamos el localStorage para no duplicar
    localStorage.removeItem('registrosTaller');
}

// 4. Escuchar cambios en la Base de Datos en Tiempo Real
db.collection('equipos').orderBy('timestamp', 'desc').onSnapshot((snapshot) => {
    proyectos = [];
    snapshot.forEach((doc) => {
        proyectos.push({ id: doc.id, ...doc.data() });
    });
    renderizarProyectos();
});


function renderizarProyectos() {
    listaProyectos.innerHTML = ''; 
    
    const textoBusqueda = buscador.value.toLowerCase();
    const estadoFiltro = filtroEstado.value;

    const proyectosFiltrados = proyectos.filter(proyecto => {
        // Filtrar por estado
        let cumpleEstado = false;
        if (estadoFiltro === 'todos') {
            cumpleEstado = true;
        } else if (estadoFiltro === 'activos') {
            cumpleEstado = proyecto.estado !== 'entregado';
        } else {
            cumpleEstado = proyecto.estado === estadoFiltro;
        }

        // Filtrar por búsqueda
        const textoProyecto = `${proyecto.cliente} ${proyecto.modelo} ${proyecto.falla} ${proyecto.telefono}`.toLowerCase();
        const cumpleBusqueda = textoProyecto.includes(textoBusqueda);

        return cumpleEstado && cumpleBusqueda;
    });

    proyectosFiltrados.forEach(proyecto => {
        const tarjeta = document.createElement('div');
        tarjeta.className = `tarjeta ${proyecto.equipo} ${proyecto.estado === 'entregado' ? 'entregado-style' : ''}`;
        
        const costoFormateado = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(proyecto.costo || 0);
        const accesoriosText = proyecto.accesorios ? proyecto.accesorios : "Ninguno";

        tarjeta.innerHTML = `
            <div class="tarjeta-header">
                <h4>${proyecto.modelo}</h4>
                <span class="fecha">${proyecto.fecha}</span>
            </div>
            
            <div class="tarjeta-estado">
                <select onchange="cambiarEstado('${proyecto.id}', this.value)" class="select-estado ${proyecto.estado}">
                    <option value="ingresado" ${proyecto.estado === 'ingresado' ? 'selected' : ''}>📥 Ingresado</option>
                    <option value="revision" ${proyecto.estado === 'revision' ? 'selected' : ''}>🔍 En Revisión</option>
                    <option value="repuesto" ${proyecto.estado === 'repuesto' ? 'selected' : ''}>⏳ Esperando Repuesto</option>
                    <option value="reparado" ${proyecto.estado === 'reparado' ? 'selected' : ''}>✅ Listo para Entregar</option>
                    <option value="entregado" ${proyecto.estado === 'entregado' ? 'selected' : ''}>📦 Entregado</option>
                </select>
            </div>

            <p><strong>👤 Cliente:</strong> ${proyecto.cliente} (${proyecto.telefono})</p>
            <p><strong>🎒 Accesorios:</strong> ${accesoriosText}</p>
            <p><strong>🛠️ Falla:</strong> ${proyecto.falla}</p>
            <p class="precio">💰 Presupuesto: ${costoFormateado}</p>
            
            <div class="acciones-tarjeta">
                <button class="btn-imprimir" onclick="imprimirBoleta('${proyecto.id}')">🖨️ Imprimir Ticket</button>
                ${proyecto.estado !== 'entregado' 
                    ? `<button class="btn-entregar" onclick="archivarProyecto('${proyecto.id}')">Marcar Entregado</button>`
                    : `<button class="btn-eliminar" onclick="eliminarProyectoPermanente('${proyecto.id}')">🗑️ Eliminar</button>`
                }
            </div>
        `;
        listaProyectos.appendChild(tarjeta);
    });

    if(proyectosFiltrados.length === 0) {
        listaProyectos.innerHTML = '<p class="sin-resultados">No se encontraron equipos que coincidan con la búsqueda.</p>';
    }
}

// 5. Agregar un nuevo proyecto a Firebase
form.addEventListener('submit', async function(e) {
    e.preventDefault(); 

    const fechaHoy = new Date().toLocaleDateString('es-CL');

    const nuevoProyecto = {
        cliente: document.getElementById('cliente').value,
        telefono: document.getElementById('telefono').value,
        equipo: document.getElementById('equipo').value,
        modelo: document.getElementById('modelo').value,
        accesorios: document.getElementById('accesorios').value,
        falla: document.getElementById('falla').value,
        estado: document.getElementById('estado').value,
        costo: Number(document.getElementById('costo').value),
        fecha: fechaHoy,
        timestamp: Date.now() // Guarda la hora exacta para ordenar
    };

    try {
        await db.collection('equipos').add(nuevoProyecto);
        form.reset(); 
        
        // Auto cambiar filtro si estaba en Entregados
        if(filtroEstado.value === 'entregado') {
            filtroEstado.value = 'activos';
        }

        // Mostrar alerta de éxito
        alerta.style.display = 'block';
        setTimeout(() => { alerta.style.display = 'none'; }, 3000);

        listaProyectos.scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
        console.error("Error al agregar el documento: ", error);
        alert("Hubo un error al guardar. Revisa tu conexión.");
    }
});

// 6. Funciones globales para actualizar o eliminar en Firebase
window.cambiarEstado = async function(id, nuevoEstado) {
    try {
        await db.collection('equipos').doc(id).update({
            estado: nuevoEstado
        });
    } catch (error) {
        console.error("Error al cambiar estado:", error);
    }
};

window.archivarProyecto = function(id) {
    if(confirm('¿Marcar como Entregado? El equipo se moverá al Historial.')) {
        cambiarEstado(id, 'entregado');
    }
};

window.eliminarProyectoPermanente = async function(id) {
    if(confirm('¿ELIMINAR PERMANENTEMENTE? Esta acción no se puede deshacer.')) {
        try {
            await db.collection('equipos').doc(id).delete();
        } catch (error) {
            console.error("Error al eliminar:", error);
        }
    }
};

window.imprimirBoleta = function(id) {
    const proyecto = proyectos.find(p => p.id === id);
    if(!proyecto) return;

    const costoFormateado = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(proyecto.costo || 0);
    const accesoriosText = proyecto.accesorios ? proyecto.accesorios : "Ninguno";

    ticketImpresion.innerHTML = `
        <div class="boleta-pos">
            <h2>🔧 TechFix Tracker</h2>
            <p>Servicio Técnico de Equipos</p>
            <p>--------------------------------</p>
            <p><strong>Fecha Ingreso:</strong> ${proyecto.fecha}</p>
            <p><strong>Ticket ID:</strong> #${proyecto.id.toString().slice(-6).toUpperCase()}</p>
            <p>--------------------------------</p>
            <h3>Datos del Cliente</h3>
            <p><strong>Nombre:</strong> ${proyecto.cliente}</p>
            <p><strong>Teléfono:</strong> ${proyecto.telefono}</p>
            <p>--------------------------------</p>
            <h3>Detalle del Equipo</h3>
            <p><strong>Equipo:</strong> ${proyecto.equipo.toUpperCase()}</p>
            <p><strong>Modelo:</strong> ${proyecto.modelo}</p>
            <p><strong>Accesorios:</strong> ${accesoriosText}</p>
            <p>--------------------------------</p>
            <h3>Diagnóstico / Trabajo</h3>
            <p>${proyecto.falla}</p>
            <p>--------------------------------</p>
            <h3 class="total">Presupuesto Estimado: ${costoFormateado}</h3>
            <p>--------------------------------</p>
            <p class="nota">Guarde este ticket. Es necesario para retirar su equipo.</p>
            <p class="gracias">¡Gracias por su preferencia!</p>
        </div>
    `;

    // Disparar impresión
    window.print();
};

// Eventos de búsqueda y filtro
buscador.addEventListener('input', renderizarProyectos);
filtroEstado.addEventListener('change', renderizarProyectos);