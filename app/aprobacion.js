(function () {
    'use strict';
    const token = window.location.hash.slice(1), aviso = document.getElementById('aviso-aprobacion');
    const detalle = document.getElementById('detalle-presupuesto'), form = document.getElementById('decision-presupuesto');
    let ocupado = false, terminado = false;
    const clp = n => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
    async function solicitar(extra = {}) {
        const r = await fetch('/api/aprobacion', { method: 'POST', cache: 'no-store', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, ...extra }) });
        let d;
        try { d = await r.json(); } catch (_e) { throw new Error('El servicio no está disponible. Contacta al taller.'); }
        if (!r.ok) throw new Error(d.error || 'No se pudo confirmar la operación.');
        return d;
    }
    function agregar(tag, texto) { const e = document.createElement(tag); e.textContent = texto; detalle.appendChild(e); }
    async function iniciar() {
        if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { aviso.textContent = 'Enlace incompleto o inválido. Solicita uno nuevo al taller.'; return; }
        if (window.KryoFixEntorno?.modo === 'spark') { aviso.textContent = 'Este taller registra la aprobación manualmente. Contacta al técnico para confirmar tu presupuesto.'; return; }
        try {
            const d = await solicitar(), p = d.presupuesto;
            agregar('h3', 'Versión ' + p.version + ' · Total ' + clp(p.total));
            for (const l of p.lineas) agregar('p', l.concepto + ' × ' + l.cantidad + ' · unitario ' + clp(l.precio));
            agregar('p', 'Plazo: ' + p.plazo); agregar('p', 'Condiciones: ' + p.condiciones);
            aviso.textContent = 'Válido hasta ' + new Date(d.expira).toLocaleString('es-CL'); form.hidden = false;
        } catch (e) { aviso.textContent = e.message; }
    }
    form.addEventListener('submit', async e => {
        e.preventDefault(); if (ocupado || terminado || !form.reportValidity()) return;
        ocupado = true;
        const decision = e.submitter?.value, nombre = form.elements.namedItem('nombre').value;
        [...form.elements].forEach(c => { c.disabled = true; }); aviso.textContent = 'Confirmando decisión…';
        try {
            const d = await solicitar({ decision, nombre });
            if (!d.confirmado) throw new Error('No se recibió confirmación. Reintenta sin cambiar tu decisión.');
            terminado = true; aviso.textContent = 'Decisión confirmada: ' + d.decision + '. El taller ya puede consultarla.';
        } catch (err) { aviso.textContent = err.message + ' Si la conexión se interrumpió, reintenta la misma decisión.'; }
        finally { ocupado = false; [...form.elements].forEach(c => { c.disabled = terminado; }); }
    });
    iniciar();
})();
