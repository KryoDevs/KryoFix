/* Casos de uso transaccionales. Todos exigen sesión y conexión. */
(function () {
    'use strict';
    const D = () => window.KryoFixTallerDominio;
    const error = (code, message) => Object.assign(new Error(message), { code });
    function estable(valor) {
        if (Array.isArray(valor)) return valor.map(estable);
        if (valor && typeof valor === 'object') return Object.fromEntries(Object.keys(valor).sort().map(k => [k, estable(valor[k])]));
        return valor;
    }
    async function huella(valor) {
        const bytes = new TextEncoder().encode(JSON.stringify(estable(valor)));
        const digest = await window.crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    }
    function crear({ db, usuario, enLinea, timestampServidor }) {
        function sesion(uid) {
            if (!usuario() || usuario().uid !== uid) throw error('sesion-cambiada', 'La sesión cambió.');
            if (!enLinea()) throw error('sin-conexion', 'Esta operación requiere conexión y confirmación del servidor.');
        }
        const privada = (uid, nombre) => db.collection('usuarios/' + uid + '/' + nombre);
        const nuevoId = () => db.collection('equipos').doc().id;
        async function ejecutar({ id, uid, revision, opId, accion, datos = {} }) {
            sesion(uid);
            if (!opId || /[/\\]/.test(opId)) throw error('id-invalido', 'Identificador de operación inválido.');
            const hash = await huella({ id, accion, datos });
            const ref = db.collection('equipos').doc(id);
            const eventoRef = privada(uid, 'eventos').doc(opId);
            return db.runTransaction(async tx => {
                sesion(uid);
                const [doc, evento] = await Promise.all([tx.get(ref), tx.get(eventoRef)]);
                sesion(uid);
                if (!doc.exists || doc.data().uid !== uid) throw error('permission-denied', 'Orden no disponible para esta sesión.');
                if (evento.exists) {
                    if (evento.data().huella !== hash) throw error('id-reutilizado', 'El identificador ya corresponde a otra operación.');
                    return { repetida: true };
                }
                const p = doc.data();
                if ((p.revisionOrden || 0) !== revision) throw error('conflicto', 'La orden cambió en otra sesión. Recarga la ficha y revisa los datos antes de guardar.');
                const ahora = Date.now();
                let resultado;
                let repuestoRef, repuestoParche, pagoOriginalRef, movimientoRepuesto;
                if (['reservar', 'consumir', 'liberar'].includes(accion)) {
                    if (p.estado === 'entregado') throw error('orden-entregada', 'No se pueden cambiar repuestos de una orden entregada.');
                    repuestoRef = privada(uid, 'repuestos').doc(datos.repuestoId);
                    const rs = await tx.get(repuestoRef);
                    if (!rs.exists) throw error('not-found', 'Repuesto no encontrado.');
                    const r = rs.data();
                    if (accion !== 'liberar' && !(p.presupuesto ? D().autorizado(p) : Number(p.costo || 0) === 0)) throw error('sin-autorizacion', 'Autoriza un presupuesto vigente antes de reservar o consumir repuestos.');
                    const reservas = (p.reservas || []).map(x => ({ ...x }));
                    let resumen;
                    if (accion === 'reservar') {
                        const n = D().cantidad(datos.cantidad);
                        if (r.disponible < n) throw error('sin-stock', 'No hay stock suficiente. Registra la compra pendiente en las notas de la orden.');
                        if (String(r.modelo).trim().toLowerCase() !== String(p.modelo).trim().toLowerCase() || String(r.marca).trim().toLowerCase() !== String(p.equipo).trim().toLowerCase()) throw error('incompatible', 'El repuesto no coincide con la marca/modelo. Verifica la variante antes de reservar.');
                        if (!datos.compatibilidadConfirmada) throw error('incompatible', 'Confirma la variante y compatibilidad exacta.');
                        if (reservas.length >= 40) throw error('limite', 'Límite de movimientos de repuestos por orden alcanzado.');
                        reservas.push({ id: opId, repuestoId: datos.repuestoId, nombre: r.nombre, cantidad: n, costoUnitario: r.costo, estado: 'reservada', en: ahora });
                        repuestoParche = { disponible: r.disponible - n, reservado: (r.reservado || 0) + n };
                        movimientoRepuesto = { repuestoId: datos.repuestoId, cantidad: n, reservaId: opId, antes: null, despues: { ...reservas[reservas.length - 1] } };
                        resumen = 'Reserva: ' + n + ' × ' + r.nombre;
                    } else {
                        const reserva = reservas.find(x => x.id === datos.reservaId && x.repuestoId === datos.repuestoId);
                        if (!reserva || reserva.estado !== 'reservada') throw error('reserva-invalida', 'La reserva ya fue consumida o liberada.');
                        if ((r.reservado || 0) < reserva.cantidad) throw error('stock-invalido', 'Revisa el inventario: reserva inconsistente.');
                        movimientoRepuesto = { repuestoId: datos.repuestoId, cantidad: reserva.cantidad, reservaId: reserva.id, antes: { ...reserva } };
                        reserva.estado = accion === 'consumir' ? 'consumida' : 'liberada';
                        movimientoRepuesto.despues = { ...reserva };
                        repuestoParche = { reservado: r.reservado - reserva.cantidad,
                            disponible: r.disponible + (accion === 'liberar' ? reserva.cantidad : 0) };
                        resumen = (accion === 'consumir' ? 'Consumo: ' : 'Liberación: ') + reserva.cantidad + ' × ' + r.nombre;
                    }
                    resultado = { parche: { reservas }, resumen, pago: null };
                } else {
                    let originales = datos;
                    if (accion === 'plantilla') {
                        if (window.KryoFixBorradores.huella(p.procedimiento) !== datos.baseProcedimiento) throw error('conflicto', 'El procedimiento cambió; revisa la ficha antes de aplicar una plantilla.');
                        const plantilla = await tx.get(privada(uid, 'plantillas').doc(datos.plantillaId));
                        if (!plantilla.exists) throw error('not-found', 'La plantilla ya no está disponible.');
                        originales = { ...datos, plantilla: plantilla.data() };
                    }
                    if (accion === 'reverso') {
                        pagoOriginalRef = privada(uid, 'pagos').doc(datos.pagoId);
                        const original = await tx.get(pagoOriginalRef);
                        if (!original.exists || original.data().ordenId !== id) throw error('pago-invalido', 'El pago no pertenece a la orden.');
                        originales = { ...datos, original: { ...original.data(), id: datos.pagoId } };
                    }
                    resultado = D().aplicar(p, accion, originales, { ahora, uid, opId });
                }
                sesion(uid);
                const parche = { ...resultado.parche, revisionOrden: revision + 1, ultimaOperacion: opId, actualizado: timestampServidor() };
                if (parche.estado) {
                    parche.historial = [...(p.historial || []), { estado: parche.estado, en: ahora, por: uid }];
                    tx.set(db.collection('seguimiento').doc(id), { uid, estado: parche.estado,
                        modelo: String(p.modelo || '').slice(0, 80), actualizado: timestampServidor() });
                }
                if (resultado.pago) tx.set(privada(uid, 'pagos').doc(opId), { ...resultado.pago, ordenId: id, uid, confirmado: timestampServidor() });
                if (pagoOriginalRef) tx.update(pagoOriginalRef, { revertidoPor: opId });
                if (repuestoRef) tx.update(repuestoRef, { ...repuestoParche, origenOperacion: 'orden', ultimaOperacion: opId, actualizado: timestampServidor() });
                tx.update(ref, parche);
                const eventoNuevo = { ordenId: id, uid, accion, huella: hash, resumen: resultado.resumen,
                    en: ahora, confirmado: timestampServidor(), revision: revision + 1 };
                if (accion === 'presupuestar' || accion === 'autorizar') eventoNuevo.presupuesto = resultado.parche.presupuesto;
                if (accion === 'garantia') eventoNuevo.garantia = resultado.parche.garantia;
                if (movimientoRepuesto) eventoNuevo.repuesto = movimientoRepuesto;
                tx.set(eventoRef, eventoNuevo);
                return { repetida: false };
            });
        }
        async function crearOrden(uid, orden, id = nuevoId()) {
            sesion(uid);
            const firmaIngreso = await huella(Object.fromEntries(['cliente', 'telefono', 'equipo', 'modelo', 'imei', 'pin', 'accesorios', 'falla', 'costo', 'abono', 'estado', 'notas', 'prioridad', 'procedimiento', 'evidencia', 'clienteId'].map(k => [k, orden[k] ?? null])));
            const ref = db.collection('equipos').doc(id);
            const contador = privada(uid, 'config').doc('numeracion');
            const clienteRef = privada(uid, 'clientes').doc(orden.clienteId || nuevoId());
            return db.runTransaction(async tx => {
                sesion(uid);
                const [existe, numero, cliente] = await Promise.all([tx.get(ref), tx.get(contador), tx.get(clienteRef)]);
                sesion(uid);
                if (existe.exists) {
                    if (existe.data().uid !== uid) throw error('permission-denied', 'No disponible.');
                    if (existe.data().huellaIngreso !== firmaIngreso) throw error('id-reutilizado', 'Este ingreso ya fue guardado con otros datos. Revisa el historial antes de iniciar otro.');
                    return { ...existe.data(), id };
                }
                const n = (numero.exists ? numero.data().numero : 0) + 1;
                const creada = { ...orden, uid, schemaVersion: 2, revisionOrden: 0, huellaIngreso: firmaIngreso,
                    clienteId: clienteRef.id, numeroOrden: n, idOrden: 'KRF-' + String(n).padStart(6, '0') };
                tx.set(ref, creada);
                tx.set(contador, { numero: n });
                if (!cliente.exists) tx.set(clienteRef, { nombre: orden.cliente, telefono: orden.telefono, creado: timestampServidor() });
                tx.set(db.collection('seguimiento').doc(id), { uid, estado: orden.estado,
                    modelo: String(orden.modelo || '').slice(0, 80), actualizado: timestampServidor() });
                return { ...creada, id };
            });
        }
        async function guardarRepuesto(uid, datos, opId) {
            sesion(uid);
            const r = { nombre: D().texto(datos.nombre, 120), marca: D().texto(datos.marca, 60), modelo: D().texto(datos.modelo, 80),
                variante: D().texto(datos.variante, 100), proveedor: D().texto(datos.proveedor, 120), costo: D().dinero(datos.costo),
                disponible: D().cantidad(datos.cantidad), reservado: 0, creado: timestampServidor() };
            if (!r.nombre || !r.marca || !r.modelo) throw error('datos-invalidos', 'Completa nombre, marca y modelo del repuesto.');
            r.huella = await huella({ ...r, creado: undefined });
            const ref = privada(uid, 'repuestos').doc(opId);
            await db.runTransaction(async tx => {
                sesion(uid);
                const previo = await tx.get(ref);
                sesion(uid);
                if (previo.exists) {
                    if (previo.data().huella !== r.huella) throw error('id-reutilizado', 'El identificador corresponde a un lote con otros datos.');
                    return;
                }
                tx.set(ref, r);
            });
        }
        async function guardarCompra(uid, datos, opId) {
            sesion(uid);
            const compra = { nombre: D().texto(datos.nombre, 120), marca: D().texto(datos.marca, 60), modelo: D().texto(datos.modelo, 80),
                variante: D().texto(datos.variante, 100), proveedor: D().texto(datos.proveedor, 120), costo: D().dinero(datos.costo),
                cantidad: D().cantidad(datos.cantidad), estado: 'pendiente', revision: 0 };
            if (!compra.nombre || !compra.marca || !compra.modelo || !compra.proveedor) throw error('datos-invalidos', 'Completa repuesto, marca, modelo y proveedor.');
            const hash = await huella(compra);
            const ref = privada(uid, 'compras').doc(opId);
            await db.runTransaction(async tx => {
                sesion(uid); const anterior = await tx.get(ref); sesion(uid);
                if (anterior.exists) {
                    if (anterior.data().huella !== hash) throw error('id-reutilizado', 'El identificador corresponde a otra compra.');
                    return;
                }
                tx.set(ref, { ...compra, huella: hash, creado: timestampServidor() });
            });
        }
        async function resolverCompra(uid, id, accion) {
            sesion(uid);
            if (!['recibir', 'cancelar'].includes(accion)) throw error('datos-invalidos', 'Acción de compra inválida.');
            const ref = privada(uid, 'compras').doc(id);
            const lote = privada(uid, 'repuestos').doc('compra-' + id);
            await db.runTransaction(async tx => {
                sesion(uid); const [snap, stock] = await Promise.all([tx.get(ref), tx.get(lote)]); sesion(uid);
                if (!snap.exists) throw error('not-found', 'Compra no encontrada.');
                const c = snap.data(), estado = accion === 'recibir' ? 'recibida' : 'cancelada';
                if (c.estado === estado) return;
                if (c.estado !== 'pendiente' || stock.exists) throw error('conflicto', 'La compra ya fue resuelta. Recarga antes de continuar.');
                if (accion === 'recibir') tx.set(lote, { nombre: c.nombre, marca: c.marca, modelo: c.modelo, variante: c.variante,
                    proveedor: c.proveedor, costo: c.costo, disponible: c.cantidad, reservado: 0, compraId: id, creado: timestampServidor() });
                tx.update(ref, { estado, revision: c.revision + 1, loteId: accion === 'recibir' ? lote.id : '', actualizado: timestampServidor() });
            });
        }
        async function ajustarStock(uid, datos, opId) {
            sesion(uid);
            if (!['entrada', 'salida', 'devolucion'].includes(datos.tipo)) throw error('datos-invalidos', 'Selecciona el tipo de movimiento.');
            const n = D().cantidad(datos.cantidad), motivo = D().texto(datos.motivo);
            if (motivo.length < 5) throw error('datos-invalidos', 'Explica el motivo del ajuste o devolución (mínimo 5 caracteres).');
            const delta = datos.tipo === 'entrada' ? n : -n;
            const hash = await huella({ ...datos, cantidad: n, motivo });
            const ref = privada(uid, 'repuestos').doc(datos.repuestoId), registro = privada(uid, 'movimientosStock').doc(opId);
            await db.runTransaction(async tx => {
                sesion(uid); const [lote, previo] = await Promise.all([tx.get(ref), tx.get(registro)]); sesion(uid);
                if (previo.exists) {
                    if (previo.data().huella !== hash) throw error('id-reutilizado', 'El identificador corresponde a otro movimiento.');
                    return;
                }
                if (!lote.exists) throw error('not-found', 'Lote no encontrado.');
                const r = lote.data();
                if (r.disponible !== Number(datos.baseDisponible) || r.reservado !== Number(datos.baseReservado)) throw error('conflicto', 'El stock cambió. Recarga y revisa las cantidades.');
                if (r.disponible + delta < 0 || r.disponible + delta > 10000) throw error('sin-stock', 'El disponible debe quedar entre 0 y 10.000; no se pueden retirar unidades reservadas.');
                tx.set(registro, { repuestoId: ref.id, tipo: datos.tipo, delta, motivo, huella: hash,
                    antes: r.disponible, despues: r.disponible + delta, confirmado: timestampServidor() });
                tx.update(ref, { disponible: r.disponible + delta, origenOperacion: 'inventario', ultimaOperacion: opId, actualizado: timestampServidor() });
            });
        }
        async function crearRetrabajo(uid, id, revision, motivo, opId) {
            sesion(uid); motivo = D().texto(motivo);
            if (motivo.length < 5) throw error('datos-invalidos', 'Describe el motivo de la garantía.');
            const hash = await huella({ id, motivo });
            const original = db.collection('equipos').doc(id), nueva = db.collection('equipos').doc(opId);
            const contador = privada(uid, 'config').doc('numeracion'), evento = privada(uid, 'eventos').doc(opId);
            return db.runTransaction(async tx => {
                sesion(uid);
                const [padre, hija, numero, ev] = await Promise.all([tx.get(original), tx.get(nueva), tx.get(contador), tx.get(evento)]); sesion(uid);
                if (!padre.exists || padre.data().uid !== uid) throw error('permission-denied', 'Orden no disponible.');
                if (hija.exists || ev.exists) {
                    if (!ev.exists || ev.data().huella !== hash || !hija.exists || hija.data().origenGarantia !== id || hija.data().uid !== uid) throw error('id-reutilizado', 'El identificador corresponde a otra operación.');
                    return { id: opId };
                }
                const p = padre.data();
                if (p.estado !== 'entregado' || (p.revisionOrden || 0) !== revision) throw error('conflicto', 'Se requiere la versión actual de una orden entregada.');
                if (p.garantia?.estado === 'abierta' && p.garantia.ordenRetrabajo) throw error('conflicto', 'Ya existe una orden de retrabajo abierta para este caso.');
                const n = (numero.exists ? numero.data().numero : 0) + 1, ahora = Date.now();
                const orden = { uid, schemaVersion: 2, revisionOrden: 0, numeroOrden: n, idOrden: 'KRF-' + String(n).padStart(6, '0'),
                    origenGarantia: id, cliente: p.cliente, telefono: p.telefono || '', equipo: p.equipo || '', modelo: p.modelo || '',
                    clienteId: p.clienteId || '', imei: p.imei || '', falla: motivo, pin: '', accesorios: '', notas: '',
                    prioridad: 'normal', estado: 'ingresado', costo: 0, abono: 0, timestamp: ahora,
                    procedimiento: window.TechFixDominio.crearProcedimiento(), creado: timestampServidor() };
                const garantia = { estado: 'abierta', motivo, resultado: '', ordenRetrabajo: opId, en: ahora, por: uid };
                tx.set(nueva, orden); tx.set(contador, { numero: n });
                tx.set(db.collection('seguimiento').doc(opId), { uid, estado: 'ingresado', modelo: orden.modelo.slice(0, 80), actualizado: timestampServidor() });
                tx.update(original, { garantia, revisionOrden: revision + 1, ultimaOperacion: opId, actualizado: timestampServidor() });
                tx.set(evento, { uid, ordenId: id, accion: 'garantia', huella: hash, resumen: 'Retrabajo creado: ' + orden.idOrden,
                    garantia, revision: revision + 1, en: ahora, confirmado: timestampServidor() });
                return { id: opId };
            });
        }
        async function guardarPlantilla(uid, datos, opId) {
            sesion(uid);
            const id = datos.id || opId;
            const titulo = D().texto(datos.titulo, 120);
            const pasos = String(datos.pasos || '').split('\n').map(p => p.trim()).filter(Boolean);
            if (!titulo || !pasos.length || pasos.length > 50 || pasos.some(p => p.length > 500)) throw error('datos-invalidos', 'Usa título y entre 1 y 50 pasos, de hasta 500 caracteres cada uno.');
            if (!window.TechFixDominio.PROCEDIMIENTOS[datos.tipo]) throw error('datos-invalidos', 'Selecciona el tipo de procedimiento.');
            const ref = privada(uid, 'plantillas').doc(id);
            await db.runTransaction(async tx => {
                sesion(uid);
                const doc = await tx.get(ref);
                sesion(uid);
                if (doc.exists && doc.data().ultimaOperacion === opId) return;
                if (doc.exists && doc.data().version !== Number(datos.version)) throw error('conflicto', 'La plantilla cambió en otra sesión. Vuelve a cargarla.');
                const plantilla = { titulo, tipo: datos.tipo, pasos, fuente: D().texto(datos.fuente, 500),
                    version: doc.exists ? doc.data().version + 1 : 1, por: uid, actualizado: timestampServidor(), ultimaOperacion: opId };
                tx.set(ref, plantilla);
                tx.set(db.collection('usuarios/' + uid + '/plantillas/' + id + '/versiones').doc(String(plantilla.version)), plantilla);
            });
        }
        async function remoto(ruta, datos = {}) {
            const u = usuario();
            if (!u) throw error('sesion-cambiada', 'Inicia sesión.');
            sesion(u.uid);
            if (!u.getIdToken) throw error('backend-no-disponible', 'Esta función requiere Auth real y el backend configurado.');
            const token = await u.getIdToken(); sesion(u.uid);
            const r = await window.fetch('/api/' + ruta, { method: 'POST', cache: 'no-store',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(datos) });
            sesion(u.uid);
            let resultado;
            try { resultado = await r.json(); } catch (_e) { throw error('backend-no-disponible', 'El backend no está desplegado en este entorno. No se realizó la operación.'); }
            sesion(u.uid);
            if (!r.ok) throw error('backend', resultado.error || 'No se pudo confirmar la operación.');
            return resultado;
        }
        async function listar(uid, coleccion, ordenId) {
            sesion(uid);
            let consulta = privada(uid, coleccion);
            if (ordenId) consulta = consulta.where('ordenId', '==', ordenId);
            const snap = await consulta.get({ source: 'server' });
            sesion(uid);
            return snap.docs.map(d => ({ ...d.data(), id: d.id }));
        }
        async function leerOrden(uid, id) {
            sesion(uid);
            const snap = await db.collection('equipos').doc(id).get({ source: 'server' });
            sesion(uid);
            if (!snap.exists || snap.data().uid !== uid) throw error('permission-denied', 'Orden no disponible.');
            return { ...snap.data(), id: snap.id };
        }
        async function pagina(uid, cursor = null, limite = 100) {
            sesion(uid);
            let q = db.collection('equipos').where('uid', '==', uid).orderBy('timestamp', 'desc').limit(limite);
            if (cursor) q = q.startAfter(cursor);
            const snap = await q.get({ source: 'server' });
            sesion(uid);
            return { ordenes: snap.docs.map(d => ({ ...d.data(), id: d.id })), cursor: snap.docs.at(-1), fin: snap.size < limite };
        }
        return { remoto, ejecutar, crearOrden, guardarCompra, resolverCompra, ajustarStock, crearRetrabajo, guardarRepuesto, guardarPlantilla, listar, leerOrden, pagina, nuevoId };
    }
    window.KryoFixTallerServicio = { crear };
})();
