import { createHash, randomBytes } from 'node:crypto';
const hash = s => createHash('sha256').update(s).digest('hex');
const fallo = (status, message) => { throw Object.assign(new Error(message), { status }); };
const idValido = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(id);
const clave = id => { if (!idValido(id)) fallo(400, 'Identificador inválido.'); return id; };
const texto = (s, max = 500) => String(s ?? '').trim().slice(0, max);
const foto = valor => {
    if (typeof valor !== 'string' || valor.length > 1500000 || !/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(valor)) fallo(400, 'Imagen JPEG/PNG inválida o demasiado grande.');
    const tipo = valor.startsWith('data:image/png') ? 'png' : 'jpeg', bytes = Buffer.from(valor.split(',')[1], 'base64');
    const firma = tipo === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!firma || bytes.length > 1000000) fallo(400, 'El contenido no coincide con el formato de imagen.');
    return { bytes, tipo, sha256: hash(bytes) };
};
export function presupuestoPublico(p) {
    if (!p || !Number.isInteger(p.version) || !Array.isArray(p.lineas) || p.lineas.length > 20) fallo(409, 'No hay presupuesto válido.');
    return { version: p.version, total: p.total, lineas: p.lineas.map(l => ({ concepto: l.concepto, cantidad: l.cantidad, precio: l.precio })), condiciones: p.condiciones || '', plazo: p.plazo || '' };
}
export function resumen(ordenes, pagos, ahora = Date.now()) {
    const mes = fecha => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit' }).format(new Date(fecha));
    const periodo = mes(ahora);
    return { ordenes: ordenes.length, activas: ordenes.filter(p => p.estado !== 'entregado').length,
        saldo: ordenes.reduce((n, p) => n + Math.max(0, Number(p.costo || 0) - Number(p.abono || 0)), 0),
        garantias: ordenes.filter(p => p.garantia?.estado === 'abierta').length,
        netoMes: pagos.filter(p => p.confirmado && mes(p.confirmado.toMillis ? p.confirmado.toMillis() : p.confirmado) === periodo).reduce((n, p) => n + p.monto, 0), periodo, zonaHoraria: 'America/Santiago' };
}
export function crearBackend({ db, stamp, ahora = Date.now, bucket, proveedor, habilitarEnvios = false }) {
    const doc = (col, id) => db.collection(col).doc(clave(id));
    const ordenRef = id => doc('equipos', id);
    const privado = (uid, col, id) => doc('usuarios/' + clave(uid) + '/' + col, id);
    async function propia(uid, id, tx) {
        clave(uid); const r = ordenRef(id), snap = await (tx ? tx.get(r) : r.get());
        if (!snap.exists || snap.data().uid !== uid) fallo(404, 'Orden no disponible.');
        return { ref: r, p: snap.data() };
    }
    function evento(tx, uid, id, p, opId, accion, datos, parche = {}) {
        tx.update(ordenRef(id), { ...parche, revisionOrden: (p.revisionOrden || 0) + 1, ultimaOperacion: opId, actualizado: stamp() });
        tx.set(privado(uid, 'eventos', opId), { uid, ordenId: id, accion, huella: hash(JSON.stringify(datos)), resumen: datos.resumen,
            en: ahora(), confirmado: stamp(), revision: (p.revisionOrden || 0) + 1, ...datos });
    }
    async function emitirEnlace(uid, id) {
        const token = randomBytes(32).toString('base64url'), digest = hash(token), expira = ahora() + 48 * 3600000;
        await db.runTransaction(async tx => {
            const { p } = await propia(uid, id, tx);
            if (p.estado === 'entregado' || p.presupuesto?.autorizacion.estado !== 'pendiente') fallo(409, 'Se requiere un presupuesto pendiente de una orden activa.');
            const presupuesto = presupuestoPublico(p.presupuesto);
            tx.set(doc('aprobacionesPrivadas', digest), { uid, ordenId: id, presupuesto, expira, usado: false, creado: stamp() });
            evento(tx, uid, id, p, digest, 'enlace', { resumen: 'Enlace de aprobación emitido; invalida enlaces anteriores' }, { aprobacionActiva: digest });
        });
        return { token, expira };
    }
    async function aprobar(token, decision, nombre) {
        if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) fallo(404, 'Enlace no disponible.');
        const digest = hash(token), ref = doc('aprobacionesPrivadas', digest);
        return db.runTransaction(async tx => {
            const enlace = await tx.get(ref);
            if (!enlace.exists) fallo(404, 'Enlace no disponible.');
            const e = enlace.data(), { p } = await propia(e.uid, e.ordenId, tx);
            if (e.expira <= ahora() || p.aprobacionActiva !== digest || p.estado === 'entregado' ||
                JSON.stringify(presupuestoPublico(p.presupuesto)) !== JSON.stringify(e.presupuesto)) fallo(410, 'El enlace venció o cambió el presupuesto. Solicita uno nuevo.');
            if (e.usado) {
                if (decision === e.decision && texto(nombre, 120) === e.nombre) return { confirmado: true, decision: e.decision };
                fallo(409, 'Este enlace ya fue utilizado.');
            }
            if (p.presupuesto.autorizacion.estado !== 'pendiente') fallo(409, 'El presupuesto ya tiene una decisión registrada.');
            if (!decision) return { presupuesto: e.presupuesto, expira: e.expira };
            if (!['aprobado', 'rechazado'].includes(decision) || texto(nombre, 120).length < 3) fallo(400, 'Indica tu nombre y una decisión válida.');
            const presupuesto = { ...p.presupuesto, autorizacion: { estado: decision, version: p.presupuesto.version, medio: 'enlace-protegido',
                evidencia: 'Decisión por posesión de enlace; nombre declarado: ' + texto(nombre, 120), en: ahora(), por: 'cliente-enlace' } };
            tx.update(ref, { usado: true, decision, nombre: texto(nombre, 120), confirmado: stamp() });
            const parche = { presupuesto };
            if (p.estado === 'reparado' && decision === 'rechazado') {
                parche.estado = 'revision';
                tx.set(doc('seguimiento', e.ordenId), { uid: e.uid, estado: 'revision', modelo: String(p.modelo || '').slice(0, 80), actualizado: stamp() });
            }
            evento(tx, e.uid, e.ordenId, p, digest + '-decision', 'autorizar', { resumen: 'Presupuesto v' + presupuesto.version + ' ' + decision + ' mediante enlace', presupuesto }, parche);
            return { confirmado: true, decision };
        });
    }
    async function migrarArchivo(uid, id, tipo) {
        if (!['evidencia', 'firmaCliente'].includes(tipo)) fallo(400, 'Tipo de archivo inválido.');
        if (!bucket) fallo(503, 'Storage privado no está configurado.');
        const { p } = await propia(uid, id);
        if (!p[tipo]) {
            if (p.archivos?.[tipo]) return { migrado: true };
            fallo(404, 'La orden no tiene ese archivo.');
        }
        const imagen = foto(p[tipo]), ruta = 'privado/' + uid + '/' + id + '/' + tipo + '/' + imagen.sha256;
        const archivo = bucket.file(ruta);
        try { await archivo.save(imagen.bytes, { resumable: false, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: 'image/' + imagen.tipo, cacheControl: 'private, no-store', metadata: { sha256: imagen.sha256 } } }); }
        catch (e) { if (Number(e.code) !== 412) throw e; }
        const [verificado] = await archivo.download();
        if (hash(verificado) !== imagen.sha256) fallo(500, 'No se verificó la copia; el original se conserva.');
        await db.runTransaction(async tx => {
            const { p: actual } = await propia(uid, id, tx);
            if (!actual[tipo] && actual.archivos?.[tipo]?.sha256 === imagen.sha256) return;
            if (actual[tipo] !== p[tipo]) fallo(409, 'El archivo cambió; el original no fue eliminado.');
            evento(tx, uid, id, actual, randomBytes(16).toString('hex'), 'archivo', { resumen: 'Archivo privado verificado: ' + tipo },
                { [tipo]: '', archivos: { ...actual.archivos, [tipo]: { ruta, sha256: imagen.sha256, tipo: imagen.tipo, bytes: imagen.bytes.length, migrado: ahora(), retenerHasta: null } } });
        });
        return { migrado: true };
    }
    async function leerArchivo(uid, id, tipo) {
        if (!['evidencia', 'firmaCliente'].includes(tipo)) fallo(400, 'Tipo de archivo inválido.');
        const { p } = await propia(uid, id);
        const a = p.archivos?.[tipo];
        if (!a || a.borrado || !bucket || !a.ruta.startsWith('privado/' + uid + '/' + id + '/' + tipo + '/')) fallo(404, 'Archivo no disponible.');
        const [bytes] = await bucket.file(a.ruta).download();
        if (hash(bytes) !== a.sha256) fallo(500, 'El archivo no supera la verificación de integridad.');
        return { dataUrl: 'data:image/' + a.tipo + ';base64,' + bytes.toString('base64') };
    }
    async function retencion(uid, id, dias, confirmar) {
        if (confirmar !== true || !Number.isInteger(dias) || dias < 90 || dias > 3650) fallo(400, 'Confirma una conservación de 90 a 3650 días desde hoy.');
        await db.runTransaction(async tx => {
            const { p } = await propia(uid, id, tx);
            if (!p.archivos) fallo(409, 'Primero migra los archivos a Storage.');
            if (Object.values(p.archivos).some(a => a.eliminando)) fallo(409, 'Hay una eliminación en curso; la retención ya no se puede extender.');
            const archivos = Object.fromEntries(Object.entries(p.archivos).map(([k, v]) => [k, { ...v, retenerHasta: ahora() + dias * 86400000 }]));
            evento(tx, uid, id, p, randomBytes(16).toString('hex'), 'retencion', { resumen: 'Retención autorizada: ' + dias + ' días desde hoy' }, { archivos });
        });
        return { confirmado: true };
    }
    async function purgarOrden(id) {
        if (!bucket) return;
        const ref = ordenRef(id), snap = await ref.get(); if (!snap.exists) return;
        const p = snap.data();
        // Nunca se borra por defecto: retenerHasta solo existe tras confirmación explícita.
        for (const [tipo, a] of Object.entries(p.archivos || {})) {
            if (!a.retenerHasta || a.retenerHasta > ahora() || a.borrado || !['evidencia', 'firmaCliente'].includes(tipo)) continue;
            // Marcar primero: bloquear cualquier extensión concurrente de retención durante borrado.
            const marcado = await db.runTransaction(async tx => {
                const { p: actual } = await propia(p.uid, id, tx), v = actual.archivos?.[tipo];
                if (!v || v.sha256 !== a.sha256 || !v.retenerHasta || v.retenerHasta > ahora() || v.borrado) return false;
                tx.update(ref, { archivos: { ...actual.archivos, [tipo]: { ...v, eliminando: true } } }); return true;
            });
            if (!marcado) continue;
            if (!a.ruta.startsWith('privado/' + p.uid + '/' + id + '/' + tipo + '/')) fallo(500, 'Ruta de archivo inválida.');
            await bucket.file(a.ruta).delete({ ignoreNotFound: true });
            await db.runTransaction(async tx => {
                const { p: actual } = await propia(p.uid, id, tx);
                evento(tx, p.uid, id, actual, randomBytes(16).toString('hex'), 'retencion', { resumen: 'Archivo eliminado por retención: ' + tipo },
                    { archivos: { ...actual.archivos, [tipo]: { ...actual.archivos[tipo], borrado: ahora(), eliminando: false } } });
            });
        }
    }
    const telefonoDe = p => { const tel = String(p.telefono || '').replace(/\D/g, ''); if (!/^\d{8,15}$/.test(tel)) fallo(400, 'Teléfono inválido.'); return tel; };
    async function consentimiento(uid, id, aceptado, evidencia) {
        if (typeof aceptado !== 'boolean' || texto(evidencia).length < 5) fallo(400, 'Registra consentimiento o revocación con evidencia.');
        await db.runTransaction(async tx => {
            const { p } = await propia(uid, id, tx), telefono = telefonoDe(p);
            tx.set(privado(uid, 'consentimientos', hash(telefono)), { telefono, aceptado, evidencia: texto(evidencia), actualizado: stamp() });
            evento(tx, uid, id, p, randomBytes(16).toString('hex'), 'consentimiento', { resumen: aceptado ? 'Consentimiento de contacto registrado' : 'Consentimiento de contacto revocado' });
        }); return { confirmado: true };
    }
    async function encolar(uid, id, tipo, opId) {
        clave(opId);
        if (!['retiro', 'repuesto', 'presupuesto', 'garantia'].includes(tipo)) fallo(400, 'Tipo de mensaje inválido.');
        const ref = doc('colaMensajes', hash(uid + ':' + opId));
        await db.runTransaction(async tx => {
            const { p } = await propia(uid, id, tx), telefono = telefonoDe(p);
            const [permiso, previo] = await Promise.all([tx.get(privado(uid, 'consentimientos', hash(telefono))), tx.get(ref)]);
            if (!permiso.exists || !permiso.data().aceptado) fallo(409, 'No hay consentimiento vigente para este teléfono.');
            if (previo.exists) {
                if (previo.data().ordenId !== id || previo.data().tipo !== tipo) fallo(409, 'Identificador de mensaje reutilizado.');
                return;
            }
            const mensaje = 'KryoFix: actualización de su orden ' + (p.idOrden || id) + '. ' +
                ({ retiro: 'Su equipo está listo para coordinar el retiro.', repuesto: 'Su reparación continúa pendiente de repuesto.', presupuesto: 'Tiene un presupuesto pendiente. Contacte al taller para revisarlo.', garantia: 'Contacte al taller para revisar su caso de garantía.' }[tipo]);
            tx.set(ref, { uid, ordenId: id, tipo, telefono, mensaje, estado: 'pendiente', intentos: 0, siguiente: ahora(), creado: stamp() });
            tx.set(privado(uid, 'mensajes', ref.id), { ordenId: id, tipo, estado: 'pendiente', creado: stamp() });
        }); return { id: ref.id, estado: 'pendiente' };
    }
    async function procesarMensaje(id) {
        // Desactivado por defecto; jamás simula un envío cuando no hay proveedor.
        if (!habilitarEnvios || !proveedor) return { enviado: false };
        const ref = doc('colaMensajes', id), lease = randomBytes(16).toString('hex');
        const trabajo = await db.runTransaction(async tx => {
            const snap = await tx.get(ref); if (!snap.exists) return null;
            const m = snap.data();
            if (!['pendiente', 'reintento', 'procesando'].includes(m.estado) || m.siguiente > ahora() || (m.leaseHasta || 0) > ahora()) return null;
            const { p } = await propia(m.uid, m.ordenId, tx), permiso = await tx.get(privado(m.uid, 'consentimientos', hash(m.telefono)));
            const valido = permiso.exists && permiso.data().aceptado && telefonoDe(p) === m.telefono &&
                ({ retiro: p.estado === 'reparado', repuesto: p.estado === 'repuesto', presupuesto: p.presupuesto?.autorizacion.estado === 'pendiente', garantia: p.garantia?.estado === 'abierta' }[m.tipo]);
            if (!valido || m.intentos >= 5) {
                const estado = valido ? 'fallido' : 'cancelado';
                tx.update(ref, { estado }); tx.update(privado(m.uid, 'mensajes', id), { estado, actualizado: stamp() }); return null;
            }
            tx.update(ref, { estado: 'procesando', lease, leaseHasta: ahora() + 120000, intentos: m.intentos + 1 });
            return m;
        });
        if (!trabajo) return { enviado: false };
        try {
            // El adaptador DEBE deduplicar por esta clave, incluso tras timeout con entrega incierta.
            const r = await proveedor({ idempotencyKey: id, telefono: trabajo.telefono, mensaje: trabajo.mensaje });
            if (!r || typeof r.id !== 'string' || !r.id) throw new Error('Respuesta inválida del proveedor');
            await db.runTransaction(async tx => {
                const actual = await tx.get(ref);
                if (actual.data().lease !== lease) return;
                tx.update(ref, { estado: 'aceptado', proveedorId: r.id, leaseHasta: 0, actualizado: stamp() });
                tx.update(privado(trabajo.uid, 'mensajes', id), { estado: 'aceptado', proveedorId: r.id, actualizado: stamp() });
            });
            return { enviado: true };
        } catch (_e) {
            await db.runTransaction(async tx => {
                const actual = await tx.get(ref); if (actual.data().lease !== lease) return;
                const estado = actual.data().intentos >= 5 ? 'fallido' : 'reintento';
                tx.update(ref, { estado, leaseHasta: 0, siguiente: ahora() + Math.min(3600000, 60000 * 2 ** actual.data().intentos) });
                tx.update(privado(trabajo.uid, 'mensajes', id), { estado, actualizado: stamp() });
            }); return { enviado: false };
        }
    }
    async function confirmarMensaje(id, proveedorId, estado) {
        if (!['entregado', 'fallido'].includes(estado)) fallo(400, 'Estado de entrega inválido.');
        await db.runTransaction(async tx => {
            const ref = doc('colaMensajes', id), snap = await tx.get(ref);
            if (!snap.exists || snap.data().proveedorId !== proveedorId) fallo(409, 'Confirmación no corresponde al mensaje.');
            const m = snap.data();
            if (m.estado === 'entregado') return; // Una confirmación tardía no revierte entrega.
            tx.update(ref, { estado, actualizado: stamp() }); tx.update(privado(m.uid, 'mensajes', id), { estado, actualizado: stamp() });
        }); return { confirmado: true };
    }
    async function calcularMetricas(uid) {
        clave(uid);
        // Query transaccional de Admin: corte consistente, no suma de páginas de momentos distintos.
        return db.runTransaction(async tx => {
            const [ordenes, pagos] = await Promise.all([tx.get(db.collection('equipos').where('uid', '==', uid).limit(5001)), tx.get(db.collection('usuarios/' + uid + '/pagos').limit(10001))]);
            if (ordenes.size > 5000 || pagos.size > 10000) fallo(413, 'El informe excede el límite del corte atómico. Requiere agregación incremental antes de ampliar este taller.');
            const resultado = resumen(ordenes.docs.map(d => d.data()), pagos.docs.map(d => d.data()), ahora());
            tx.set(privado(uid, 'metricas', 'taller'), { ...resultado, confirmado: stamp() }); return resultado;
        });
    }
    return { emitirEnlace, aprobar, migrarArchivo, leerArchivo, retencion, purgarOrden, consentimiento, encolar, procesarMensaje, confirmarMensaje, calcularMetricas };
}
