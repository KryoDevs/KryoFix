// ========================
// CONFIGURACION DE FIREBASE
// ========================
const firebaseConfig = {
    apiKey: "AIzaSyC5hHgmyDXEWmzKzHRoywJk__iHgRcJ8F8",
    authDomain: "techfix-tracker-9a128.firebaseapp.com",
    projectId: "techfix-tracker-9a128",
    storageBucket: "techfix-tracker-9a128.firebasestorage.app",
    messagingSenderId: "434780023940",
    appId: "1:434780023940:web:e595dc76ac51d865a7a6d1"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

db.enablePersistence().catch(err => console.error("Error offline:", err.code));

// ========================
// REFERENCIAS AL DOM
// ========================
const loginScreen      = document.getElementById('login-screen');
const appContent       = document.getElementById('app-content');
const loginForm        = document.getElementById('login-form');
const btnLogout        = document.getElementById('btn-logout');
const btnTheme         = document.getElementById('btn-theme');
const userEmailDisplay = document.getElementById('user-email-display');
const form             = document.getElementById('proyecto-form');
const listaProyectos   = document.getElementById('lista-proyectos');
const buscador         = document.getElementById('buscador');
const filtroEstado     = document.getElementById('filtro-estado');
const ticketImpresion  = document.getElementById('ticket-impresion');
const loader           = document.getElementById('loader');
const statActivos      = document.getElementById('stat-activos');
const statReparados    = document.getElementById('stat-reparados');
const statIngresos     = document.getElementById('stat-ingresos');
const modalFirma       = document.getElementById('modal-firma');
const canvas           = document.getElementById('canvas-firma');
const ctx              = canvas ? canvas.getContext('2d') : null;

let proyectos            = [];
let unsubscribeDB        = null;
let currentUser          = null;
let currentFirmaId       = null;
let catalogoDB           = [];
let fotoComprimidaBase64 = null;

// ========================
// UTILIDAD: Escape XSS
// ========================
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(String(text)));
    return div.innerHTML;
}

// ========================
// 1. TEMA
// ========================
const currentTheme = localStorage.getItem('theme') || 'light';
document.documentElement.setAttribute('data-theme', currentTheme);
btnTheme.textContent = currentTheme === 'dark' ? 'Modo Claro' : 'Modo';

btnTheme.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    btnTheme.textContent = newTheme === 'dark' ? 'Modo Claro' : 'Modo';
});

// ========================
// 2. AUTENTICACION
// ========================
auth.onAuthStateChanged(user => {
    if (user) {
        currentUser = user;
        loginScreen.style.display = 'none';
        appContent.style.display = 'block';
        if (userEmailDisplay) userEmailDisplay.textContent = user.email;
        cargarDatos();
        cargarCatalogo();
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Bienvenido!', showConfirmButton: false, timer: 2000 });
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
    const pass  = document.getElementById('login-password').value;
    const btn   = loginForm.querySelector('button[type="submit"]');
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
        proyectos = [];
        currentUser = null;
        listaProyectos.innerHTML = '';
        statActivos.textContent = '0';
        statReparados.textContent = '0';
        statIngresos.textContent = '$0';
    });
});

