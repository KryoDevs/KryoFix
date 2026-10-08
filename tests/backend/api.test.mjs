import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import 'firebase/compat/storage';
const url = 'http://127.0.0.1:5001/demo-kryofix/us-central1/api';
let entorno, uid, token;
const presupuesto = { version: 1, total: 12000, lineas: [{ concepto: 'Pantalla', cantidad: 1, precio: 12000 }], condiciones: 'Garantía limitada', plazo: '3 días', autorizacion: { estado: 'pendiente' } };
const imagen = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
async function api(ruta, datos = {}, auth = token) {
    const r = await fetch(url + '/' + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) }, body: JSON.stringify(datos) });
    return { status: r.status, body: await r.json() };
}
before(async () => {
    if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Solo ejecutar con npm run test:backend, nunca en producción.');
    entorno = await initializeTestEnvironment({ projectId: 'demo-kryofix', firestore: { rules: readFileSync('firestore.rules', 'utf8') }, storage: { rules: readFileSync('storage.rules', 'utf8') } });
    const r = await fetch('http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST + '/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'backend-' + Date.now() + '@example.test', password: 'solo-emulador-no-real-123', returnSecureToken: true }) });
    const d = await r.json(); assert.ok(d.idToken, JSON.stringify(d)); uid = d.localId; token = d.idToken;
});
beforeEach(async () => {
    await entorno.clearFirestore();
    await entorno.withSecurityRulesDisabled(c => c.firestore().collection('equipos').doc('a').set({ uid, cliente: 'Privado', telefono: '56912345678', pin: '9999', estado: 'revision', revisionOrden: 0, schemaVersion: 2, costo: 12000, abono: 0, presupuesto, evidencia: imagen }));
});
after(async () => { if (entorno) await entorno.cleanup(); });
test('HTTP exige token real válido, verifica dueño y no acepta webhook sin firma', async () => {
    assert.equal((await api('emitir-enlace', { id: 'a' }, null)).status, 401);
    assert.equal((await api('emitir-enlace', { id: 'a' }, 'invalido')).status, 401);
    await entorno.withSecurityRulesDisabled(c => c.firestore().collection('equipos').doc('ajena').set({ uid: 'otra' }));
    assert.equal((await api('emitir-enlace', { id: 'ajena' })).status, 404);
    assert.equal((await api('confirmacion-mensaje', { id: 'cualquiera' }, null)).status, 401);
});
test('HTTP aprobación end-to-end anónima con token, privada y atómica', async () => {
    const enlace = await api('emitir-enlace', { id: 'a' }); assert.equal(enlace.status, 200, JSON.stringify(enlace));
    const d = { token: enlace.body.token };
    const ver = await api('aprobacion', d, null); assert.equal(ver.status, 200);
    assert.equal(JSON.stringify(ver.body).includes('9999'), false);
    const decision = { ...d, decision: 'aprobado', nombre: 'Cliente emulado' };
    assert.equal((await api('aprobacion', decision, null)).body.confirmado, true);
    assert.equal((await api('aprobacion', decision, null)).body.confirmado, true);
    assert.equal((await api('aprobacion', { ...decision, decision: 'rechazado' }, null)).status, 409);
    const orden = await entorno.authenticatedContext(uid).firestore().collection('equipos').doc('a').get();
    assert.equal(orden.data().presupuesto.autorizacion.estado, 'aprobado');
    await assertFails(entorno.authenticatedContext(uid).firestore().collection('aprobacionesPrivadas').get());
});
test('Storage real emulado verifica migración y niega acceso directo del cliente', async () => {
    const r = await api('migrar-archivo', { id: 'a', tipo: 'evidencia' }); assert.equal(r.status, 200, JSON.stringify(r));
    const ver = await api('leer-archivo', { id: 'a', tipo: 'evidencia' }); assert.equal(ver.status, 200, JSON.stringify(ver)); assert.equal(ver.body.dataUrl, imagen);
    const orden = (await entorno.authenticatedContext(uid).firestore().collection('equipos').doc('a').get()).data();
    assert.equal(orden.evidencia, ''); assert.ok(orden.archivos.evidencia.sha256);
    await assertFails(entorno.authenticatedContext(uid).storage('gs://demo-kryofix.appspot.com').ref(orden.archivos.evidencia.ruta).getDownloadURL());
    assert.equal((await api('retencion', { id: 'a', dias: 1, confirmar: true })).status, 400);
    assert.equal((await api('retencion', { id: 'a', dias: 365, confirmar: true })).status, 200);
});
test('consentimiento y cola HTTP no envían sin activación; métricas son del servidor', async () => {
    assert.equal((await api('encolar', { id: 'a', tipo: 'presupuesto', opId: 'mensaje-1' })).status, 409);
    assert.equal((await api('consentimiento', { id: 'a', aceptado: true, evidencia: 'Consentimiento de prueba' })).status, 200);
    const r = await api('encolar', { id: 'a', tipo: 'presupuesto', opId: 'mensaje-1' }); assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal((await api('capacidades')).body.envios, false);
    const informe = await api('metricas'); assert.equal(informe.status, 200, JSON.stringify(informe)); assert.equal(informe.body.saldo, 12000); assert.equal(informe.body.ordenes, 1);
    await assertFails(entorno.authenticatedContext(uid).firestore().collection('colaMensajes').get());
});
