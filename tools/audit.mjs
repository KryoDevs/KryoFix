#!/usr/bin/env node
/**
 * Auditoria estatica de TechFix Tracker.
 *
 * No necesita navegador ni credenciales: revisa el codigo fuente buscando las
 * clases de fallo que ya se detectaron en la revision del repositorio, para que
 * no vuelvan a aparecer (regresiones).
 *
 * Uso:  node tools/audit.mjs
 * Salida: lista de hallazgos + exit code 1 si hay alguno de severidad "error".
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : null);

const findings = [];
const fail = (id, msg) => findings.push({ sev: 'error', id, msg });
const warn = (id, msg) => findings.push({ sev: 'warn', id, msg });

const appJsCrudo = read('app/app.js') ?? '';

/** Sustituye constantes simples (const X = 'valor') para que las busquedas
 *  funcionen tanto con literales como con constantes nombradas. */
function resolverConstantes(src) {
    let out = src;
    for (const m of src.matchAll(/const\s+([A-Z_][A-Z0-9_]*)\s*=\s*'([^']+)'/g)) {
        out = out.replace(new RegExp('\\b' + m[1] + '\\b', 'g'), `'${m[2]}'`);
    }
    return out;
}
const appJs = resolverConstantes(appJsCrudo);
const statusJs = read('app/status.js') ?? '';
const swJs = read('app/sw.js') ?? '';
const css = read('app/estilos.css') ?? '';
const indexHtml = read('app/index.html') ?? '';
const statusHtml = read('app/status.html') ?? '';
const firebaseJson = read('firebase.json') ?? '';
const rules = read('firestore.rules');