// ========================
// 3. BASE DE DATOS
// ========================
function cargarDatos() {
    if (!currentUser) return;
    loader.style.display = 'block';
    unsubscribeDB = db.collection('equipos')
        .orderBy('timestamp', 'desc')
        .limit(500)
        .onSnapshot((snapshot) => {
            proyectos = [];
            snapshot.forEach((doc) => {
                const data = doc.data();
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
            Swal.fire('Error de Permisos', 'Actualiza las reglas de Firestore en la consola de Firebase.', 'error');
        });
}

function actualizarDashboard() {
    const activos = proyectos.filter(p => p.estado !== 'entregado').length;
    const ahora = new Date();
    const mes = ahora.getMonth();
    const anio = ahora.getFullYear();
    const reparadosEsteMes = proyectos.filter(p => {
        if (p.estado !== 'reparado' && p.estado !== 'entregado') return false;
        const f = new Date(p.timestamp);
        return f.getMonth() === mes && f.getFullYear() === anio;
    }).length;
    const ingresosEsteMes = proyectos
        .filter(p => {
            if (p.estado !== 'reparado' && p.estado !== 'entregado') return false;
            const f = new Date(p.timestamp);
            return f.getMonth() === mes && f.getFullYear() === anio;
        })
        .reduce((sum, p) => sum + (Number(p.costo) || 0), 0);
    statActivos.textContent   = activos;
    statReparados.textContent = reparadosEsteMes;
    statIngresos.textContent  = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(ingresosEsteMes);
}

function renderizarProyectos() {
    const txt    = buscador.value.toLowerCase();
    const filtro = filtroEstado.value;
    const CLP    = v => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(v || 0);

    const estadoTextos = {
        ingresado: 'Ingresado', revision: 'En Revision',
        repuesto: 'Esperando Repuesto', reparado: 'Listo para Entregar', entregado: 'Entregado'
    };
    const estadoClases = {
        ingresado: 'estado-ingresado', revision: 'estado-revision',
        repuesto: 'estado-repuesto', reparado: 'estado-reparado', entregado: 'estado-entregado'
    };

    let filtrados = proyectos.filter(p => {
        const t = [p.cliente, p.equipo, p.modelo, p.falla, p.imei, p.accesorios].join(' ').toLowerCase();
        const matchTxt = t.includes(txt);
        let matchEst = true;
        if (filtro === 'activos')    matchEst = p.estado !== 'entregado';
        else if (filtro !== 'todos') matchEst = p.estado === filtro;
        return matchTxt && matchEst;
    });

    listaProyectos.innerHTML = '';
    if (filtrados.length === 0) {
        listaProyectos.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:40px;">No hay equipos.</p>';
        return;
    }

    filtrados.forEach(p => {
        const d = document.createElement('div');
        d.className = 'tarjeta-proyecto';
        const pin = p.pin ? '*'.repeat(p.pin.length) : '';
        const saldo = (p.costo || 0) - (p.abono || 0);
        
        let accionesExtra = '';
        if (p.estado !== 'entregado') {
            accionesExtra = '<button class="btn-icon btn-entregar" onclick="archivarProyecto(\'' + p.id + '\')">Entregar</button>';
        }
        
        let evidenciaHtml = '';
        if (p.evidencia) {
            evidenciaHtml = '<div style="text-align:center;margin-top:10px;"><img src="' + escapeHtml(p.evidencia) + '" style="max-width:100%;border-radius:8px;cursor:pointer;" onclick="verFoto(\'' + p.id + '\')"><p style="font-size:12px;color:var(--text-muted);">Evidencia Fotografica</p></div>';
        }
        let firmaHtml = '';
        if (p.firmaCliente) {
            firmaHtml = '<div style="text-align:center;margin-top:10px;"><img src="' + escapeHtml(p.firmaCliente) + '" class="firma-guardada" alt="Firma"><p style="font-size:12px;color:var(--text-muted);">Firma de Conformidad</p></div>';
        }

        d.innerHTML = '<div class="tarjeta-header">'
            + '<span class="badge-estado ' + (estadoClases[p.estado] || '') + '">' + (estadoTextos[p.estado] || p.estado) + '</span>'
            + '<span class="tarjeta-fecha">' + escapeHtml(p.fecha) + '</span>'
            + '</div>'
            + '<h3>' + escapeHtml(p.cliente) + '</h3>'
            + '<p>' + escapeHtml(p.equipo) + ' - ' + escapeHtml(p.modelo) + '</p>'
            + (p.imei  ? '<p style="font-size:12px;color:var(--text-muted);">IMEI: ' + escapeHtml(p.imei) + '</p>' : '')
            + (pin     ? '<p style="font-size:12px;color:var(--text-muted);">PIN: ' + pin + '</p>' : '')
            + '<p>Falla: ' + escapeHtml(p.falla) + '</p>'
            + (p.accesorios ? '<p style="font-size:13px;">' + escapeHtml(p.accesorios) + '</p>' : '')
            + '<p class="precio">Costo: ' + CLP(p.costo) + '<br><span style="font-size:12px;color:var(--text-muted);">Abono: ' + CLP(p.abono) + ' | Saldo: ' + CLP(saldo) + '</span></p>'
            + evidenciaHtml
            + firmaHtml
            + '<div class="acciones-tarjeta">'
            + '<select onchange="cambiarEstado(\'' + p.id + '\', this.value)" class="select-estado-rapido">'
            + '<option value="ingresado"' + (p.estado === 'ingresado' ? ' selected' : '') + '>Ingresado</option>'
            + '<option value="revision"'  + (p.estado === 'revision'  ? ' selected' : '') + '>Revision</option>'
            + '<option value="repuesto"'  + (p.estado === 'repuesto'  ? ' selected' : '') + '>Repuesto</option>'
            + '<option value="reparado"'  + (p.estado === 'reparado'  ? ' selected' : '') + '>Reparado</option>'
            + '</select>'
            + '<button class="btn-icon btn-whatsapp" onclick="enviarWhatsApp(\'' + p.id + '\')">WA</button>'
            + '<button class="btn-icon" onclick="imprimirBoleta(\'' + p.id + '\')">Ticket</button>'
            + accionesExtra
            + '<button class="btn-icon btn-outline-danger" onclick="eliminarProyectoPermanente(\'' + p.id + '\')">Borrar</button>'
            + '</div>';
        listaProyectos.appendChild(d);
    });
}

// ========================
// 4. FOTOGRAFIA EVIDENCIA
// ========================
document.getElementById('foto-evidencia').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) { fotoComprimidaBase64 = null; document.getElementById('preview-foto').style.display = 'none'; return; }
    const reader = new FileReader();
    reader.onload = function(ev) {
        const img = new Image();
        img.onload = function() {
            const max = 600;
            let w = img.width, h = img.height;
            if (w > h) { if (w > max) { h *= max / w; w = max; } } else { if (h > max) { w *= max / h; h = max; } }
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);
            fotoComprimidaBase64 = c.toDataURL('image/jpeg', 0.5);
            document.getElementById('img-evidencia-preview').src = fotoComprimidaBase64;
            document.getElementById('preview-foto').style.display = 'block';
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
});

