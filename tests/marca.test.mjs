import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { montarApp, tick } from './helpers/entorno.mjs';

const leer = ruta => readFileSync(new URL('../' + ruta, import.meta.url), 'utf8');

test('KryoFix identifica la PWA sin modificar su identidad ni rutas instaladas', () => {
    const manifest = JSON.parse(leer('app/manifest.json'));
    assert.equal(manifest.short_name, 'KryoFix');
    assert.match(manifest.name, /KryoFix/);
    assert.match(manifest.description, /KryoDevs/);
    assert.equal(manifest.id, '/');
    assert.equal(manifest.start_url, './index.html');
    assert.equal(manifest.scope, './');
});

test('login, taller y seguimiento muestran marca y autoría nuevas', () => {
    const { document } = montarApp();
    assert.match(document.title, /KryoFix/);
    assert.match(document.querySelector('.login-brand').textContent, /KryoFix/);
    assert.match(document.querySelector('.topbar').textContent, /KryoDevs/);
    assert.match(document.querySelector('.login-footer').textContent, /KryoDevs/);
    assert.doesNotMatch(document.body.textContent, /TechFix/);
    const publico = montarApp({ html: 'app/status.html', script: 'app/status.js' });
    assert.match(publico.document.title, /KryoFix/);
    assert.match(publico.document.querySelector('.footer').textContent, /KryoDevs/);
    assert.doesNotMatch(publico.document.body.textContent, /TechFix/);
});

test('ticket y compartir usan KryoFix y conservan el enlace de la orden', async () => {
    const ctx = montarApp({ semilla: { equipos: { a: {
        uid: 'tecnico', cliente: 'Ana', modelo: 'iPhone 13', equipo: 'Apple',
        estado: 'ingresado', costo: 0, abono: 0, timestamp: Date.now(), idOrden: 'TF-261006-001'
    } } } });
    ctx.auth._entrar({ uid: 'tecnico', email: 'tecnico@example.test' });
    await tick(10);
    const orden = ctx.window.TechFix.proyectos()[0];
    const ticket = ctx.window.TechFix.construirBoleta(orden);
    assert.match(ticket.textContent, /KryoFix/);
    assert.match(ticket.textContent, /Desarrollado por KryoDevs/);
    assert.match(ticket.textContent, /TF-261006-001/);
    const url = ctx.window.TechFix.urlSeguimiento('a');
    assert.equal(new URL(url).searchParams.get('id'), 'a');
    let compartido;
    ctx.window.navigator.share = async datos => { compartido = datos; };
    await ctx.window.TechFix.compartirTicket('a');
    assert.equal(compartido.title, 'KryoFix');
    assert.equal(compartido.url, url);
});
