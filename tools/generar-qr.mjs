#!/usr/bin/env node
/**
 * Genera el QR del ticket (`app/ticket-qr.png`) SIN depender de un servicio
 * externo.
 *
 * Antes el ticket se armaba con una imagen de api.qrserver.com: cada impresion
 * avisaba a un tercero de la URL de seguimiento de la orden, y sin internet el
 * QR no salia. Ahora el QR es un archivo estatico del propio hosting (por lo
 * tanto, cacheado por el service worker y disponible offline).
 *
 * El QR apunta a la URL publica de seguimiento, que NO es un secreto: es el
 * enlace que se imprime en el ticket. Contiene solo el id del documento; los
 * datos del cliente viven en las colecciones privadas.
 *
 * Uso:
 *   npm run qr                                  (dominio de produccion)
 *   TECHFIX_BASE_URL=https://midominio.cl/ npm run qr
 *
 * El PNG resultante se versiona en el repositorio y lo verifica
 * tests/qr.test.mjs (lo decodifica y comprueba que apunte a la URL esperada).
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// qrcode-generator es una dependencia SOLO de desarrollo: el archivo generado
// (el PNG) se versiona, igual que los iconos de la PWA.
const qrcode = require('qrcode-generator');

export const BASE_URL_POR_DEFECTO = 'https://techfix-tracker-9a128.web.app/';
export const RUTA_QR = 'app/ticket-qr.png';

/** URL que codifica el QR (el tecnico la pega en la plantilla del ticket). */
export function urlDelTicket(baseUrl = BASE_URL_POR_DEFECTO) {
    return new URL('status.html', baseUrl).toString();
}

// ---------------------------------------------------------------------------
// Codificador PNG minimo (zlib + CRC32 propios, sin dependencias)
// ---------------------------------------------------------------------------
const TABLA_CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xffffffff;
    for (const b of buf) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(tipo, datos) {
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length, 0);
    const cuerpo = Buffer.concat([Buffer.from(tipo, 'latin1'), datos]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(cuerpo), 0);
    return Buffer.concat([largo, cuerpo, crc]);
}

/** PNG en escala de grises (1 byte por pixel). */
function pngEscalaGrises(ancho, alto, pixeles) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(ancho, 0);
    ihdr.writeUInt32BE(alto, 4);
    ihdr[8] = 8; // profundidad de bits
    ihdr[9] = 0; // color type 0 = escala de grises
    // 10..12: compresion, filtro e entrelazado por defecto (0)

    // Cada fila lleva delante su byte de filtro (0 = sin filtro).
    const crudo = Buffer.alloc(alto * (ancho + 1));
    for (let y = 0; y < alto; y++) {
        crudo[y * (ancho + 1)] = 0;
        pixeles.copy(crudo, y * (ancho + 1) + 1, y * ancho, (y + 1) * ancho);
    }

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(crudo, { level: 9 })),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

/**
 * Dibuja la matriz del QR como PNG.
 * @param {string} texto contenido a codificar
 * @param {number} celda pixeles por modulo
 * @param {number} margen modulos de silencio (la norma pide >= 4)
 */
export function qrPng(texto, { celda = 8, margen = 4, nivel = 'M' } = {}) {
    // El tipo se calcula automaticamente segun el contenido (0 = auto).
    const qr = qrcode(0, nivel);
    qr.addData(texto);
    qr.make();

    const modulos = qr.getModuleCount();
    const lado = (modulos + margen * 2) * celda;
    const pixeles = Buffer.alloc(lado * lado, 0xff);

    for (let y = 0; y < modulos; y++) {
        for (let x = 0; x < modulos; x++) {
            if (!qr.isDark(y, x)) continue;
            for (let dy = 0; dy < celda; dy++) {
                for (let dx = 0; dx < celda; dx++) {
                    const px = (margen + x) * celda + dx;
                    const py = (margen + y) * celda + dy;
                    pixeles[py * lado + px] = 0x00;
                }
            }
        }
    }

    return { png: pngEscalaGrises(lado, lado, pixeles), modulos, lado };
}

// ---------------------------------------------------------------------------
// Ejecucion directa: escribe el archivo
// ---------------------------------------------------------------------------
function main() {
    const baseUrl = process.env.TECHFIX_BASE_URL || BASE_URL_POR_DEFECTO;
    const url = urlDelTicket(baseUrl);
    const { png, modulos, lado } = qrPng(url);
    const destino = join(ROOT, RUTA_QR);

    const anterior = existsSync(destino) ? readFileSync(destino) : null;
    writeFileSync(destino, png);

    console.log(`QR generado: ${RUTA_QR}`);
    console.log(`  contenido : ${url}`);
    console.log(`  matriz    : ${modulos}x${modulos} modulos, imagen ${lado}x${lado}px, ${png.length} bytes`);
    if (anterior && anterior.equals(png)) console.log('  (sin cambios respecto a la version anterior)');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