window.verFoto = function(id) {
    const p = proyectos.find(x => x.id === id);
    if (p && p.evidencia) Swal.fire({ imageUrl: p.evidencia, imageAlt: 'Evidencia', width: '90%', padding: 0 });
};

// ========================
// 5. FORMULARIO NUEVO INGRESO
// ========================
form.addEventListener('submit', async function(e) {
    e.preventDefault();
    if (!currentUser) { Swal.fire('Error', 'Inicia sesion primero.', 'error'); return; }
    const selRep = document.getElementById('tipo-reparacion');
    const repTxt = selRep.options[selRep.selectedIndex] ? selRep.options[selRep.selectedIndex].text : '';
    const detalle = document.getElementById('falla').value;
    const skipTexts = ['-- Selecciona Reparacion --', 'Otra (precio manual)', '-- Selecciona Modelo Primero --'];
    const fallaFinal = (!skipTexts.includes(repTxt) && repTxt)
        ? repTxt + (detalle ? ' - ' + detalle : '') : detalle;

    const nuevoProyecto = {
        uid: currentUser.uid,
        cliente:    document.getElementById('cliente').value,
        telefono:   document.getElementById('telefono').value,
        equipo:     document.getElementById('marca').value,
        modelo:     document.getElementById('modelo').value,
        imei:       document.getElementById('imei').value || '',
        pin:        document.getElementById('pin').value  || '',
        accesorios: document.getElementById('accesorios').value,
        falla:      fallaFinal,
        estado:     document.getElementById('estado').value,
        costo:      Number(document.getElementById('costo').value),
        abono:      Number(document.getElementById('abono').value || 0),
        fecha:      new Date().toLocaleDateString('es-CL'),
        timestamp:  Date.now(),
        evidencia:  fotoComprimidaBase64 || null
    };

    const btnSubmit = form.querySelector('button[type="submit"]');
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Guardando...';
    try {
        await db.collection('equipos').add(nuevoProyecto);
        form.reset();
        fotoComprimidaBase64 = null;
        document.getElementById('preview-foto').style.display = 'none';
        document.getElementById('modelo').innerHTML = '<option value="">-- Selecciona Marca Primero --</option>';
        document.getElementById('modelo').disabled = true;
        document.getElementById('tipo-reparacion').innerHTML = '<option value="">-- Selecciona Modelo Primero --</option>';
        document.getElementById('tipo-reparacion').disabled = true;
        if (filtroEstado.value === 'entregado') filtroEstado.value = 'activos';
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Equipo guardado', showConfirmButton: false, timer: 3000 });
        listaProyectos.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
        Swal.fire('Error', 'No se pudo guardar. Revisa tu conexion.', 'error');
    } finally {
        btnSubmit.disabled = false;
        btnSubmit.textContent = 'Guardar y Generar Ticket';
    }
});

