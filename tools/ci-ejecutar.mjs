import { spawn } from 'node:child_process';
const [cmd, ...args] = process.argv.slice(2);
const hijo = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
let salida = '';
for (const stream of [hijo.stdout, hijo.stderr]) stream.on('data', b => { process.stdout.write(b); salida = (salida + b).slice(-50000); });
hijo.on('error', e => { console.error(e.message); process.exitCode = 1; });
hijo.on('close', code => {
    if (code && process.env.CI) {
        const limpia = salida.split('\n').filter(l => !l.includes('[WebServer]')).join('\n');
        const relevante = limpia.includes('not ok') ? limpia.slice(Math.max(0, limpia.indexOf('not ok') - 100), limpia.indexOf('not ok') + 3400) : limpia.slice(-3500);
        const mensaje = relevante.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
        console.log('::error title=Fallo de integración::' + mensaje);
    }
    process.exitCode = code || 0;
});
