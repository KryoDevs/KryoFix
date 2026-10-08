import { writeFileSync, readFileSync } from 'node:fs';
let config;
try { config = JSON.parse(process.env.FIREBASE_WEB_CONFIG || 'null'); } catch (_e) { throw new Error('La configuración web debe ser JSON válido.'); }
const permitidas = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId'];
if (!config || Object.keys(config).some(k => !permitidas.includes(k)) || ['apiKey', 'authDomain', 'projectId', 'appId'].some(k => typeof config[k] !== 'string' || !config[k])) throw new Error('Se requiere configuración WEB pública de Firebase; nunca una cuenta de servicio.');
if (!/^[a-z0-9.-]+$/.test(config.authDomain)) throw new Error('authDomain inválido.');
if (process.env.FIREBASE_PROJECT_ID && config.projectId !== process.env.FIREBASE_PROJECT_ID) throw new Error('El proyecto de la configuración web no coincide con el destino.');
if (process.env.ENTORNO_STAGING === 'true') {
    if (config.projectId === 'techfix-tracker-9a128') throw new Error('Staging no puede apuntar al proyecto productivo.');
    if (config.authDomain !== config.projectId + '.firebaseapp.com') throw new Error('Staging requiere el dominio Auth del proyecto de pruebas.');
    if (config.storageBucket && process.env.STORAGE_BUCKET_PRIVADO && config.storageBucket !== process.env.STORAGE_BUCKET_PRIVADO) throw new Error('El bucket web y el backend de staging deben coincidir.');
}
const firebase = JSON.parse(readFileSync('firebase.json', 'utf8'));
writeFileSync('app/entorno.js', '/* Configuración WEB pública generada para este despliegue. */\nwindow.KryoFixEntorno = ' + JSON.stringify({ firebase: config }) + ';\n');
for (const regla of firebase.hosting.headers) for (const h of regla.headers) if (h.key === 'Content-Security-Policy') h.value = h.value.replace(/frame-src [^;]+/, 'frame-src https://' + config.authDomain);
writeFileSync('firebase.json', JSON.stringify(firebase, null, 2) + '\n');
console.log('Configuración pública preparada; no se desplegó ningún recurso.');