// ========================
// 6. ACCIONES DE TARJETA
// ========================
window.cambiarEstado = async function(id, nuevoEstado) {
    await db.collection('equipos').doc(id).update({ estado: nuevoEstado });
};

window.archivarProyecto = function(id) {
    currentFirmaId = id;
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    modalFirma.style.display = 'flex';
};

window.eliminarProyectoPermanente = async function(id) {
    const r = await Swal.fire({
        title: 'Eliminar permanentemente?', text: 'Esta accion no se puede deshacer.',
        icon: 'warning', showCancelButton: true, confirmButtonText: 'Si, eliminar',
        cancelButtonText: 'Cancelar', confirmButtonColor: '#ef4444'
    });
    if (r.isConfirmed) {
        await db.collection('equipos').doc(id).delete();
        Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Eliminado', showConfirmButton: false, timer: 2000 });
    }
};

window.enviarWhatsApp = function(id) {
    const p = proyectos.find(x => x.id === id);
    if (!p || !p.telefono) { Swal.fire('Error', 'Sin numero de telefono.', 'warning'); return; }
    const textos = { ingresado: 'recibido', revision: 'en revision tecnica', repuesto: 'esperando repuesto', reparado: 'reparado y listo para retirar', entregado: 'entregado' };
    const msg = 'Hola ' + p.cliente + ', tu equipo ' + p.equipo + ' ' + p.modelo + ' esta ' + (textos[p.estado] || p.estado) + '. Gracias!';
    window.open('https://wa.me/' + p.telefono + '?text=' + encodeURIComponent(msg), '_blank');
};

window.imprimirBoleta = function(id) {
    const p = proyectos.find(x => x.id === id);
    if (!p) return;
    const CLP = v => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(v || 0);
    const qrUrl = 'https://techfix-tracker-9a128.web.app/status.html?id=' + p.id;
    const qrApiUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=' + encodeURIComponent(qrUrl);
    ticketImpresion.innerHTML = '<div style="font-family:Courier New,monospace;font-size:12px;width:280px;margin:0 auto;padding:10px;border:1px solid #000;">'
        + '<div style="text-align:center;margin-bottom:8px;"><img src="logo.jpg" style="height:40px;"><h2 style="margin:5px 0;font-size:15px;">TechFix Pro</h2><p style="margin:0;font-size:10px;">Servicio Tecnico de Electronica</p><hr></div>'
        + '<p><b>N Orden:</b> ' + escapeHtml(p.id.substring(0, 8).toUpperCase()) + '</p>'
        + '<p><b>Cliente:</b> ' + escapeHtml(p.cliente) + '</p>'
        + '<p><b>Telefono:</b> ' + escapeHtml(p.telefono) + '</p>'
        + '<p><b>Equipo:</b> ' + escapeHtml(p.equipo) + ' ' + escapeHtml(p.modelo) + '</p>'
        + (p.imei ? '<p><b>IMEI:</b> ' + escapeHtml(p.imei) + '</p>' : '')
        + '<p><b>Falla:</b> ' + escapeHtml(p.falla) + '</p>'
        + (p.accesorios ? '<p><b>Accesorios:</b> ' + escapeHtml(p.accesorios) + '</p>' : '')
        + '<p><b>Fecha:</b> ' + escapeHtml(p.fecha) + '</p>'
        + '<hr>'
        + '<p><b>Presupuesto:</b> ' + CLP(p.costo) + '</p>'
        + '<p><b>Abono:</b> ' + CLP(p.abono) + '</p>'
        + '<p><b>Saldo:</b> ' + CLP((p.costo || 0) - (p.abono || 0)) + '</p>'
        + '<hr>'
        + '<p style="font-size:10px;text-align:center;">Escanea para ver el estado:</p>'
        + '<div style="text-align:center;"><img id="qr-img-print" src="' + qrApiUrl + '" width="100" height="100"></div>'
        + '<hr><p style="font-size:9px;text-align:center;">Equipos no retirados en 60 dias seran donados.</p></div>';

    const qrImg = document.getElementById('qr-img-print');
    const doPrint = () => setTimeout(() => window.print(), 500);
    if (qrImg.complete) doPrint();
    else { qrImg.onload = doPrint; qrImg.onerror = doPrint; setTimeout(doPrint, 1500); }
};

