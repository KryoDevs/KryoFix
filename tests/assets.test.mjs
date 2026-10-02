/**
 * Comprobaciones de los archivos estaticos que se despliegan:
 *   - el QR del ticket decodifica de verdad (un QR ilegible es invisible a ojo y
 *     rompe la atencion al cliente);
 *   - los binarios se mantienen ligeros (antes: icono de 1 MB en cada instalacion);
 *   - app/vendor/ esta sincronizado con las versiones fijadas en package.json.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { qrPng, urlDelTicket, RUTA_QR } from '../tools/generar-qr.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const leer = (p) => readFileSync(join(ROOT, p));
const ruta = (p) => join(ROOT, p);
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/** Dimensiones de un PNG (cabecera IHDR). */
function dimensionesPng(buffer) {
    return { ancho: buffer.readUInt32BE(16), alto: buffer.readUInt32BE(20) };
}

/** Dimensiones de un JPEG (primer marcador SOF). */
function dimensionesJpeg(buffer) {
    let i = 2;
    while (i < buffer.length - 9) {
        if (buffer[i] !== 0xff) {
            i++;
            continue;
        }
        const marcador = buffer[i + 1];
        const largo = buffer.readUInt16BE(i + 2);
        const esSof =
            marcador >= 0xc0 && marcador <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marcador);
        if (esSof) return { alto: buffer.readUInt16BE(i + 5), ancho: buffer.readUInt16BE(i + 7) };
        i += 2 + largo;
    }
    return null;
}

describe('QR del ticket', () => {
    test('el archivo versionado decodifica al seguimiento publico', () => {
        const png = PNG.sync.read(leer(RUTA_QR));
        const leido = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
        assert.ok(leido, 'el QR debe ser legible');
        assert.equal(leido.data, urlDelTicket(), 'el QR debe apuntar a la pagina de seguimiento');
    });

    test('el archivo esta sincronizado con tools/generar-qr.mjs', () => {
        const esperado = qrPng(urlDelTicket()).png;
        assert.equal(sha256(esperado), sha256(leer(RUTA_QR)), 'ejecuta: npm run qr');
    });
});

describe('Binarios de la PWA', () => {
    const tamanos = [
        { archivo: 'app/icon-192.png', ancho: 192, alto: 192, maxBytes: 40 * 1024 },
        { archivo: 'app/icon-512.png', ancho: 512, alto: 512, maxBytes: 200 * 1024 },
        { archivo: 'app/ticket-qr.png', ancho: null, alto: null, maxBytes: 20 * 1024 }
    ];

    for (const caso of tamanos) {
        test(`${caso.archivo} tiene el tamano correcto y pesa menos de ${Math.round(caso.maxBytes / 1024)} KB`, () => {
            const buffer = leer(caso.archivo);
            assert.ok(buffer.length <= caso.maxBytes, `pesa ${(buffer.length / 1024).toFixed(1)} KB`);
            if (caso.ancho) {
                const { ancho, alto } = dimensionesPng(buffer);
                assert.deepEqual({ ancho, alto }, { ancho: caso.ancho, alto: caso.alto });
            }
        });
    }

    test('el logo no se sirve a 1024x1024 (se muestra a 80x80)', () => {
        const buffer = leer('app/logo.jpg');
        const medida = dimensionesJpeg(buffer);
        assert.ok(medida, 'debe ser un JPEG valido');
        assert.ok(medida.ancho <= 320 && medida.alto <= 320, `logo de ${medida.ancho}x${medida.alto}`);
        assert.ok(buffer.length <= 40 * 1024, `logo de ${(buffer.length / 1024).toFixed(1)} KB`);
    });

    test('el manifest apunta a iconos que existen', () => {
        const manifest = JSON.parse(leer('app/manifest.json').toString('utf8'));
        for (const icono of manifest.icons) {
            assert.ok(existsSync(ruta(join('app', icono.src))), `falta ${icono.src}`);
        }
    });
});

describe('Dependencias de app/vendor/', () => {
    const dependencias = [
        ['firebase-app-compat.js', 'firebase/firebase-app-compat.js'],
        ['firebase-auth-compat.js', 'firebase/firebase-auth-compat.js'],
        ['firebase-firestore-compat.js', 'firebase/firebase-firestore-compat.js'],
        ['sweetalert2.all.min.js', 'sweetalert2/dist/sweetalert2.all.min.js'],
        ['qrcode.js', 'qrcode-generator/dist/qrcode.js']
    ];

    for (const [archivo, origen] of dependencias) {
        test(`${archivo} es la copia exacta del paquete fijado en package.json`, () => {
            const enNode = join(ROOT, 'node_modules', origen);
            assert.ok(existsSync(enNode), 'ejecuta: npm install');
            assert.equal(
                sha256(leer(join('app/vendor', archivo))),
                sha256(readFileSync(enNode)),
                `${archivo} esta desincronizado. Ejecuta: npm run vendor`
            );
        });
    }

    test('las versiones de las dependencias estan fijadas (sin rangos)', () => {
        const pkg = JSON.parse(leer('package.json').toString('utf8'));
        for (const [nombre, version] of Object.entries(pkg.devDependencies)) {
            assert.match(version, /^\d+\.\d+\.\d+$/, `${nombre} usa el rango "${version}"; fija la version exacta`);
        }
        void require;
    });
});
