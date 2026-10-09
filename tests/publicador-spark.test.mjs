import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { clearTimeout } from 'node:timers';
import { prepararSpark } from '../tools/preparar-spark.mjs';
// CLI simulada: jamás autorizar/deployar recursos reales desde las pruebas.
for (const caso of ['sitio-existente', 'sitio-nuevo', 'uid-invalido']) {
    test('publicador seguro con CLI simulada: ' + caso, { skip: process.platform === 'win32' }, async t => {
        const temp = mkdtempSync(join(tmpdir(), 'kryofix-publicador-'));
        t.after(() => rmSync(temp, { recursive: true, force: true }));
        const salida = prepararSpark(join(temp, '.spark'));
        mkdirSync(join(temp, 'bin'));
        const llamadas = join(temp, 'llamadas');
        writeFileSync(join(temp, 'bin/npx'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TRAZA_PRUEBA, JSON.stringify(args) + '\\n');
if (args.includes('hosting:sites:list')) console.log(JSON.stringify({status:'success', result:{sites:${caso === 'sitio-nuevo' ? '[]' : "[{name:'projects/kryofix/sites/kryofix'}]"}}}));
`, { mode: 0o755 });
        const hijo = spawn(process.execPath, [join(salida, 'publicar-spark.mjs')], { cwd: salida, env: { ...process.env, TRAZA_PRUEBA: llamadas, PATH: join(temp, 'bin') + ':' + process.env.PATH }, stdio: ['pipe', 'pipe', 'pipe'] });
        let texto = '', errores = '', paso = 0;
        hijo.stdout.on('data', b => {
            texto += b;
            if (paso === 0 && texto.includes('UID del usuario autorizado')) { paso = 1; hijo.stdin.write((caso === 'uid-invalido' ? "x' || true" : 'ana') + '\n'); }
            if (paso === 1 && texto.includes('Escribe PUBLICAR:')) { paso = 2; hijo.stdin.write('PUBLICAR\n'); }
        });
        hijo.stderr.on('data', b => { errores += b; });
        const limite = setTimeout(() => hijo.kill(), 15000);
        const code = await new Promise(resolve => hijo.on('close', resolve)); clearTimeout(limite);
        if (caso === 'uid-invalido') {
            assert.notEqual(code, 0); assert.equal(existsSync(llamadas), false); return;
        }
        assert.equal(code, 0, errores);
        const comandos = readFileSync(llamadas, 'utf8').trim().split('\n').map(l => JSON.parse(l));
        assert.equal(comandos.length, caso === 'sitio-nuevo' ? 4 : 3);
        assert.deepEqual(comandos[0], ['--yes', 'firebase-tools@15.32.1', 'login']);
        assert.deepEqual(comandos[1], ['--yes', 'firebase-tools@15.32.1', 'hosting:sites:list', '--project', 'kryofix', '--json']);
        if (caso === 'sitio-nuevo') assert.deepEqual(comandos[2], ['--yes', 'firebase-tools@15.32.1', 'hosting:sites:create', 'kryofix', '--project', 'kryofix', '--non-interactive']);
        assert.deepEqual(comandos.at(-1), ['--yes', 'firebase-tools@15.32.1', 'deploy', '--project', 'kryofix', '--config', 'firebase.json', '--only', 'firestore:rules,firestore:indexes,hosting', '--non-interactive']);
        assert.match(readFileSync(join(salida, 'firestore.rules'), 'utf8'), /request.auth.uid == 'ana'/);
        assert.match(readFileSync(join(salida, 'app/entorno.js'), 'utf8'), /"propietarioUid":"ana"/);
        // El publicador debe confirmar el UID guardado: si se teclea mal, el
        // taller queda fuera del sistema y el sintoma aparece mucho despues.
        assert.match(texto, /UID guardado en app\/entorno\.js: ana/);
    });
}
