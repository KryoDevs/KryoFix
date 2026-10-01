// ========================
// CONFIGURACIÓN DE FIREBASE
// ========================
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

// Activar persistencia offline (soporte sin internet)
db.enablePersistence().catch(function(err) {
    console.error("Error activando modo offline:", err.code);
});

// ========================
// REFERENCIAS AL DOM
// ========================
const loginScreen = document.getElementById('login-screen');
const appContent = document.getElementById('app-content');
const loginForm = document.getElementById('login-form');
const btnLogout = document.getElementById('btn-logout');
const btnTheme = document.getElementById('btn-theme');
const userEmailDisplay = document.getElementById('user-email-display');

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
let currentUser = null; // MULTI-TÉCNICO: referencia al usuario logueado

// ========================
// FIX SEGURIDAD: Escapar HTML para prevenir XSS
// ========================
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(String(text)));
    return div.innerHTML;
}

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
        currentUser = user; // MULTI-TÉCNICO: guardar referencia
        loginScreen.style.display = 'none';
        appContent.style.display = 'block';
        // Mostrar email del técnico logueado
        if (userEmailDisplay) userEmailDisplay.textContent = user.email;
        cargarDatos();
        Swal.fire({
            toast: true, position: 'top-end', icon: 'success',
            title: `¡Bienvenido!`, showConfirmButton: false, timer: 2000
        });
    } else {
        currentUser = null;
        loginScreen.style.display = 'flex';
        appContent.style.display = 'none';
        if (unsubscribeDB) unsubscribeDB();
    }
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    const btn = loginForm.querySelector('button[type="submit"]');
    btn.textContent = 'Ingresando...';
    btn.disabled = true;
    try {
        await auth.signInWithEmailAndPassword(email, pass);
    } catch (error) {
        Swal.fire('Error de Acceso', 'Credenciales incorrectas o usuario no existe.', 'error');
        btn.textContent = 'Ingresar al Sistema';
        btn.disabled = false;
    }
});

btnLogout.addEventListener('click', () => {
    auth.signOut().then(() => {
        // Limpiar memoria al salir
        proyectos = [];
        currentUser = null;
        listaProyectos.innerHTML = '';
        statActivos.textContent = '0';
        statReparados.textContent = '0';
        statIngresos.textContent = '$0';
    });
});


// ========================
// 3. BASE DE DATOS Y RENDER
// ========================
function cargarDatos() {
    if (!currentUser) return;
    loader.style.display = 'block';

    // Carga todos los equipos del técnico logueado.
    // También muestra documentos antiguos (sin campo uid) para compatibilidad.
    unsubscribeDB = db.collection('equipos')
        .orderBy('timestamp', 'desc')
        .limit(500)
        .onSnapshot((snapshot) => {
            proyectos = [];
            snapshot.forEach((doc) => {
                const data = doc.data();
                // Mostrar solo los del técnico actual O los que no tienen uid (datos viejos)
                if (!data.uid || data.uid === currentUser.uid) {
                    proyectos.push({ id: doc.id, ...data });
                }
            });
            loader.style.display = 'none';
            renderizarProyectos();
            actualizarDashboard();
        }, (error) => {
            console.error(error);
            loader.style.display = 'none';
            Swal.fire('Error de Permisos', 'Actualiza las reglas de Firestore en la consola de Firebase para continuar.', 'error');
        });
}

