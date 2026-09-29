// Configuración de Firebase
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
const auth = firebase.auth();

// Referencias al DOM (App)
const loginScreen = document.getElementById('login-screen');
const appContent = document.getElementById('app-content');
const loginForm = document.getElementById('login-form');
const btnLogout = document.getElementById('btn-logout');
const btnTheme = document.getElementById('btn-theme');

const form = document.getElementById('proyecto-form');
const listaProyectos = document.getElementById('lista-proyectos');
const buscador = document.getElementById('buscador');
const filtroEstado = document.getElementById('filtro-estado');
const ticketImpresion = document.getElementById('ticket-impresion');
const loader = document.getElementById('loader');

// Referencias (Dashboard)
const statActivos = document.getElementById('stat-activos');
const statReparados = document.getElementById('stat-reparados');
const statIngresos = document.getElementById('stat-ingresos');

let proyectos = [];
let unsubscribeDB = null;

// ========================
// 1. TEMA Y MODO OSCURO
// ========================
const currentTheme = localStorage.getItem('theme') || 'light';
document.documentElement.setAttribute('data-theme', currentTheme);
btnTheme.textContent = currentTheme === 'dark' ? '☀️ Modo Claro' : '🌙 Modo Oscuro';

btnTheme.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    btnTheme.textContent = newTheme === 'dark' ? '☀️ Modo Claro' : '🌙 Modo Oscuro';
});


// ========================
// 2. AUTENTICACIÓN
// ========================
auth.onAuthStateChanged(user => {
    if (user) {
        // Usuario Logueado
        loginScreen.style.display = 'none';
        appContent.style.display = 'block';
        cargarDatos();
        
        Swal.fire({
            toast: true, position: 'top-end', icon: 'success',
            title: `¡Bienvenido!`, showConfirmButton: false, timer: 2000
        });
    } else {
        // No logueado
        loginScreen.style.display = 'flex';
        appContent.style.display = 'none';
        if (unsubscribeDB) unsubscribeDB(); // Detener lectura de BD si sale
    }
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    
    try {
        await auth.signInWithEmailAndPassword(email, pass);
    } catch (error) {
        Swal.fire('Error de Acceso', 'Credenciales incorrectas o usuario no existe.', 'error');
    }
});

btnLogout.addEventListener('click', () => {
    auth.signOut();
});


// ========================
// 3. BASE DE DATOS Y RENDER
// ========================
function cargarDatos() {
    loader.style.display = 'block';
    unsubscribeDB = db.collection('equipos').orderBy('timestamp', 'desc').onSnapshot((snapshot) => {
        proyectos = [];
        snapshot.forEach((doc) => {
            proyectos.push({ id: doc.id, ...doc.data() });
        });
        loader.style.display = 'none';
        renderizarProyectos();
        actualizarDashboard();
    }, (error) => {
        console.error(error);
        Swal.fire('Error', 'No tienes permisos para ver la base de datos.', 'error');
    });
}

function actualizarDashboard() {
    const activos = proyectos.filter(p => p.estado !== 'entregado').length;
    
    const mesActual = new Date().getMonth();
    const reparadosEsteMes = proyectos.filter(p => p.estado === 'reparado' && new Date(p.timestamp).getMonth() === mesActual).length;
    
    // Sumamos los presupuestos de los reparados y entregados para estimar ingresos
    const ingresos = proyectos.filter(p => p.estado === 'reparado' || p.estado === 'entregado')
                              .reduce((acc, p) => acc + (p.costo || 0), 0);

    statActivos.textContent = activos;
    statReparados.textContent = reparadosEsteMes;
    statIngresos.textContent = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(ingresos);
}