// ---------------------------------------------------------------------------
// 1. Sincronizacion de clases CSS <-> JS/HTML
// ---------------------------------------------------------------------------
function clasesUsadas(src) {
    const out = new Set();
    // class="a b c"  y  class=\"a b c\" dentro de strings JS
    for (const m of src.matchAll(/class=\\?["']([^"'\\]+)/g)) {
        m[1].split(/\s+/).filter(Boolean).forEach((c) => out.add(c));
    }
    // className = 'a b'
    for (const m of src.matchAll(/className\s*=\s*["']([^"']+)["']/g)) {
        m[1].split(/\s+/).filter(Boolean).forEach((c) => out.add(c));
    }
    // classList.add('a', 'b') y classList.toggle('a', ...)
    for (const m of src.matchAll(/classList\.(?:add|toggle|remove)\(([^)]*)\)/g)) {
        for (const q of m[1].matchAll(/["']([^"']+)["']/g)) out.add(q[1]);
    }
    // el('div', { class: 'a b' })  (la fuga mas facil de colar)
    for (const m of src.matchAll(/class:\s*["']([^"']+)["']/g)) {
        m[1].split(/\s+/).filter(Boolean).forEach((c) => out.add(c));
    }
    return out;
}

function clasesDefinidas(sheet) {
    const out = new Set();
    // Solo selectores (fuera de bloques de declaraciones) para no capturar "0.3s"
    const sinComentarios = sheet.replace(/\/\*[\s\S]*?\*\//g, '');
    const sinDeclaraciones = sinComentarios.replace(/\{[^{}]*\}/g, '{}');
    for (const m of sinDeclaraciones.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.add(m[1]);
    return out;
}

// Los prefijos dinamicos ("estado-" + p.estado) no son clases completas: la
// comprobacion se hace sobre las clases terminadas.
const completas = (conjunto) => new Set([...conjunto].filter((c) => c && !c.endsWith('-')));
const usadas = new Set([
    ...completas(clasesUsadas(appJs)),
    ...completas(clasesUsadas(indexHtml)),
    ...completas(clasesUsadas(statusJs)),
    ...completas(clasesUsadas(statusHtml))
]);
const definidas = clasesDefinidas(css);
// Clases que vienen de librerias externas o son puramente semanticas
const IGNORAR = new Set(['swal2-popup', 'swal2-container']);
const huerfanas = [...usadas].filter((c) => !definidas.has(c) && !IGNORAR.has(c)).sort();
if (huerfanas.length) {
    fail('css-sync', `Clases usadas en JS/HTML sin definicion en estilos.css: ${huerfanas.join(', ')}`);
}

// ---------------------------------------------------------------------------
// 1b. Codificacion de los archivos de texto
// Un archivo guardado en latin-1 (Windows) rompe los acentos y los emoji: en
// index.html convivian "reparaci\u00f3n" en latin-1 con emoji UTF-8, y los
// iconos del indicador de red y del boton de exportar quedaron como "??".
// ---------------------------------------------------------------------------
for (const [nombre, contenido] of [
    ['app/index.html', indexHtml],
    ['app/status.html', statusHtml],
    ['app/app.js', appJsCrudo],
    ['app/status.js', statusJs],
    ['app/estilos.css', css]
]) {
    if (contenido.includes('\uFFFD')) {
        fail('encoding', `${nombre} no esta codificado en UTF-8 (contiene caracteres de reemplazo).`);
    }
    // "??" dentro de texto visible delata un emoji perdido en una conversion.
    for (const m of contenido.matchAll(/>(?:[^<>{}]*?)(\?\?)([^<>{}]*?)</g)) {
        if (/^https?:/.test(m[2] || '')) continue; // URL con query string
        warn('encoding', `${nombre} tiene "??" en texto visible (emoji perdido): "${m[0].trim().slice(0, 60)}"`);
    }
}

// ---------------------------------------------------------------------------
// 2. Aislamiento de datos por usuario (multi-tenant)
// ---------------------------------------------------------------------------
if (/collection\(\s*'equipos'\s*\)\s*(\r?\n\s*)*\.orderBy/.test(appJs)) {
    fail('tenant-query', "La consulta de 'equipos' ordena sin filtrar por uid: descarga datos de otros usuarios.");
}
if (!/collection\(\s*'equipos'\s*\)[\s\S]{0,200}?\.where\(\s*'uid'\s*,\s*'=='/.test(appJs)) {
    fail('tenant-query', "Falta .where('uid','==',currentUser.uid) en la consulta de 'equipos'.");
}
if (/!data\.uid\s*\|\|/.test(appJs)) {
    fail('tenant-filter', 'Se aceptan documentos sin uid (filtrado permisivo en cliente).');
}

// ---------------------------------------------------------------------------
// 3. Pagina publica de seguimiento: no debe leer la coleccion privada
// ---------------------------------------------------------------------------
if (/collection\(\s*['"]equipos['"]\s*\)/.test(resolverConstantes(statusJs))) {
    fail(
        'status-leak',
        "status.js lee la coleccion privada 'equipos': expone telefono, IMEI, PIN, fotos y firma a cualquiera con el ID."
    );
}

// ---------------------------------------------------------------------------
// 4. Reglas de seguridad de Firestore versionadas
// ---------------------------------------------------------------------------
if (!rules) {
    fail('rules-missing', 'No existe firestore.rules en el repositorio (reglas sin control de versiones ni revision).');
} else {
    // El espejo publico 'seguimiento' SI debe ser legible por cualquiera.
    const rulesPrivadas = rules.replace(/match\s+\/seguimiento\/\{[\s\S]*?\n {4}\}/m, '');
    if (/allow\s+(read|write|read,\s*write)\s*:\s*if\s+true\s*;/.test(rulesPrivadas)) {
        fail('rules-open', 'firestore.rules contiene una regla abierta (if true) sobre datos privados.');
    }
    if (!/request\.auth\.uid/.test(rules)) {
        fail('rules-weak', 'firestore.rules no valida request.auth.uid en ninguna regla.');
    }
}
if (rules && !/"firestore"/.test(firebaseJson)) {
    fail('rules-not-wired', 'firebase.json no referencia firestore.rules, por lo que nunca se despliegan.');
}

// ---------------------------------------------------------------------------
// 5. Cabeceras de seguridad en hosting
// ---------------------------------------------------------------------------
for (const h of ['Content-Security-Policy', 'X-Content-Type-Options', 'Referrer-Policy']) {
    if (!firebaseJson.includes(h)) warn('headers', `firebase.json no define la cabecera ${h}.`);
}
const csp = (firebaseJson.match(/"Content-Security-Policy",\s*"value":\s*"([^"]+)"/) || [])[1] || '';
if (csp && /script-src[^;]*'unsafe-(inline|eval)'/.test(csp)) {
    fail('csp', "La CSP permite 'unsafe-inline'/'unsafe-eval' en script-src: anula la proteccion contra XSS.");
}
if (/script-src[^;]*https?:/.test(csp)) {
    warn('csp', 'La CSP permite scripts de terceros; con las dependencias en vendor/ ya no es necesario.');
}

// ---------------------------------------------------------------------------
// 5b. Dependencias: locales, versionadas y presentes
// ---------------------------------------------------------------------------
const HTML_CON_SCRIPTS = [['index.html', indexHtml], ['status.html', statusHtml]];
for (const [nombre, html] of HTML_CON_SCRIPTS) {
    for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) {
        const src = m[1];
        if (/^https?:\/\//.test(src)) {
            fail('cdn', `${nombre} carga ${src} desde un CDN: un CDN caido o comprometido deja la app inservible. Sirvelo desde app/vendor/.`);
        } else if (!existsSync(join(ROOT, 'app', src.replace(/^\.\//, '')))) {
            fail('script-missing', `${nombre} referencia ${src}, que no existe en app/.`);
        }
    }
}
// app.js lleva su codigo dentro (el contenedor existe en index.html) y lo mismo
// status.js: si el codigo se moviera a un archivo que no se carga, la app
// quedaria vacia sin ningun error visible.
for (const [nombre, html, contenedor, script] of [
    ['index.html', indexHtml, 'app.js', 'app.js'],
    ['status.html', statusHtml, 'status.js', 'status.js']
]) {
    const tieneContenedor = new RegExp(`id=["']${contenedor}["']`).test(html);
    const loCarga = html.includes(script) || html.includes('suelto');
    if (!tieneContenedor && !loCarga) {
        fail('script-missing', `${nombre} no incluye ${script}: la interfaz quedaria vacia.`);
    }
}
for (const m of [...(indexHtml + statusHtml + appJs).matchAll(/https?:\/\/[^\s"'`)]*qrserver[^\s"'`)]*/g)]) {
    void m;
    fail('qr-externo', 'Se sigue usando api.qrserver.com: filtra la URL de cada orden a un tercero y falla sin internet. Usa el QR local.');
}
// Scripts cargados dinamicamente con cargarScript('...') tambien deben existir en app/.
for (const m of appJs.matchAll(/cargarScript\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const src = m[1];
    if (/^https?:\/\//.test(src)) {
        fail('cdn', `app.js carga ${src} desde un CDN con cargarScript(). Sirvelo desde app/vendor/.`);
    } else if (!existsSync(join(ROOT, 'app', src.replace(/^\.\//, '')))) {
        fail('script-missing', `app.js carga dinamicamente ${src}, que no existe en app/.`);
    }
}

// El QR del ticket debe ser un archivo propio versionado.
if (/ticket-qr\.png/.test(appJs) && !existsSync(join(ROOT, 'app', 'ticket-qr.png'))) {
    fail('qr-missing', 'app.js usa ticket-qr.png pero el archivo no existe. Ejecuta: npm run qr');
}
if (!/vendor\//.test(swJs)) {
    warn('sw-vendor', 'El service worker no precachea app/vendor/: la app no funcionara sin conexion.');
}

// ---------------------------------------------------------------------------
// 5c. Compatibilidad del SDK de Firestore
// firebase 10.8.1 (compat) no expone count()/agregaciones: intentar usarlas
// compila, pero falla en tiempo de ejecucion.
// ---------------------------------------------------------------------------
if (/\.count\(\s*\)/.test(appJs)) {
    fail('sdk-count', 'Se usa Query.count(), que no existe en firebase 10.8.1 compat (0.3.26).');
}
const cfgApp = (appJs.match(/firebaseConfig\s*=\s*\{([\s\S]*?)\};/) || [])[1] || '';
const cfgStatus = (statusJs.match(/firebaseConfig\s*=\s*\{([\s\S]*?)\};/) || [])[1] || '';
if (cfgApp && cfgStatus && cfgApp.replace(/\s+/g, '') !== cfgStatus.replace(/\s+/g, '')) {
    fail('firebase-config-mismatch', 'firebaseConfig difiere entre app.js y status.js.');
}

// ---------------------------------------------------------------------------
// 5d. Ids del DOM referenciados desde el JavaScript
// Un id mal escrito ($('proyecto-form') cuando el HTML dice otra cosa) no da
// error: simplemente deja una funcion muerta. Se comprueba en ambas paginas.
// ---------------------------------------------------------------------------
const IDS_DINAMICOS = new Set([
    'pwd-nueva',
    'pwd-repetir',
    'edit-cliente',
    'edit-telefono',
    'edit-falla',
    'edit-accesorios',
    'edit-costo',
    'edit-abono',
    'edit-cat-marca',
    'edit-cat-modelo',
    'edit-cat-rep',
    'edit-cat-precio'
]); // los crea SweetAlert2
for (const [nombreJs, src, nombreHtml, html] of [
    ['app.js', appJs, 'index.html', indexHtml],
    ['status.js', statusJs, 'status.html', statusHtml]
]) {
    const ids = new Set([
        ...[...src.matchAll(/\$\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
        ...[...src.matchAll(/escuchar\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
        ...[...src.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1])
    ]);
    const inexistentes = [...ids].filter((id) => !IDS_DINAMICOS.has(id) && !html.includes(`id="${id}"`)).sort();
    if (inexistentes.length) {
        fail(
            'dom-ids',
            `${nombreJs} usa id(s) que no existen en ${nombreHtml}: ${inexistentes.join(', ')}`
        );
    }
}

// ---------------------------------------------------------------------------
// 6. Escapado de HTML
// ---------------------------------------------------------------------------
if (/function escapeHtml/.test(appJs) && !/&quot;|&#34;|replace\([^)]*"/.test(appJs)) {
    fail('escape-quotes', 'escapeHtml() no escapa comillas: permite romper atributos HTML (inyeccion).');
}

// ---------------------------------------------------------------------------
// 7. Service Worker
// ---------------------------------------------------------------------------
if (swJs) {
    if (!/skipWaiting/.test(swJs)) fail('sw-update', 'El service worker no llama a skipWaiting(): el codigo nuevo no llega a los clientes.');
    if (!/clients\.claim/.test(swJs)) fail('sw-update', 'El service worker no llama a clients.claim().');
    if (!/request\.method\s*!==?\s*['"]GET['"]/.test(swJs)) {
        fail('sw-method', 'El service worker intercepta peticiones no-GET (rompe escrituras a Firestore).');
    }
    if (!/new URL\(|origin/.test(swJs)) {
        fail('sw-origin', 'El service worker no distingue peticiones de otros origenes (cachea o rompe llamadas a APIs).');
    }
    if (/caches\.match\(event\.request\)[\s\S]{0,120}return fetch\(event\.request\)\s*;?\s*\}\s*\)\s*\)/.test(swJs)) {
        warn('sw-strategy', 'Estrategia cache-first pura: los usuarios quedan con codigo viejo indefinidamente.');
    }
}

// ---------------------------------------------------------------------------
// 8. URLs de produccion hardcodeadas
// ---------------------------------------------------------------------------
for (const [name, src] of [['app.js', appJs], ['status.js', statusJs]]) {
    const m = src.match(/https:\/\/techfix-tracker-9a128\.web\.app/);
    if (m) fail('hardcoded-url', `${name} tiene el dominio de produccion hardcodeado (rompe en dominio propio o local). Usa location.origin.`);
}

// ---------------------------------------------------------------------------
// 9. Fugas de suscripciones de Firestore
// ---------------------------------------------------------------------------
if (/function cargarCatalogo/.test(appJs) && !/unsubscribeCatalogo/.test(appJs)) {
    fail('listener-leak', 'La suscripcion a onSnapshot del catalogo nunca se cancela (fuga al cerrar sesion / re-login).');
}
if (/function cargarDatos/.test(appJs) && !/cancelarSuscripciones\(\)/.test(appJs)) {
    warn('listener-dup', 'cargarDatos() podria registrar listeners duplicados si se llama dos veces.');
}
if (!/clearPersistence/.test(appJs)) {
    warn('offline-privacy', 'No se limpia la cache offline de Firestore al cerrar sesion (datos del usuario anterior quedan en el dispositivo).');
}

// ---------------------------------------------------------------------------
// 10. Rendimiento / calidad puntual
// ---------------------------------------------------------------------------
if (/innerHTML\s*\+=/.test(appJs)) {
    warn('perf-innerhtml', 'Uso de innerHTML += dentro de bucles: reparseo O(n^2) del DOM.');
}
// Se revisa la llamada completa (puede ocupar varias lineas) buscando noopener
// en sus argumentos.
const llamadasOpen = [...appJs.matchAll(/window\.open\([\s\S]{0,240}?\);/g)].map((m) => m[0]);
if (llamadasOpen.some((l) => !l.includes('noopener'))) {
    fail('tabnabbing', "window.open sin 'noopener': la pestana destino puede manipular la original (reverse tabnabbing).");
}
if (!/['"]input['"]/.test(appJs)) {
    warn('debounce', 'El buscador no parece tener manejador de input.');
} else if (!/debounce\s*\(/.test(appJs)) {
    warn('debounce', 'El buscador re-renderiza en cada tecla sin debounce.');
}
if (/onclick=/.test(appJs)) {
    warn('inline-handlers', 'Manejadores onclick inline en strings: incompatibles con una CSP estricta y fragiles ante comillas.');
}

// ---------------------------------------------------------------------------
// 11. Accesibilidad minima
// ---------------------------------------------------------------------------
if (indexHtml.includes('id="modal-firma"') && !/role="dialog"/.test(indexHtml)) {
    warn('a11y-modal', 'El modal de firma no declara role="dialog"/aria-modal.');
}
if (!/<main/.test(indexHtml)) warn('a11y-landmark', 'index.html no usa <main> como landmark.');
if (!/<label[^>]*for="login-email"|aria-label/.test(indexHtml)) warn('a11y-labels', 'Inputs del login sin label asociada.');

// ---------------------------------------------------------------------------
// 12. Documentacion / higiene del repo
// ---------------------------------------------------------------------------
if (!read('README.md')) warn('docs', 'No hay README.md.');
if (!read('.gitignore')) fail('gitignore', 'No hay .gitignore (artefactos de build versionados).');
if (!/theme/.test(indexHtml.split('</head>')[0] ?? '')) {
    warn('fouc', 'El tema no se aplica en <head>: destello de tema claro al cargar en modo oscuro.');
}
if (!statusHtml.includes('step-entregado')) {
    warn('status-steps', "La linea de tiempo publica no tiene el paso 'entregado'.");
}

// ---------------------------------------------------------------------------
// Reporte
// ---------------------------------------------------------------------------
const errores = findings.filter((f) => f.sev === 'error');
const avisos = findings.filter((f) => f.sev === 'warn');

if (!findings.length) {
    console.log('Auditoria estatica: sin hallazgos. OK');
    process.exit(0);
}

for (const f of errores) console.log(`  ERROR  [${f.id}] ${f.msg}`);
for (const f of avisos) console.log(`  aviso  [${f.id}] ${f.msg}`);
console.log(`\n${errores.length} error(es), ${avisos.length} aviso(s).`);
process.exit(errores.length ? 1 : 0);