// ========================
// 7. MODAL FIRMA DIGITAL
// ========================
let isDrawing = false;
function getPointerPos(e) {
    const r = canvas.getBoundingClientRect();
    if (e.touches) return { x: e.touches[0].clientX - r.left, y: e.touches[0].clientY - r.top };
    return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function startDrawing(e) { isDrawing = true; const p = getPointerPos(e); if (ctx) { ctx.beginPath(); ctx.moveTo(p.x, p.y); } e.preventDefault(); }
function draw(e)         { if (!isDrawing || !ctx) return; const p = getPointerPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); }
function stopDrawing()   { isDrawing = false; }

if (canvas) {
    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseout', stopDrawing);
    canvas.addEventListener('touchstart', startDrawing, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stopDrawing);
}

document.getElementById('btn-limpiar-firma').addEventListener('click', () => { if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height); });
document.getElementById('btn-cancelar-firma').addEventListener('click', () => { modalFirma.style.display = 'none'; });
document.getElementById('btn-guardar-firma').addEventListener('click', async () => {
    const btn = document.getElementById('btn-guardar-firma');
    btn.textContent = 'Guardando...'; btn.disabled = true;
    try {
        const t = document.createElement('canvas');
        t.width = 200; t.height = 80;
        t.getContext('2d').drawImage(canvas, 0, 0, 200, 80);
        const dataUrl = t.toDataURL('image/jpeg', 0.4);
        await db.collection('equipos').doc(currentFirmaId).update({ estado: 'entregado', firmaCliente: dataUrl });
        modalFirma.style.display = 'none';
        Swal.fire('Entregado!', 'Equipo entregado con firma guardada.', 'success');
    } catch (err) {
        Swal.fire('Error', 'No se pudo guardar la firma.', 'error');
    } finally {
        btn.textContent = 'Guardar y Entregar'; btn.disabled = false;
    }
});

// ========================
// 8. PWA SERVICE WORKER
// ========================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(r => console.log('SW ok:', r.scope))
            .catch(e => console.log('SW err:', e));
    });
}

// ========================
// 9. NAVEGACION
// ========================
document.getElementById('btn-nav-taller').addEventListener('click', () => {
    document.getElementById('vista-taller').style.display = 'block';
    document.getElementById('vista-catalogo').style.display = 'none';
});
document.getElementById('btn-nav-catalogo').addEventListener('click', () => {
    document.getElementById('vista-taller').style.display = 'none';
    document.getElementById('vista-catalogo').style.display = 'block';
});