function actualizarDashboard() {
    const activos = proyectos.filter(p => p.estado !== 'entregado').length;

    // FIX: Filtrar ingresos SOLO del mes y año actual
    const ahora = new Date();
    const mesActual = ahora.getMonth();
    const anioActual = ahora.getFullYear();

    const reparadosEsteMes = proyectos.filter(p => {
        const fecha = new Date(p.timestamp);
        return p.estado === 'reparado' &&
               fecha.getMonth() === mesActual &&
               fecha.getFullYear() === anioActual;
    }).length;

    const ingresosEsteMes = proyectos
        .filter(p => {
            const fecha = new Date(p.timestamp);
            return (p.estado === 'reparado' || p.estado === 'entregado') &&
                   fecha.getMonth() === mesActual &&
                   fecha.getFullYear() === anioActual;
        })
        .reduce((acc, p) => acc + (p.costo || 0), 0);

    statActivos.textContent = activos;
    statReparados.textContent = reparadosEsteMes;
    statIngresos.textContent = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(ingresosEsteMes);
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

        // FIX XSS: Buscamos en los datos RAW, no en el HTML escapado
        const textoProyecto = `${proyecto.cliente} ${proyecto.modelo} ${proyecto.falla} ${proyecto.telefono} ${proyecto.imei || ''}`.toLowerCase();
        const cumpleBusqueda = textoProyecto.includes(textoBusqueda);

        return cumpleEstado && cumpleBusqueda;
    });

    proyectosFiltrados.forEach(proyecto => {
        const tarjeta = document.createElement('div');
        tarjeta.className = `tarjeta ${escapeHtml(proyecto.equipo)} ${proyecto.estado === 'entregado' ? 'entregado-style' : ''}`;

        const costoFormateado = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(proyecto.costo || 0);
        const abonoFormateado = proyecto.abono ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(proyecto.abono) : '$0';

        // FIX XSS: Escapar todos los campos del usuario antes de insertarlos
        const clienteSeguro   = escapeHtml(proyecto.cliente);
        const telefonoSeguro  = escapeHtml(proyecto.telefono);
        const modeloSeguro    = escapeHtml(proyecto.modelo);
        const fallaSegura     = escapeHtml(proyecto.falla);
        const accesoriosSeguro = escapeHtml(proyecto.accesorios);
        const imeiSeguro      = escapeHtml(proyecto.imei);

        const infoExtra = [];
        if (proyecto.imei) infoExtra.push(`IMEI/Serie: ${imeiSeguro}`);
        // FIX SEGURIDAD: Mostrar PIN como asteriscos, nunca en texto plano
        if (proyecto.pin) infoExtra.push(`PIN: ${'*'.repeat(proyecto.pin.length)}`);
        const htmlExtra = infoExtra.length > 0 ? `<span class="detalle-extra">🔑 ${infoExtra.join(' | ')}</span>` : '';

        tarjeta.innerHTML = `
            <div class="tarjeta-header">
                <h4>${modeloSeguro}</h4>
                <span class="fecha">${escapeHtml(proyecto.fecha)}</span>
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

            <p><strong>👤 Cliente:</strong> ${clienteSeguro} (${telefonoSeguro})</p>
            ${htmlExtra}
            <p><strong>🎒 Accesorios:</strong> ${accesoriosSeguro || 'Ninguno'}</p>
            <p><strong>🛠️ Falla:</strong> ${fallaSegura}</p>
            
            <p class="precio">
                💰 Costo: ${costoFormateado} 
                <br><span style="font-size:12px; color:var(--text-muted);">Abonado: ${abonoFormateado}</span>
            </p>
            
            ${proyecto.evidencia ? `<div style="text-align:center; margin-top:10px;"><img src="${escapeHtml(proyecto.evidencia)}" style="max-width:100%; height:auto; border-radius:8px; border:1px solid var(--border-color); cursor:pointer;" onclick="Swal.fire({imageUrl: '${escapeHtml(proyecto.evidencia)}', imageAlt: 'Evidencia', width: '90%', padding: 0})"><p style="font-size:12px; color:var(--text-muted); margin:0;">📷 Evidencia Fotográfica (Clic para ampliar)</p></div>` : ''}

            ${proyecto.firmaCliente ? `<div style="text-align:center; margin-top:10px;"><img src="${escapeHtml(proyecto.firmaCliente)}" class="firma-guardada" alt="Firma del cliente"><p style="font-size:12px; color:var(--text-muted); margin:0;">✅ Firma de Conformidad</p></div>` : ''}

            <div class="acciones-tarjeta">
                <button class="btn-accion btn-imprimir" onclick="imprimirBoleta('${proyecto.id}')">🖨️ Ticket</button>
                <button class="btn-accion btn-wsp" onclick="enviarWhatsApp('${proyecto.id}')">💬 WhatsApp</button>
                
                ${proyecto.estado !== 'entregado'
                    ? `<button class="btn-accion btn-entregar" onclick="archivarProyecto('${proyecto.id}')">📦 Marcar Entregado</button>`
                    : `<button class="btn-accion btn-eliminar" onclick="eliminarProyectoPermanente('${proyecto.id}')">🗑️ Eliminar</button>`
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
// 4. NUEVO INGRESO Y FOTOS
// ========================
let fotoComprimidaBase64 = null;

// Lógica para previsualizar y comprimir la foto seleccionada
document.getElementById('foto-evidencia').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) {
        fotoComprimidaBase64 = null;
        document.getElementById('preview-foto').style.display = 'none';
        return;
    }

    const reader = new FileReader();
    reader.onload = function(event) {
        const img = new Image();
        img.onload = function() {
            // Comprimir imagen a max 600px de ancho/alto
            const maxSize = 600;
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > maxSize) {
                    height *= maxSize / width;
                    width = maxSize;
                }
            } else {
                if (height > maxSize) {
                    width *= maxSize / height;
                    height = maxSize;
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // Guardar como JPEG comprimido al 50%
            fotoComprimidaBase64 = canvas.toDataURL('image/jpeg', 0.5);

            // Mostrar previsualización
            const preview = document.getElementById('img-evidencia-preview');
            preview.src = fotoComprimidaBase64;
            document.getElementById('preview-foto').style.display = 'block';
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

form.addEventListener('submit', async function(e) {
    e.preventDefault();

    if (!currentUser) {
        Swal.fire('Error', 'Debes iniciar sesión primero.', 'error');
        return;
    }

    const nuevoProyecto = {
        uid: currentUser.uid,
        cliente: document.getElementById('cliente').value,
        telefono: document.getElementById('telefono').value,
        equipo: document.getElementById('marca').value,
        modelo: document.getElementById('modelo').value,
        imei: document.getElementById('imei').value || '',
        pin: document.getElementById('pin').value || '',
        accesorios: document.getElementById('accesorios').value,
        falla: (document.getElementById('tipo-reparacion').options[document.getElementById('tipo-reparacion').selectedIndex]?.text || '') + ' - ' + document.getElementById('falla').value,
        estado: document.getElementById('estado').value,
        costo: Number(document.getElementById('costo').value),
        abono: Number(document.getElementById('abono').value || 0),
        fecha: new Date().toLocaleDateString('es-CL'),
        timestamp: Date.now(),
        evidencia: fotoComprimidaBase64 // Se añade la foto comprimida si existe
    };

    const btnSubmit = form.querySelector('button[type="submit"]');
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Guardando...';

    try {
        await db.collection('equipos').add(nuevoProyecto);
        form.reset();
        fotoComprimidaBase64 = null;
        document.getElementById('preview-foto').style.display = 'none';
        
        if(filtroEstado.value === 'entregado') filtroEstado.value = 'activos';

        Swal.fire({
            toast: true, position: 'top-end', icon: 'success',
            title: 'Equipo guardado correctamente', showConfirmButton: false, timer: 3000
        });

        listaProyectos.scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
        Swal.fire('Error', 'No se pudo guardar el equipo. Revisa tu conexión.', 'error');
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.textContent = '💾 Guardar y Generar Ticket';
    }
});


// ========================
// 5. ACCIONES
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
    currentFirmaId = id;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#000';
    document.getElementById('modal-firma').style.display = 'flex';
};

window.eliminarProyectoPermanente = async function(id) {
    Swal.fire({
        title: '¿Eliminar permanentemente?',
        text: "Esta acción borrará el registro para siempre.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Sí, borrar',
        cancelButtonText: 'Cancelar'
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

// FIX: Pasamos el id del proyecto para obtener datos frescos sin inyección
window.enviarWhatsApp = function(id) {
    const proyecto = proyectos.find(p => p.id === id);
    if (!proyecto) return;
    const numLimpio = proyecto.telefono.replace(/\D/g, '');
    let mensaje = `Hola ${proyecto.cliente}, te escribo de TechFix. `;

    if (proyecto.estado === 'reparado') {
        mensaje += `Te informamos que tu ${proyecto.modelo} ya está REPARADO y listo para ser retirado. El costo total es de ${new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(proyecto.costo)}.`;
    } else if (proyecto.estado === 'repuesto') {
        mensaje += `Queríamos avisarte que estamos esperando un repuesto para tu ${proyecto.modelo}. Te mantendremos informado.`;
    } else {
        mensaje += `Queríamos comunicarnos contigo respecto a tu ${proyecto.modelo}.`;
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

    // FIX XSS: Usar escapeHtml en todos los campos del ticket
    let htmlExtra = '';
    if (proyecto.imei) htmlExtra += `<p><strong>IMEI/Serie:</strong> ${escapeHtml(proyecto.imei)}</p>`;

    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=https://techfix-tracker-9a128.web.app/status.html?id=${proyecto.id}`;

    ticketImpresion.innerHTML = `
        <div class="boleta-pos">
            <img src="logo.jpg" alt="Logo" style="width:60px; display:block; margin: 0 auto 10px auto; border-radius:12px;">
            <h2>TechFix Tracker</h2>
            <p style="text-align:center;">Servicio Técnico Especializado</p>
            <p>--------------------------------</p>
            <p><strong>Ingreso:</strong> ${escapeHtml(proyecto.fecha)}</p>
            <p><strong>Ticket ID:</strong> #${proyecto.id.toString().slice(-6).toUpperCase()}</p>
            <p>--------------------------------</p>
            <h3>Datos del Cliente</h3>
            <p><strong>Nombre:</strong> ${escapeHtml(proyecto.cliente)}</p>
            <p><strong>Teléfono:</strong> ${escapeHtml(proyecto.telefono)}</p>
            <p>--------------------------------</p>
            <h3>Detalle del Equipo</h3>
            <p><strong>Equipo:</strong> ${escapeHtml(proyecto.equipo).toUpperCase()}</p>
            <p><strong>Modelo:</strong> ${escapeHtml(proyecto.modelo)}</p>
            ${htmlExtra}
            <p><strong>Condición:</strong> ${escapeHtml(proyecto.accesorios) || 'Ninguna descrita'}</p>
            <p>--------------------------------</p>
            <h3>Trabajo Solicitado</h3>
            <p>${escapeHtml(proyecto.falla)}</p>
            <p>--------------------------------</p>
            <h3 class="total">Costo Total: ${costoFormateado}</h3>
            <p style="text-align:right;">Abono Inicial: ${abonoFormateado}</p>
            <h3 class="total" style="font-size:18px;">Saldo Pendiente: ${saldoFormateado}</h3>
            <p>--------------------------------</p>
            <div style="text-align:center; margin: 15px 0;">
                <img id="qr-impresion" src="${qrUrl}" alt="QR Code" style="width:100px; height:100px;">
                <p style="font-size: 11px; margin-top:5px;">Escanea para ver el estado en vivo</p>
            </div>
            <p>--------------------------------</p>
            <p class="nota">Presente este ticket para retirar su equipo.</p>
            <p class="gracias">¡Gracias por su confianza!</p>
        </div>
    `;

    const qrImg = document.getElementById('qr-impresion');
    if (qrImg) {
        qrImg.onload = () => window.print();
        qrImg.onerror = () => window.print();
        setTimeout(() => { if (!qrImg.complete) window.print(); }, 1500);
    } else {
        window.print();
    }
};

// Eventos de búsqueda
buscador.addEventListener('input', renderizarProyectos);
filtroEstado.addEventListener('change', renderizarProyectos);

// ========================
// 6. FIRMA DIGITAL
// ========================
let isDrawing = false;
let currentFirmaId = null;
const canvas = document.getElementById('canvas-firma');
const ctx = canvas.getContext('2d');
const modalFirma = document.getElementById('modal-firma');

function getPointerPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
    };
}

