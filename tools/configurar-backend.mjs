import { writeFileSync } from 'node:fs';
const proyecto = process.env.FIREBASE_PROJECT_ID;
const bucket = process.env.STORAGE_BUCKET_PRIVADO;
const envios = process.env.HABILITAR_ENVIOS === 'true';
const proveedor = process.env.PROVEEDOR_URL || '';
if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(proyecto || '') || !/^[a-z0-9][a-z0-9._-]{2,221}$/.test(bucket || '')) throw new Error('Configura proyecto y bucket privado antes del despliegue.');
if (process.env.ENTORNO_STAGING === 'true') {
    if (proyecto === 'techfix-tracker-9a128') throw new Error('Staging no puede desplegar en producción.');
    if (!(bucket.startsWith(proyecto + '.') || bucket.startsWith(proyecto + '-'))) throw new Error('Usa un bucket de staging identificado con su proyecto.');
    if (envios || proveedor) throw new Error('Este staging se prepara sin proveedor: los envíos deben estar desactivados.');
}
if (envios) {
    const url = new URL(proveedor);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Proveedor requiere HTTPS y credencial separada en Secret Manager.');
}
writeFileSync('functions/.env.' + proyecto, Object.entries({ STORAGE_BUCKET_PRIVADO: bucket, HABILITAR_ENVIOS: String(envios), PROVEEDOR_URL: proveedor }).map(([k, v]) => k + '=' + JSON.stringify(v)).join('\n') + '\n');
console.log('Parámetros no secretos preparados. No se activó ni desplegó ningún servicio.');
