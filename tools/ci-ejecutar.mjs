import { spawn } from 'node:child_process';
const [cmd, ...args] = process.argv.slice(2);
const hijo = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
let salida = '';
for (const stream of [hijo.stdout, hijo.stderr]) stream.on('data', b => { process.stdout.write(b); salida = (salida + b).slice(-50000); });
hijo.on('error', e => { console.error(e.message); process.exitCode = 1; });
hijo.on('exit', code => {
    if (code && process.env.CI) {
        const relevante = salida.includes('not ok') ? salida.slice(Math.max(0, salida.indexOf('not ok') - 100)) : salida.slice(-6000);
        const mensaje = relevante.slice(0, 14000).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
        console.log('::error title=Fallo de integración::' + mensaje);
    }
    process.exitCode = code || 0;
});
