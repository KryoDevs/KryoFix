import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const proyecto = 'kryofix-staging-test', bucket = proyecto + '.firebasestorage.app';
const web = { apiKey: 'public-web-test-key', projectId: proyecto, authDomain: proyecto + '.firebaseapp.com', appId: 'test-web', storageBucket: bucket };
function ejecutar(t, archivo, extra = {}) {
    const cwd = mkdtempSync(join(tmpdir(), 'kryofix-staging-'));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    mkdirSync(join(cwd, 'app')); mkdirSync(join(cwd, 'functions'));
    writeFileSync(join(cwd, 'app/entorno.js'), 'ORIGINAL');
    writeFileSync(join(cwd, 'firebase.json'), JSON.stringify({ hosting: { headers: [{ headers: [{ key: 'Content-Security-Policy', value: "default-src 'self'; frame-src https://techfix-tracker-9a128.firebaseapp.com;" }] }] } }));
    const r = spawnSync(process.execPath, [fileURLToPath(new URL('../tools/' + archivo, import.meta.url))], { cwd, encoding: 'utf8', env: { ...process.env,
        ENTORNO_STAGING: 'true', FIREBASE_PROJECT_ID: proyecto, STORAGE_BUCKET_PRIVADO: bucket,
        HABILITAR_ENVIOS: 'false', PROVEEDOR_URL: '', FIREBASE_WEB_CONFIG: JSON.stringify(web), ...extra } });
    return { ...r, cwd };
}
test('staging genera configuración web y CSP del proyecto aislado', t => {
    const r = ejecutar(t, 'configurar-entorno.mjs'); assert.equal(r.status, 0, r.stderr);
    assert.match(readFileSync(join(r.cwd, 'app/entorno.js'), 'utf8'), /kryofix-staging-test/);
    assert.doesNotMatch(readFileSync(join(r.cwd, 'firebase.json'), 'utf8'), /techfix-tracker-9a128/);
});
for (const [caso, config, destino] of [
    ['producción', { ...web, projectId: 'techfix-tracker-9a128' }, 'techfix-tracker-9a128'],
    ['otro destino', { ...web, projectId: 'otro-proyecto' }, proyecto],
    ['Auth productivo', { ...web, authDomain: 'techfix-tracker-9a128.firebaseapp.com' }, proyecto],
    ['bucket productivo', { ...web, storageBucket: 'techfix-tracker-9a128.firebasestorage.app' }, proyecto],
    ['cuenta privada', { ...web, private_key: 'NO_PUBLICAR_ESTA_CLAVE' }, proyecto]
]) test('configuración web rechaza ' + caso + ' antes de escribir', t => {
    const r = ejecutar(t, 'configurar-entorno.mjs', { FIREBASE_WEB_CONFIG: JSON.stringify(config), FIREBASE_PROJECT_ID: destino });
    assert.notEqual(r.status, 0); assert.equal(readFileSync(join(r.cwd, 'app/entorno.js'), 'utf8'), 'ORIGINAL');
    assert.ok(!(r.stdout + r.stderr).includes('NO_PUBLICAR_ESTA_CLAVE'));
});
test('backend de staging fija envíos apagados y no modifica configuración productiva', t => {
    const r = ejecutar(t, 'configurar-backend.mjs'); assert.equal(r.status, 0, r.stderr);
    assert.match(readFileSync(join(r.cwd, 'functions/.env.' + proyecto), 'utf8'), /HABILITAR_ENVIOS="false"/);
    assert.equal(existsSync(join(r.cwd, 'functions/.env.techfix-tracker-9a128')), false);
});
for (const [caso, extra] of [
    ['proyecto productivo', { FIREBASE_PROJECT_ID: 'techfix-tracker-9a128' }],
    ['bucket ajeno', { STORAGE_BUCKET_PRIVADO: 'bucket-productivo' }],
    ['envíos activos', { HABILITAR_ENVIOS: 'true', PROVEEDOR_URL: 'https://example.test' }],
    ['proveedor accidental', { PROVEEDOR_URL: 'https://example.test' }]
]) test('backend de staging bloquea ' + caso, t => {
    const r = ejecutar(t, 'configurar-backend.mjs', extra); assert.notEqual(r.status, 0);
    assert.deepEqual(readdirSync(join(r.cwd, 'functions')), []);
});
test('cuenta de despliegue debe pertenecer a staging y nunca se imprime', t => {
    const privada = '-----BEGIN PRIVATE KEY-----NO_MOSTRAR_SECRETO_DE_PRUEBA';
    const buena = { type: 'service_account', project_id: proyecto, client_email: 'deploy@' + proyecto + '.iam.gserviceaccount.com', private_key: privada };
    const r = ejecutar(t, 'verificar-cuenta-staging.mjs', { FIREBASE_SERVICE_ACCOUNT_STAGING: JSON.stringify(buena) }); assert.equal(r.status, 0, r.stderr);
    const mal = ejecutar(t, 'verificar-cuenta-staging.mjs', { FIREBASE_SERVICE_ACCOUNT_STAGING: JSON.stringify({ ...buena, project_id: 'techfix-tracker-9a128' }) }); assert.notEqual(mal.status, 0);
    assert.ok(!(r.stdout + r.stderr + mal.stdout + mal.stderr).includes(privada));
    for (const secreto of ['', '{' + privada, JSON.stringify({ ...buena, client_email: 'deploy@produccion.iam.gserviceaccount.com' })]) {
        const fallo = ejecutar(t, 'verificar-cuenta-staging.mjs', { FIREBASE_SERVICE_ACCOUNT_STAGING: secreto });
        assert.notEqual(fallo.status, 0);
        assert.ok(!(fallo.stdout + fallo.stderr).includes(privada));
    }
});
