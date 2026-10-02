#!/usr/bin/env node
/**
 * Copia las dependencias de ejecución desde node_modules/ a app/vendor/.
 *
 * app/vendor/ SE VERSIONA en el repositorio: el hosting sirve esos archivos y el
 * service worker los precachea, de modo que la app funciona sin CDN y sin red.
 * Las versiones están fijadas en package.json (devDependencies) solo para poder
 * copiarlas de forma reproducible.
 *
 * Uso:  npm run vendor
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = join(ROOT, 'app', 'vendor');

const DEPENDENCIAS = [
    { archivo: 'firebase-app-compat.js', origen: 'firebase/firebase-app-compat.js', licencia: 'Apache-2.0' },
    { archivo: 'firebase-auth-compat.js', origen: 'firebase/firebase-auth-compat.js', licencia: 'Apache-2.0' },
    { archivo: 'firebase-firestore-compat.js', origen: 'firebase/firebase-firestore-compat.js', licencia: 'Apache-2.0' },
    { archivo: 'sweetalert2.all.min.js', origen: 'sweetalert2/dist/sweetalert2.all.min.js', licencia: 'MIT' },
    { archivo: 'qrcode.js', origen: 'qrcode-generator/dist/qrcode.js', licencia: 'MIT' }
];

const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
const kb = (bytes) => (bytes / 1024).toFixed(1) + ' KB';

function main() {
    if (!existsSync(join(ROOT, 'node_modules'))) {
        console.error('Falta node_modules/. Ejecuta primero: npm install');
        process.exit(1);
    }
    mkdirSync(DESTINO, { recursive: true });

    let cambios = 0;
    for (const dep of DEPENDENCIAS) {
        const rutaOrigen = join(ROOT, 'node_modules', dep.origen);
        if (!existsSync(rutaOrigen)) {
            console.error(`  ERROR  no existe ${dep.origen}. Ejecuta: npm install`);
            process.exit(1);
        }
        const contenido = readFileSync(rutaOrigen);
        if (contenido.length < 1024) {
            console.error(`  ERROR  ${dep.origen} pesa ${contenido.length} bytes: la copia esta incompleta.`);
            process.exit(1);
        }
        const rutaDestino = join(DESTINO, dep.archivo);
        const anterior = existsSync(rutaDestino) ? readFileSync(rutaDestino) : null;
        const igual = anterior && sha(anterior) === sha(contenido);
        if (!igual) {
            writeFileSync(rutaDestino, contenido);
            cambios++;
        }
        console.log(`  ${igual ? '=' : 'actualizado'} ${dep.archivo} (${kb(contenido.length)}, ${dep.licencia})`);
    }
    console.log(
        cambios
            ? `\n${cambios} archivo(s) actualizado(s) en app/vendor/. Sube la VERSION de app/sw.js si cambiaron.`
            : '\napp/vendor/ ya estaba al dia.'
    );
}

main();