function startDrawing(e) {
    isDrawing = true;
    const pos = getPointerPos(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    e.preventDefault();
}

function draw(e) {
    if (!isDrawing) return;
    const pos = getPointerPos(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    e.preventDefault();
}

function stopDrawing() { isDrawing = false; }

canvas.addEventListener('mousedown', startDrawing);
canvas.addEventListener('mousemove', draw);
canvas.addEventListener('mouseup', stopDrawing);
canvas.addEventListener('mouseout', stopDrawing);
canvas.addEventListener('touchstart', startDrawing, {passive: false});
canvas.addEventListener('touchmove', draw, {passive: false});
canvas.addEventListener('touchend', stopDrawing);

document.getElementById('btn-limpiar-firma').addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
});

document.getElementById('btn-cancelar-firma').addEventListener('click', () => {
    modalFirma.style.display = 'none';
});

// ALTERNATIVA SIN STORAGE: Comprimir firma y guardar en Firestore
document.getElementById('btn-guardar-firma').addEventListener('click', async () => {
    const btnGuardar = document.getElementById('btn-guardar-firma');
    btnGuardar.textContent = 'Guardando...';
    btnGuardar.disabled = true;

    try {
        // Crear un canvas temporal más pequeño para comprimir la imagen
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = 200;   // Reducido desde 300
        tempCanvas.height = 80;   // Reducido desde 150
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(canvas, 0, 0, 200, 80);

        // JPEG con calidad 0.4 = ~5-10KB (vs ~120KB de PNG original)
        const dataUrl = tempCanvas.toDataURL('image/jpeg', 0.4);

        await db.collection('equipos').doc(currentFirmaId).update({
            estado: 'entregado',
            firmaCliente: dataUrl
        });

        modalFirma.style.display = 'none';
        Swal.fire('¡Entregado!', 'Equipo entregado con firma del cliente guardada.', 'success');
    } catch (error) {
        console.error(error);
        Swal.fire('Error', 'No se pudo guardar la firma.', 'error');
    } finally {
        btnGuardar.textContent = 'Guardar y Entregar';
        btnGuardar.disabled = false;
    }
});

