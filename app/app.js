const form = document.getElementById('proyecto-form');
const listaProyectos = document.getElementById('lista-proyectos');
const alerta = document.getElementById('alerta-exito');

let proyectos = JSON.parse(localStorage.getItem('registrosTaller')) || [];

const nombresEstado = {
    'ingresado': '📥 Ingresado',
    'revision': '🔍 En Revisión',
    'repuesto': '⏳ Esperando Repuesto',
    'reparado': '✅ Listo para Entregar'
};

function renderizarProyectos() {
    listaProyectos.innerHTML = ''; 
    
    proyectos.forEach((proyecto, index) => {
        const tarjeta = document.createElement('div');
        tarjeta.className = `tarjeta ${proyecto.equipo}`;
        
        const costoFormateado = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(proyecto.costo);
        const accesoriosText = proyecto.accesorios ? proyecto.accesorios : "Ninguno";

        tarjeta.innerHTML = `
            <div class="tarjeta-header">
                <h4>${proyecto.modelo}</h4>
                <span class="fecha">${proyecto.fecha}</span>
            </div>
            <span class="badge ${proyecto.estado}">${nombresEstado[proyecto.estado]}</span>
            <p><strong>👤 Cliente:</strong> ${proyecto.cliente} (${proyecto.telefono})</p>
            <p><strong>🎒 Accesorios:</strong> ${accesoriosText}</p>
            <p><strong>🛠️ Falla:</strong> ${proyecto.falla}</p>
            <p class="precio">💰 Presupuesto: ${costoFormateado}</p>
            <button class="btn-entregar" onclick="eliminarProyecto(${index})">Marcar como Entregado</button>
        `;
        listaProyectos.appendChild(tarjeta);
    });
}

form.addEventListener('submit', function(e) {
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
        costo: document.getElementById('costo').value,
        fecha: fechaHoy 
    };

    proyectos.unshift(nuevoProyecto); 
    localStorage.setItem('registrosTaller', JSON.stringify(proyectos)); 
    
    form.reset(); 
    renderizarProyectos(); 

    // Mostrar alerta de éxito
    alerta.style.display = 'block';
    setTimeout(() => { alerta.style.display = 'none'; }, 3000);

    // Bajar pantalla
    listaProyectos.scrollIntoView({ behavior: 'smooth' });
});

// Función global en ventana para que el botón HTML la encuentre
window.eliminarProyecto = function(index) {
    if(confirm('¿Confirmas que se entregó el equipo? Ya no aparecerá en la lista.')) {
        proyectos.splice(index, 1); 
        localStorage.setItem('registrosTaller', JSON.stringify(proyectos)); 
        renderizarProyectos(); 
    }
}

// Iniciar app
renderizarProyectos();