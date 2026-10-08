import { readFileSync, writeFileSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reglasSpark } from './spark-reglas.mjs';
const raiz = fileURLToPath(new URL('../', import.meta.url));
export function prepararSpark(salida = resolve(raiz, '.spark'), uid = '__CONFIGURAR_UID_ANTES_DE_PUBLICAR__') {
    salida = resolve(salida);
    if (basename(salida) !== '.spark') throw new Error('La salida debe ser una carpeta .spark dedicada.');
    const config = JSON.parse(readFileSync(resolve(raiz, 'config/staging.firebase.public.json'), 'utf8'));
    const campos = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
    if (config.projectId !== 'kryofix' || config.authDomain !== 'kryofix.firebaseapp.com' || Object.keys(config).some(k => !campos.includes(k)) || campos.some(k => typeof config[k] !== 'string' || !config[k])) throw new Error('La configuración pública debe ser exclusivamente del proyecto kryofix.');
    const fuente = readFileSync(resolve(raiz, 'firestore.rules'), 'utf8');
    const reglas = reglasSpark(fuente, uid);
    const original = JSON.parse(readFileSync(resolve(raiz, 'firebase.json'), 'utf8'));
    const hosting = { ...original.hosting, rewrites: [] };
    for (const regla of hosting.headers) for (const h of regla.headers) if (h.key === 'Content-Security-Policy') h.value = h.value.replace(/frame-src [^;]+/, 'frame-src https://kryofix.firebaseapp.com');
    const firebase = { firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' }, hosting };
    const indices = JSON.parse(readFileSync(resolve(raiz, 'firestore.indexes.json'), 'utf8'));
    indices.indexes = indices.indexes.filter(i => i.collectionGroup !== 'colaMensajes');
    indices.fieldOverrides = ['evidencia', 'firmaCliente'].map(fieldPath => ({ collectionGroup: 'equipos', fieldPath, indexes: [] }));
    rmSync(salida, { recursive: true, force: true }); mkdirSync(salida, { recursive: true });
    cpSync(resolve(raiz, 'app'), resolve(salida, 'app'), { recursive: true });
    writeFileSync(resolve(salida, 'app/entorno.js'), '/* Configuración WEB pública. Sin claves privadas. */\nwindow.KryoFixEntorno = ' + JSON.stringify({ modo: 'spark', propietarioUid: uid, firebase: config }) + ';\n');
    writeFileSync(resolve(salida, 'firebase.json'), JSON.stringify(firebase, null, 2) + '\n');
    writeFileSync(resolve(salida, '.firebaserc'), JSON.stringify({ projects: { default: 'kryofix' } }, null, 2));
    writeFileSync(resolve(salida, 'firestore.rules'), reglas);
    writeFileSync(resolve(salida, 'firestore.base.rules'), fuente);
    writeFileSync(resolve(salida, 'firestore.indexes.json'), JSON.stringify(indices, null, 2));
    for (const [desde, hasta] of [['tools/spark-reglas.mjs', 'spark-reglas.mjs'], ['tools/publicar-spark.mjs', 'publicar-spark.mjs'], ['PUBLICAR-SPARK.md', 'LEEME.md']]) cpSync(resolve(raiz, desde), resolve(salida, hasta));
    writeFileSync(resolve(salida, 'PUBLICAR-WINDOWS.cmd'), '@echo off\r\nchcp 65001 >nul\r\ncd /d "%~dp0"\r\nnode publicar-spark.mjs\r\nif errorlevel 1 echo No se completo la publicacion. Revisa el error anterior. Requiere Node.js 22.\r\npause\r\n');
    return salida;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    console.log('Paquete Spark preparado en ' + prepararSpark() + '. No se desplegó. Requiere el UID del dueño y su autorización local.');
}
