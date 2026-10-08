// Se ejecuta dentro del paquete .spark, en el equipo del propietario.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { reglasSpark } from './spark-reglas.mjs';
const cwd = fileURLToPath(new URL('.', import.meta.url));
const rl = createInterface({ input: process.stdin, output: process.stdout });
try {
    if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Instala Node.js 22 o superior antes de continuar.');
    const config = JSON.parse(readFileSync(resolve(cwd, 'firebase.json'), 'utf8'));
    if (JSON.stringify(Object.keys(config).sort()) !== JSON.stringify(['firestore', 'hosting']) || config.hosting.public !== 'app' || config.hosting.rewrites?.length || config.hosting.site || config.hosting.target) throw new Error('Paquete no válido: solo se permite Hosting y Firestore, sin Functions ni Storage.');
    const archivo = resolve(cwd, 'app/entorno.js');
    const js = readFileSync(archivo, 'utf8');
    const entorno = JSON.parse(js.slice(js.indexOf('window.KryoFixEntorno = ') + 'window.KryoFixEntorno = '.length).trim().replace(/;$/, ''));
    if (entorno.modo !== 'spark' || entorno.firebase.projectId !== 'kryofix') throw new Error('Destino no permitido.');
    console.log('KryoFix real · Solo proyecto kryofix · Hosting y Firestore · Sin activar facturación.');
    console.log('Copia el UID de TU cuenta: Firebase > Authentication > Usuarios. No es una contraseña.');
    const uid = (await rl.question('UID del usuario autorizado del taller: ')).trim();
    if (uid.startsWith('__')) throw new Error('Debes indicar tu UID real, no un marcador de plantilla.');
    const reglas = reglasSpark(readFileSync(resolve(cwd, 'firestore.base.rules'), 'utf8'), uid);
    const confirmar = (await rl.question('Publicar en kryofix y reemplazar sus reglas/Hosting (no otros proyectos)? Escribe PUBLICAR: ')).trim();
    if (confirmar !== 'PUBLICAR') throw new Error('Cancelado. No se desplegó nada.');
    writeFileSync(resolve(cwd, 'firestore.rules'), reglas);
    writeFileSync(archivo, '/* Configuración WEB pública del taller. */\nwindow.KryoFixEntorno = ' + JSON.stringify({ ...entorno, propietarioUid: uid }) + ';\n');
    rl.close();
    function firebase(args) {
        // Argumentos fijos: ningún texto del usuario llega al shell de Windows.
        const r = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', 'firebase-tools@15.32.1', ...args], { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
        if (r.error || r.status !== 0) throw new Error('Firebase no completó el paso. No se confirmó la publicación. Revisa el mensaje anterior y reintenta.');
    }
    firebase(['login']);
    // No se crea ninguna cuenta de facturación, bucket, función ni tarea programada.
    firebase(['deploy', '--project', 'kryofix', '--config', 'firebase.json', '--only', 'firestore:rules,firestore:indexes,hosting', '--non-interactive']);
    console.log('Firebase terminó el despliegue. Abre https://kryofix.web.app y prueba una orden ficticia antes de cargar clientes reales.');
    console.log('En consola verifica también que los índices estén habilitados. Mantén el plan Spark.');
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { rl.close(); }