function renderizarProyectos() {
    listaProyectos.innerHTML = ''; 
    
    const textoBusqueda = buscador.value.toLowerCase();
    const estadoFiltro = filtroEstado.value;

    const proyectosFiltrados = proyectos.filter(proyecto => {
        let cumpleEstado = false;
        if (estadoFiltro === 'todos') cumpleEstado = true;
        else if (estadoFiltro === 'activos') cumpleEstado = proyecto.estado !== 'entregado';
        else cumpleEstado = proyecto.estado === estadoFiltro;

        const textoProyecto = `${proyecto.cliente} ${proyecto.modelo} ${proyecto.falla} ${proyecto.telefono} ${proyecto.imei || ''}`.toLowerCase();
        const cumpleBusqueda = textoProyecto.includes(textoBusqueda);

        return cumpleEstado && cumpleBusqueda;
    });

    proyectosFiltrados.forEach(proyecto => {
        const tarjeta = document.createElement('div');
        tarjeta.className = `tarjeta ${proyecto.equipo} ${proyecto.estado === 'entregado' ? 'entregado-style' : ''}`;
        
        const costoFormateado = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(proyecto.costo || 0);
        const abonoFormateado = proyecto.abono ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(proyecto.abono) : '$0';
        
        const infoExtra = [];
        if (proyecto.imei) infoExtra.push(`IMEI/Serie: ${proyecto.imei}`);
        if (proyecto.pin) infoExtra.push(`PIN/Patrón: ${proyecto.pin}`);
        const htmlExtra = infoExtra.length > 0 ? `<span class="detalle-extra">🔑 ${infoExtra.join(' | ')}</span>` : '';

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
            ${htmlExtra}
            <p><strong>🎒 Accesorios:</strong> ${proyecto.accesorios || 'Ninguno'}</p>
            <p><strong>🛠️ Falla:</strong> ${proyecto.falla}</p>
            
            <p class="precio">
                💰 Costo: ${costoFormateado} 
                <br><span style="font-size:12px; color:var(--text-muted);">Abonado: ${abonoFormateado}</span>
            </p>
            
            <div class="acciones-tarjeta">
                <button class="btn-accion btn-imprimir" onclick="imprimirBoleta('${proyecto.id}')">🖨️ Ticket</button>
                <button class="btn-accion btn-wsp" onclick="enviarWhatsApp('${proyecto.telefono}', '${proyecto.cliente}', '${proyecto.modelo}', '${proyecto.estado}', ${proyecto.costo})">💬 WhatsApp</button>
                
                ${proyecto.estado !== 'entregado' 
                    ? `<button class="btn-accion btn-entregar" onclick="archivarProyecto('${proyecto.id}')">📦 Marcar Entregado</button>`
                    : `<button class="btn-accion btn-eliminar" onclick="eliminarProyectoPermanente('${proyecto.id}')">🗑️ Eliminar BD</button>`
                }
            </div>
        `;
        listaProyectos.appendChild(tarjeta);
    });

    if(proyectosFiltrados.length === 0) {
        listaProyectos.innerHTML = '<p class="sin-resultados">No se encontraron equipos.</p>';
    }
}


// ========================
// 4. NUEVO INGRESO
// ========================
form.addEventListener('submit', async function(e) {
    e.preventDefault(); 

    const nuevoProyecto = {
        cliente: document.getElementById('cliente').value,
        telefono: document.getElementById('telefono').value,
        equipo: document.getElementById('equipo').value,
        modelo: document.getElementById('modelo').value,
        imei: document.getElementById('imei').value || '',
        pin: document.getElementById('pin').value || '',
        accesorios: document.getElementById('accesorios').value,
        falla: document.getElementById('falla').value,
        estado: document.getElementById('estado').value,
        costo: Number(document.getElementById('costo').value),
        abono: Number(document.getElementById('abono').value || 0),
        fecha: new Date().toLocaleDateString('es-CL'),
        timestamp: Date.now()
    };

    try {
        await db.collection('equipos').add(nuevoProyecto);
        form.reset(); 
        
        if(filtroEstado.value === 'entregado') filtroEstado.value = 'activos';
        
        Swal.fire({
            toast: true, position: 'top-end', icon: 'success',
            title: 'Equipo guardado correctamente', showConfirmButton: false, timer: 3000
        });

        listaProyectos.scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
        Swal.fire('Error', 'No se pudo guardar el equipo. Revisa tu conexión.', 'error');
    }
});


// ========================
// 5. ACCIONES (Ventana global)
// ========================
window.cambiarEstado = async function(id, nuevoEstado) {
    try {
        await db.collection('equipos').doc(id).update({ estado: nuevoEstado });
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Estado actualizado', showConfirmButton: false, timer: 1500 });
    } catch (error) {
        Swal.fire('Error', 'No se pudo actualizar el estado.', 'error');
    }
};

window.archivarProyecto = function(id) {
    Swal.fire({
        title: '¿Marcar como Entregado?',
        text: "El equipo pasará al Historial de Entregados.",
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#3085d6',
        cancelButtonColor: '#d33',
        confirmButtonText: 'Sí, entregado'
    }).then((result) => {
        if (result.isConfirmed) cambiarEstado(id, 'entregado');
    });
};

window.eliminarProyectoPermanente = async function(id) {
    Swal.fire({
        title: '¿Eliminar permanentemente?',
        text: "Esta acción borrará el registro para siempre.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Sí, borrar'
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                await db.collection('equipos').doc(id).delete();
                Swal.fire('Eliminado', 'El registro fue borrado.', 'success');
            } catch (error) {
                Swal.fire('Error', 'No se pudo borrar.', 'error');
            }
        }
    });
};

window.enviarWhatsApp = function(telefono, cliente, modelo, estado, costo) {
    // Limpiar el teléfono de espacios o símbolos
    const numLimpio = telefono.replace(/\D/g, '');
    let mensaje = `Hola ${cliente}, te escribo de TechFix. `;
    
    if (estado === 'reparado') {
        mensaje += `Te informamos que tu ${modelo} ya está REPARADO y listo para ser retirado. El costo total es de $${costo}.`;
    } else if (estado === 'repuesto') {
        mensaje += `Queríamos avisarte que estamos esperando un repuesto para tu ${modelo}. Te mantendremos informado.`;
    } else {
        mensaje += `Queríamos comunicarnos contigo respecto a tu ${modelo}.`;
    }

    const url = `https://wa.me/${numLimpio}?text=${encodeURIComponent(mensaje)}`;
    window.open(url, '_blank');
};

window.imprimirBoleta = function(id) {
    const proyecto = proyectos.find(p => p.id === id);
    if(!proyecto) return;

    const costoFormateado = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(proyecto.costo || 0);
    const abonoFormateado = proyecto.abono ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(proyecto.abono) : '$0';
    const saldoPendiente = (proyecto.costo || 0) - (proyecto.abono || 0);
    const saldoFormateado = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(saldoPendiente > 0 ? saldoPendiente : 0);

    let htmlExtra = '';
    if (proyecto.imei) htmlExtra += `<p><strong>IMEI/Serie:</strong> ${proyecto.imei}</p>`;

    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=https://techfix-tracker-9a128.web.app/status.html?id=${proyecto.id}`;

    ticketImpresion.innerHTML = `
        <div class="boleta-pos">
            <img src="logo.jpg" alt="Logo" style="width:60px; display:block; margin: 0 auto 10px auto; border-radius:12px;">
            <h2>TechFix Tracker</h2>
            <p style="text-align:center;">Servicio Técnico Especializado</p>
            <p>--------------------------------</p>
            <p><strong>Ingreso:</strong> ${proyecto.fecha}</p>
            <p><strong>Ticket ID:</strong> #${proyecto.id.toString().slice(-6).toUpperCase()}</p>
            <p>--------------------------------</p>
            <h3>Datos del Cliente</h3>
            <p><strong>Nombre:</strong> ${proyecto.cliente}</p>
            <p><strong>Teléfono:</strong> ${proyecto.telefono}</p>
            <p>--------------------------------</p>
            <h3>Detalle del Equipo</h3>
            <p><strong>Equipo:</strong> ${proyecto.equipo.toUpperCase()}</p>
            <p><strong>Modelo:</strong> ${proyecto.modelo}</p>
            ${htmlExtra}
            <p><strong>Condición:</strong> ${proyecto.accesorios || 'Ninguna descrita'}</p>
            <p>--------------------------------</p>
            <h3>Trabajo Solicitado</h3>
            <p>${proyecto.falla}</p>
            <p>--------------------------------</p>
            <h3 class="total">Costo Total: ${costoFormateado}</h3>
            <p style="text-align:right;">Abono Inicial: ${abonoFormateado}</p>
            <h3 class="total" style="font-size:18px;">Saldo Pendiente: ${saldoFormateado}</h3>
            <p>--------------------------------</p>
            <div style="text-align:center; margin: 15px 0;">
                <img src="${qrUrl}" alt="QR Code" style="width:100px; height:100px;">
                <p style="font-size: 11px; margin-top:5px;">Escanea para ver el estado en vivo</p>
            </div>
            <p>--------------------------------</p>
            <p class="nota">Presente este ticket para retirar su equipo.</p>
            <p class="gracias">¡Gracias por su confianza!</p>
        </div>
    `;
    window.print();
};

// Eventos de búsqueda
buscador.addEventListener('input', renderizarProyectos);
filtroEstado.addEventListener('change', renderizarProyectos);