// ========================
// 10. CATALOGO DE PRECIOS
// ========================
function cargarCatalogo() {
    if (!currentUser) return;
    db.collection('catalogo').where('uid', '==', currentUser.uid).onSnapshot(snapshot => {
        catalogoDB = [];
        const lista = document.getElementById('lista-catalogo');
        if (!lista) return;
        lista.innerHTML = '';
        snapshot.forEach(doc => {
            const data = Object.assign({ id: doc.id }, doc.data());
            catalogoDB.push(data);
            const CLP = v => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(v || 0);
            lista.innerHTML += '<div class="tarjeta-proyecto" style="padding:15px;">'
                + '<h3 style="margin:0;color:var(--primary);">' + escapeHtml(data.marca) + ' - ' + escapeHtml(data.modelo) + '</h3>'
                + '<p style="margin-top:5px;"><strong>Reparacion:</strong> ' + escapeHtml(data.reparacion) + '</p>'
                + '<p class="precio" style="margin-bottom:0;">' + CLP(data.precio) + '</p>'
                + '<div style="margin-top:10px;text-align:right;"><button class="btn-icon btn-outline-danger" onclick="eliminarCatalogo(\'' + doc.id + '\')">Eliminar</button></div>'
                + '</div>';
        });
    });
}

window.eliminarCatalogo = async function(id) {
    const r = await Swal.fire({ title: 'Eliminar precio?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Si', cancelButtonText: 'No', confirmButtonColor: '#ef4444' });
    if (r.isConfirmed) await db.collection('catalogo').doc(id).delete();
};

document.getElementById('catalogo-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return;
    await db.collection('catalogo').add({
        uid:        currentUser.uid,
        marca:      document.getElementById('cat-marca').value,
        modelo:     document.getElementById('cat-modelo').value,
        reparacion: document.getElementById('cat-reparacion').value,
        precio:     Number(document.getElementById('cat-precio').value)
    });
    document.getElementById('catalogo-form').reset();
    Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: 'Precio guardado', showConfirmButton: false, timer: 2000 });
});

// ========================
// 11. AUTOCOMPLETADO: Marca > Modelo > Reparacion > Precio
// ========================
document.getElementById('marca').addEventListener('change', (e) => {
    const marca = e.target.value;
    const selModelo = document.getElementById('modelo');
    selModelo.innerHTML = '<option value="">-- Selecciona Modelo --</option>';
    selModelo.disabled = true;
    document.getElementById('tipo-reparacion').innerHTML = '<option value="">-- Selecciona Modelo Primero --</option>';
    document.getElementById('tipo-reparacion').disabled = true;
    document.getElementById('costo').value = '';
    if (!marca) return;
    const modelos = Array.from(new Set(catalogoDB.filter(c => c.marca.toLowerCase() === marca.toLowerCase()).map(c => c.modelo)));
    modelos.forEach(m => { selModelo.innerHTML += '<option value="' + escapeHtml(m) + '">' + escapeHtml(m) + '</option>'; });
    selModelo.innerHTML += '<option value="Otro">Otro (fuera de catalogo)</option>';
    selModelo.disabled = false;
});

document.getElementById('modelo').addEventListener('change', (e) => {
    const modelo = e.target.value;
    const selRep = document.getElementById('tipo-reparacion');
    selRep.innerHTML = '<option value="">-- Selecciona Reparacion --</option>';
    selRep.disabled = true;
    document.getElementById('costo').value = '';
    if (!modelo) return;
    const reps = catalogoDB.filter(c => c.modelo === modelo);
    reps.forEach(r => { selRep.innerHTML += '<option value="' + escapeHtml(r.id) + '">' + escapeHtml(r.reparacion) + '</option>'; });
    selRep.innerHTML += '<option value="Otra">Otra (precio manual)</option>';
    selRep.disabled = false;
});

document.getElementById('tipo-reparacion').addEventListener('change', (e) => {
    const repId = e.target.value;
    if (repId && repId !== 'Otra') {
        const item = catalogoDB.find(c => c.id === repId);
        if (item) document.getElementById('costo').value = item.precio;
    } else {
        document.getElementById('costo').value = '';
    }
});

// ========================
// 12. BUSCADOR Y FILTRO
// ========================
buscador.addEventListener('input', renderizarProyectos);
filtroEstado.addEventListener('change', renderizarProyectos);