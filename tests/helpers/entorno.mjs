/**
 * Arnes de pruebas: levanta index.html / status.html en jsdom con un doble de
 * Firebase en memoria, para poder ejercitar app.js y status.js sin red ni
 * credenciales.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const leer = (p) => readFileSync(join(ROOT, p), 'utf8');

/** Doble de Firestore: guarda documentos en memoria y notifica a onSnapshot. */
export function crearFirestoreFalso(semilla = {}) {
    const datos = new Map(); // coleccion -> Map(id -> data)
    const oyentes = []; // { coleccion, filtros, cb }
    let contador = 0;

    for (const [col, docs] of Object.entries(semilla)) {
        datos.set(col, new Map(Object.entries(docs)));
    }
    const col = (n) => {
        if (!datos.has(n)) datos.set(n, new Map());
        return datos.get(n);
    };

    function snapshotDe(coleccion, filtros) {
        let docs = [...col(coleccion).entries()].map(([id, data]) => ({ id, data: () => ({ ...data }) }));
        for (const f of filtros.where) {
            docs = docs.filter((d) => d.data()[f.campo] === f.valor);
        }
        if (filtros.orderBy) {
            const { campo, dir } = filtros.orderBy;
            // Firestore excluye documentos que no tienen el campo de ordenamiento
            docs = docs.filter((d) => d.data()[campo] !== undefined);
            docs.sort((a, b) => (a.data()[campo] > b.data()[campo] ? 1 : -1));
            if (dir === 'desc') docs.reverse();
        }
        if (filtros.limit) docs = docs.slice(0, filtros.limit);
        return { docs, size: docs.length, forEach: (fn) => docs.forEach(fn) };
    }

    function notificar() {
        for (const o of oyentes) {
            if (o.tipo === 'coleccion') o.cb(snapshotDe(o.coleccion, o.filtros));
            else {
                const data = col(o.coleccion).get(o.id);
                o.cb({ exists: data !== undefined, id: o.id, data: () => (data ? { ...data } : undefined) });
            }
        }
    }

    function consulta(coleccion, filtros = { where: [], orderBy: null, limit: null }) {
        return {
            where: (campo, _op, valor) =>
                consulta(coleccion, { ...filtros, where: [...filtros.where, { campo, valor }] }),
            orderBy: (campo, dir = 'asc') => consulta(coleccion, { ...filtros, orderBy: { campo, dir } }),
            limit: (n) => consulta(coleccion, { ...filtros, limit: n }),
            onSnapshot(cb, _err) {
                const oyente = { tipo: 'coleccion', coleccion, filtros, cb };
                oyentes.push(oyente);
                cb(snapshotDe(coleccion, filtros));
                return () => {
                    const i = oyentes.indexOf(oyente);
                    if (i >= 0) oyentes.splice(i, 1);
                };
            },
            async add(data) {
                const id = `doc${++contador}`;
                col(coleccion).set(id, { ...data });
                notificar();
                return { id };
            },
            doc(idDado) {
                const id = idDado ?? `doc${++contador}`;
                return {
                    id,
                    async set(data) {
                        col(coleccion).set(id, { ...data });
                        notificar();
                    },
                    async update(parche) {
                        const actual = col(coleccion).get(id);
                        if (!actual) throw Object.assign(new Error('No document to update'), { code: 'not-found' });
                        col(coleccion).set(id, { ...actual, ...parche });
                        notificar();
                    },
                    async delete() {
                        col(coleccion).delete(id);
                        notificar();
                    },
                    async get() {
                        const data = col(coleccion).get(id);
                        return { exists: data !== undefined, id, data: () => (data ? { ...data } : undefined) };
                    },
                    onSnapshot(cb, _err) {
                        const oyente = { tipo: 'doc', coleccion, id, cb };
                        oyentes.push(oyente);
                        const data = col(coleccion).get(id);
                        cb({ exists: data !== undefined, id, data: () => (data ? { ...data } : undefined) });
                        return () => {
                            const i = oyentes.indexOf(oyente);
                            if (i >= 0) oyentes.splice(i, 1);
                        };
                    },
                    _ref: { coleccion, id }
                };
            }
        };
    }

    const limpiezas = [];

    /** Lote de escritura atomico (equivalente a firestore().batch()). */
    function batch() {
        const ops = [];
        return {
            set(ref, data) {
                ops.push({ tipo: 'set', ref, data });
                return this;
            },
            update(ref, data) {
                ops.push({ tipo: 'update', ref, data });
                return this;
            },
            delete(ref) {
                ops.push({ tipo: 'delete', ref });
                return this;
            },
            async commit() {
                // Validacion previa: si algo falla no se aplica nada (atomico).
                for (const op of ops) {
                    if (op.tipo === 'update' && !col(op.ref._ref.coleccion).has(op.ref._ref.id)) {
                        throw Object.assign(new Error('No document to update'), { code: 'not-found' });
                    }
                }
                for (const op of ops) {
                    const { coleccion: c, id } = op.ref._ref;
                    if (op.tipo === 'set') col(c).set(id, { ...op.data });
                    else if (op.tipo === 'update') col(c).set(id, { ...col(c).get(id), ...op.data });
                    else col(c).delete(id);
                }
                notificar();
            }
        };
    }

    return {
        _datos: datos,
        _oyentes: oyentes,
        _limpiezas: limpiezas,
        batch,
        collection: (n) => consulta(n),
        enablePersistence: () => Promise.resolve(),
        clearPersistence: () => {
            limpiezas.push(Date.now());
            return Promise.resolve();
        },
        terminate: () => Promise.resolve()
    };
}

