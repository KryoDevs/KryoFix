import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, FieldPath } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { defineSecret, defineString, defineBoolean } from 'firebase-functions/params';
import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { crearBackend } from './motor.js';

initializeApp();
const db = getFirestore();
const bucketNombre = defineString('STORAGE_BUCKET_PRIVADO', { default: '' });
const proveedorUrl = defineString('PROVEEDOR_URL', { default: '' });
const envios = defineBoolean('HABILITAR_ENVIOS', { default: false });
const proveedorToken = defineSecret('PROVEEDOR_TOKEN');
const webhookSecret = defineSecret('WEBHOOK_SECRET');
const opciones = { region: 'us-central1', maxInstances: 5, timeoutSeconds: 120 };
function motor(conProveedor = false) {
    return crearBackend({ db, stamp: () => FieldValue.serverTimestamp(),
        bucket: bucketNombre.value() ? getStorage().bucket(bucketNombre.value()) : null,
        habilitarEnvios: conProveedor && envios.value(),
        proveedor: conProveedor ? async datos => {
            const url = new URL(proveedorUrl.value());
            if (url.protocol !== 'https:') throw new Error('El proveedor debe usar HTTPS');
            const r = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + proveedorToken.value(), 'Idempotency-Key': datos.idempotencyKey }, body: JSON.stringify(datos) });
            if (!r.ok) throw new Error('Proveedor no aceptó la solicitud');
            return r.json();
        } : null });
}
export const api = onRequest({ ...opciones, secrets: [webhookSecret], cors: false }, async (req, res) => {
    res.set('Cache-Control', 'private, no-store'); res.set('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'POST') { res.status(405).json({ error: 'Solo POST' }); return; }
    if (!req.is('application/json') || (req.rawBody?.length || 0) > 32768 || !req.body || Array.isArray(req.body)) { res.status(400).json({ error: 'JSON inválido o demasiado grande' }); return; }
    const ruta = req.path.replace(/^\/api\//, '/'), d = req.body, b = motor();
    try {
        let resultado;
        if (ruta === '/aprobacion') resultado = await b.aprobar(d.token, d.decision, d.nombre);
        else if (ruta === '/confirmacion-mensaje') {
            const firma = req.get('X-KryoFix-Signature') || '', secreto = webhookSecret.value();
            const esperada = createHmac('sha256', secreto).update(req.rawBody).digest('hex');
            if (secreto.length < 32 || !/^[a-f0-9]{64}$/.test(firma) || !timingSafeEqual(Buffer.from(firma, 'hex'), Buffer.from(esperada, 'hex'))) {
                res.status(401).json({ error: 'Firma inválida' }); return;
            }
            resultado = await b.confirmarMensaje(d.id, d.proveedorId, d.estado);
        } else {
            const header = req.get('Authorization') || '';
            if (!header.startsWith('Bearer ')) { res.status(401).json({ error: 'Inicia sesión' }); return; }
            let usuario;
            try { usuario = await getAuth().verifyIdToken(header.slice(7), true); }
            catch (_e) { res.status(401).json({ error: 'Sesión inválida o vencida' }); return; }
            const uid = usuario.uid;
            switch (ruta) {
                case '/capacidades': resultado = { storage: !!bucketNombre.value(), envios: envios.value(), aprobacion: true, metricas: true }; break;
                case '/emitir-enlace': resultado = await b.emitirEnlace(uid, d.id); break;
                case '/migrar-archivo': resultado = await b.migrarArchivo(uid, d.id, d.tipo); break;
                case '/leer-archivo': resultado = await b.leerArchivo(uid, d.id, d.tipo); break;
                case '/retencion': resultado = await b.retencion(uid, d.id, d.dias, d.confirmar); break;
                case '/consentimiento': resultado = await b.consentimiento(uid, d.id, d.aceptado, d.evidencia); break;
                case '/encolar': resultado = await b.encolar(uid, d.id, d.tipo, d.opId); break;
                case '/metricas': resultado = await b.calcularMetricas(uid); break;
                default: res.status(404).json({ error: 'Operación no encontrada' }); return;
            }
        }
        res.json(resultado);
    } catch (e) {
        // Nunca registrar tokens, cuerpos, teléfonos, enlaces ni imágenes en logs.
        res.status(e.status || 500).json({ error: e.status ? e.message : 'No se pudo completar la operación en el servidor. El original se conserva; revisa el estado antes de reintentar.' });
    }
});

export const notificarCambio = onDocumentWritten({ ...opciones, document: 'equipos/{id}', retry: true }, async event => {
    const a = event.data?.before.data(), p = event.data?.after.data();
    if (!p || !envios.value()) return;
    const tipo = p.estado === 'reparado' && a?.estado !== p.estado ? 'retiro' :
        p.estado === 'repuesto' && a?.estado !== p.estado ? 'repuesto' :
        p.presupuesto?.autorizacion.estado === 'pendiente' && p.presupuesto?.version !== a?.presupuesto?.version ? 'presupuesto' :
        p.garantia?.estado === 'abierta' && a?.garantia?.estado !== 'abierta' ? 'garantia' : null;
    if (!tipo) return;
    try { await motor().encolar(p.uid, event.params.id, tipo, createHash('sha256').update(event.id).digest('hex')); }
    catch (e) { if (![400, 404, 409].includes(e.status)) throw e; }
});
export const enviarPendientes = onSchedule({ ...opciones, schedule: 'every 5 minutes', secrets: [proveedorToken], retryCount: 3 }, async () => {
    if (!envios.value()) return;
    const cola = await db.collection('colaMensajes').where('estado', 'in', ['pendiente', 'reintento', 'procesando']).where('siguiente', '<=', Date.now()).orderBy('siguiente').limit(100).get();
    const b = motor(true);
    for (const m of cola.docs) await b.procesarMensaje(m.id);
});
export const aplicarRetencion = onSchedule({ ...opciones, schedule: 'every 24 hours', timeoutSeconds: 540, retryCount: 3 }, async () => {
    if (!bucketNombre.value()) return;
    const b = motor(), control = db.collection('controlServidor').doc('retencion'), ultimo = await control.get();
    let q = db.collection('equipos').orderBy(FieldPath.documentId()).limit(500);
    if (ultimo.data()?.cursor) q = q.startAfter(ultimo.data().cursor);
    const pagina = await q.get();
    for (const p of pagina.docs) await b.purgarOrden(p.id);
    // Recorrido acotado/reanudable: talleres grandes no dejan siempre las últimas órdenes sin revisar.
    await control.set({ cursor: pagina.size === 500 ? pagina.docs.at(-1).id : null, actualizado: FieldValue.serverTimestamp() });
});

export const archivarImagenes = onDocumentWritten({ ...opciones, document: 'equipos/{id}', retry: true }, async event => {
    const anterior = event.data?.before.data(), p = event.data?.after.data();
    if (!p || !bucketNombre.value()) return;
    for (const tipo of ['evidencia', 'firmaCliente']) {
        if (!p[tipo] || p[tipo] === anterior?.[tipo]) continue;
        try { await motor().migrarArchivo(p.uid, event.params.id, tipo); }
        catch (e) { if (![400, 404, 409].includes(e.status)) throw e; }
    }
});