// ========================
// 7. PWA SERVICE WORKER REGISTRO
// ========================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').then(registration => {
            console.log('ServiceWorker registrado con exito:', registration.scope);
        }, err => {
            console.log('Fallo al registrar el ServiceWorker:', err);
        });
    });
}


// ========================
// 8. NAVEGACION TALLER / CATALOGO
// ========================
document.getElementById('btn-nav-taller').addEventListener('click', () => {
    document.getElementById('vista-taller').style.display = 'block';
    document.getElementById('vista-catalogo').style.display = 'none';
});

document.getElementById('btn-nav-catalogo').addEventListener('click', () => {
    document.getElementById('vista-taller').style.display = 'none';
    document.getElementById('vista-catalogo').style.display = 'block';
    cargarCatalogo();
});


// ========================
// 9. LOGICA DE CATALOGO INTELIGENTE
// ========================
let catalogoDB = [];

async function cargarCatalogo() {
    if (!currentUser) return;
    db.collection('catalogo').where('uid', '==', currentUser.uid).onSnapshot(snapshot => {
        catalogoDB = [];
        document.getElementById('lista-catalogo').innerHTML = '';
        snapshot.forEach(doc => {
            const data = doc.data();
            data.id = doc.id;
            catalogoDB.push(data);
            // Renderizar tarjeta
            document.getElementById('lista-catalogo').innerHTML += \`n            <div class="tarjeta-proyecto"> 
                <h3 style="margin:0; color:var(--primary);">\ \</h3>
                <p style="margin-top:5px;"><strong>Reparaci�n:</strong> \</p>
                <p class="precio" style="margin-bottom:0;">?? Precio: \$\</p>
                <div style="margin-top:10px; text-align:right;">
                    <button class="btn-icon btn-outline-danger" onclick="eliminarCatalogo('\')">??? Eliminar</button>
                </div>
            </div>\;
        });
        // Actualizar formulario de ingreso
        actualizarOpcionesIngreso();
    });
}

window.eliminarCatalogo = async function(id) {
    if(confirm('�Eliminar este precio?')) {
        await db.collection('catalogo').doc(id).delete();
    }
};

document.getElementById('catalogo-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return;
    const nuevo = {
        uid: currentUser.uid,
        marca: document.getElementById('cat-marca').value,
        modelo: document.getElementById('cat-modelo').value,
        reparacion: document.getElementById('cat-reparacion').value,
        precio: Number(document.getElementById('cat-precio').value)
    };
    await db.collection('catalogo').add(nuevo);
    document.getElementById('catalogo-form').reset();
    Swal.fire({toast: true, position: 'top-end', icon: 'success', title: 'Precio guardado', showConfirmButton: false, timer: 2000});
});


// LOGICA AUTO-COMPLETADO
function actualizarOpcionesIngreso() {
    // No sobreescribir marcas, ya que estan hardcodeadas en HTML, o podriamos a�adir dinamicamente.
}

document.getElementById('marca').addEventListener('change', (e) => {
    const marcaSeleccionada = e.target.value;
    const selectModelo = document.getElementById('modelo');
    selectModelo.innerHTML = '<option value="">-- Selecciona Modelo --</option>';
    
    if(marcaSeleccionada === 'Otro') {
        selectModelo.disabled = false;
        selectModelo.innerHTML += '<option value="Otro">Escribir Manualmente...</option>';
        document.getElementById('tipo-reparacion').disabled = false;
        document.getElementById('tipo-reparacion').innerHTML = '<option value="Otra">Escribir Manualmente...</option>';
        return;
    }

    // Buscar modelos unicos para la marca en el catalogo
    const modelos = [...new Set(catalogoDB.filter(c => c.marca.toLowerCase() === marcaSeleccionada.toLowerCase()).map(c => c.modelo))];
    
    if(modelos.length > 0) {
        selectModelo.disabled = false;
        modelos.forEach(m => {
            selectModelo.innerHTML += \<option value="\">\</option>\;
        });
    } else {
        selectModelo.innerHTML = '<option value="">Sin modelos (Carga en cat�logo o elige Otro)</option>';
        selectModelo.disabled = true;
    }
    selectModelo.innerHTML += '<option value="Otro">Otro (Fuera de cat�logo)</option>';
    selectModelo.disabled = false;
});

document.getElementById('modelo').addEventListener('change', (e) => {
    const modeloSeleccionado = e.target.value;
    const selectReparacion = document.getElementById('tipo-reparacion');
    selectReparacion.innerHTML = '<option value="">-- Selecciona Reparaci�n --</option>';

    const reparaciones = catalogoDB.filter(c => c.modelo === modeloSeleccionado);
    
    if(reparaciones.length > 0) {
        selectReparacion.disabled = false;
        reparaciones.forEach(r => {
            selectReparacion.innerHTML += \<option value="\">\</option>\;
        });
    }
    selectReparacion.innerHTML += '<option value="Otra">Otra (Escribir precio manual)</option>';
    selectReparacion.disabled = false;
});

document.getElementById('tipo-reparacion').addEventListener('change', (e) => {
    const repId = e.target.value;
    if(repId && repId !== 'Otra') {
        const item = catalogoDB.find(c => c.id === repId);
        if(item) {
            document.getElementById('costo').value = item.precio;
        }
    } else {
        document.getElementById('costo').value = '';
    }
});