/** Doble de Firebase Auth. */
export function crearAuthFalso() {
    let observador = null;
    let usuario = null;
    return {
        get currentUser() {
            return usuario;
        },
        onAuthStateChanged(cb) {
            observador = cb;
            cb(usuario);
            return () => {
                observador = null;
            };
        },
        async signInWithEmailAndPassword(email) {
            usuario = { uid: 'uid-' + email.split('@')[0], email };
            if (observador) observador(usuario);
            return { user: usuario };
        },
        async signOut() {
            usuario = null;
            if (observador) observador(null);
        },
        _entrar(u) {
            usuario = u;
            if (observador) observador(u);
        },
        setPersistence: () => Promise.resolve(),
        Auth: { Persistence: { LOCAL: 'local' } }
    };
}

/** Doble de SweetAlert2 que registra las llamadas. */
export function crearSwalFalso() {
    const llamadas = [];
    const swal = (opts) => {
        llamadas.push(opts);
        return Promise.resolve({ isConfirmed: swal.respuesta, isDismissed: !swal.respuesta });
    };
    const api = {
        fire: swal,
        close: () => {},
        llamadas,
        respuesta: true
    };
    api.fire = (...args) => {
        const opts = typeof args[0] === 'string' ? { title: args[0], text: args[1], icon: args[2] } : args[0];
        llamadas.push(opts);
        return Promise.resolve({ isConfirmed: api.respuesta, isDismissed: !api.respuesta });
    };
    return api;
}

/**
 * Carga un HTML de la app en jsdom e inyecta los dobles antes de ejecutar el
 * script indicado.
 */
export function montarApp({ html = 'app/index.html', script = 'app/app.js', semilla = {} } = {}) {
    const virtualConsole = new VirtualConsole();
    const errores = [];
    virtualConsole.on('jsdomError', (e) => errores.push(e));

    const dom = new JSDOM(leer(html), {
        url: 'https://ejemplo.test/',
        runScripts: 'outside-only',
        pretendToBeVisual: true,
        virtualConsole
    });
    const { window } = dom;

    const db = crearFirestoreFalso(semilla);
    const auth = crearAuthFalso();
    const swal = crearSwalFalso();

    window.firebase = {
        initializeApp: () => ({}),
        firestore: () => db,
        auth: () => auth
    };
    window.Swal = swal;
    window.print = () => {
        window.__impreso = (window.__impreso || 0) + 1;
    };
    window.open = (url, destino, features) => {
        window.__ventanas = window.__ventanas || [];
        window.__ventanas.push({ url, destino, features });
        return null;
    };
    window.matchMedia =
        window.matchMedia ||
        (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));

    // Canvas: jsdom no implementa 2d, se sustituye por un espia.
    const trazos = [];
    window.HTMLCanvasElement.prototype.getContext = function () {
        return {
            canvas: this,
            lineWidth: 1,
            lineCap: 'butt',
            lineJoin: 'miter',
            strokeStyle: '#000',
            beginPath() {},
            moveTo(x, y) {
                trazos.push({ tipo: 'move', x, y });
            },
            lineTo(x, y) {
                trazos.push({ tipo: 'line', x, y });
            },
            stroke() {},
            clearRect() {
                trazos.push({ tipo: 'clear' });
            },
            drawImage() {},
            scale() {},
            getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
            fillRect() {},
            set fillStyle(_v) {}
        };
    };
    window.HTMLCanvasElement.prototype.toDataURL = function () {
        return 'data:image/jpeg;base64,FIRMA';
    };
    window.__trazos = trazos;

    window.eval(leer(script));

    return { dom, window, document: window.document, db, auth, swal, errores, trazos };
}

/** Deja correr microtareas pendientes. */
export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
