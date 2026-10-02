/* =============================================================================
 * TechFix Tracker Pro
 * Gestion de ordenes de reparacion (Firebase Auth + Firestore, sin bundler).
 *
 * Modelo de datos:
 *   equipos/{id}      datos privados de la orden. Solo el tecnico dueno.
 *   catalogo/{id}     precios del tecnico. Solo el tecnico dueno.
 *   seguimiento/{id}  espejo PUBLICO minimo (estado + modelo) para el QR.
 * ========================================================================== */



// ========================
// NUEVAS MEJORAS (LOOP 3)
// ========================

// 1. Indicador de Red
function actualizarEstadoRed() {
    const statusObj = document.getElementById('red-status');
    if (!statusObj) return;
    if (navigator.onLine) {
        statusObj.textContent = '📶 Online';
        statusObj.className = 'badge-estado estado-reparado';
        statusObj.style.display = 'inline-block';
        setTimeout(() => statusObj.style.display = 'none', 3000);
    } else {
        statusObj.textContent = '📵 Offline (Guardando localmente)';
        statusObj.className = 'badge-estado estado-revision';
        statusObj.style.display = 'inline-block';
    }
}
window.addEventListener('online', actualizarEstadoRed);
window.addEventListener('offline', actualizarEstadoRed);
actualizarEstadoRed();

// 2. Buscador en Catalogo
const catBuscador = document.getElementById('cat-buscador');
if (catBuscador) {
    catBuscador.addEventListener('input', () => {
        const txt = catBuscador.value.toLowerCase();
        const lista = document.getElementById('lista-catalogo');
        if (!lista) return;
        lista.innerHTML = '';
        const filtrados = catalogoDB.filter(c => {
            const combinado = [c.marca, c.modelo, c.reparacion].join(' ').toLowerCase();
            return combinado.includes(txt);
        });
        
        if (!filtrados.length) {
            lista.innerHTML = '<p class="sin-resultados">No se encontraron precios.</p>';
            return;
        }
        
        const frag = document.createDocumentFragment();
        filtrados.sort((a, b) => String(a.marca).localeCompare(String(b.marca)) || String(a.modelo).localeCompare(String(b.modelo)))
            .forEach((data) => {
                const card = document.createElement('article');
                card.className = 'tarjeta-proyecto tarjeta-catalogo';
                card.innerHTML = '<h3>' + escapeHtml([data.marca, data.modelo].filter(Boolean).join(' - ')) + '</h3>' +
                                 '<p>Reparacion: ' + escapeHtml(data.reparacion || '') + '</p>' +
                                 '<p class="precio">' + CLP(data.precio) + '</p>' +
                                 '<div class="acciones-tarjeta"><button class="btn-icon btn-eliminar" type="button" data-accion="borrar-catalogo" data-id="' + escapeHtml(data.id) + '">🗑️ Eliminar</button></div>';
                frag.appendChild(card);
            });
        lista.appendChild(frag);
    });
}

// 3. Exportar a CSV
const btnExportar = document.getElementById('btn-exportar');
if (btnExportar) {
    btnExportar.addEventListener('click', () => {
        if (!proyectos || !proyectos.length) {
            Swal.fire('Vacio', 'No hay equipos para exportar.', 'info');
            return;
        }
        
        const cabeceras = ['ID', 'Fecha', 'Cliente', 'Telefono', 'Marca', 'Modelo', 'Falla', 'Estado', 'Costo', 'Abono'];
        const lineas = [cabeceras.join(',')];
        
        proyectos.forEach(p => {
            const fila = [
                p.id,
                p.fecha,
                `"${p.cliente || ''}"`,
                p.telefono || '',
                `"${p.equipo || ''}"`,
                `"${p.modelo || ''}"`,
                `"${p.falla || ''}"`,
                p.estado || '',
                p.costo || 0,
                p.abono || 0
            ];
            lineas.push(fila.join(','));
        });
        
        const csvContent = lineas.join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', 'techfix_proyectos_' + new Date().toISOString().split('T')[0] + '.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
}