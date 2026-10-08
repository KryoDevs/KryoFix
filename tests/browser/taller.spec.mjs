import { test, expect } from '@playwright/test';
import { crearFirestoreFalso, crearAuthFalso, aplicarSentinelas } from '../helpers/entorno.mjs';

// Ningún flujo Spark debe depender de /api, incluso al guardar fotos o firmas.
const llamadasApi = new WeakMap();
const perfilBackendOpcional = new WeakSet();
test.beforeEach(async ({ page }) => {
    const peticiones = []; llamadasApi.set(page, peticiones);
    page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/')) peticiones.push(r.url()); });
});
test.afterEach(async ({ page }) => {
    if (perfilBackendOpcional.has(page)) expect(llamadasApi.get(page)).toHaveLength(2);
    else expect(llamadasApi.get(page)).toEqual([]);
});

const base = { uid: 'tecnico', cliente: 'Cliente de prueba', telefono: '56912345678', equipo: 'Apple', modelo: 'iPhone 13',
    estado: 'ingresado', costo: 50000, abono: 0, timestamp: 1, schemaVersion: 2, revisionOrden: 0, idOrden: 'KRF-000001' };
async function preparar(page) {
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    await page.route('**/vendor/firebase-*.js', route => route.fulfill({ body: '', contentType: 'application/javascript' }));
    await page.addInitScript({ content: `
        ${aplicarSentinelas.toString()}
        ${crearFirestoreFalso.toString()}
        ${crearAuthFalso.toString()}
        window.__db = crearFirestoreFalso({ equipos: { a: ${JSON.stringify(base)}, b: ${JSON.stringify({ ...base, timestamp: 2, cliente: 'Segundo cliente' })} } });
        window.__auth = crearAuthFalso();
        const firestore = () => window.__db;
        firestore.FieldValue = window.__db.FieldValue;
        window.firebase = { initializeApp: () => ({}), firestore, auth: () => window.__auth };
        window.__auth._entrar({ uid: 'tecnico', email: 'tecnico@example.test' });
    ` });
    await page.goto('/');
    await expect(page.locator('#app-content')).toBeVisible();
    return errores;
}
async function ficha(page, seccion) {
    await page.locator('[data-id="a"] [data-accion="ficha"]').click();
    const d = page.getByRole('dialog', { name: /KRF-000001/ });
    await expect(d).toBeVisible();
    if (seccion) await d.getByRole('button', { name: seccion, exact: true }).click();
    return d;
}

test('ficha de diagnóstico guarda datos en navegador real y navega sin errores JS', async ({ page }) => {
    const errores = await preparar(page);
    const d = await ficha(page, 'Diagnóstico');
    await d.locator('[name="riesgo"]').selectOption('si');
    await expect(d.locator('.ficha-form .ficha-aviso')).toContainText('no cargar');
    await d.locator('[name="riesgo"]').selectOption('no');
    await d.locator('[name="sintoma"]').selectOption('carga');
    await d.locator('[name="cable"]').selectOption('correcto');
    await d.locator('[name="causa"]').fill('Conector inspeccionado: terminal dañado');
    await d.getByRole('button', { name: 'Guardar diagnóstico', exact: true }).click();
    await expect(d.locator('[name="causa"]')).toHaveValue('Conector inspeccionado: terminal dañado');
    await expect(d.locator('.ficha-cabecera + p')).toContainText('Revisión 1');
    await d.getByRole('button', { name: 'Garantía', exact: true }).click();
    await expect(d.locator('.ficha-cuerpo')).toContainText('aún está en reparación');
    await expect(d.getByRole('button', { name: 'Registrar seguimiento de garantía' })).toHaveCount(0);
    await d.getByRole('button', { name: 'Cerrar ficha' }).click();
    await expect(d).not.toBeVisible();
    expect(errores).toEqual([]);
});

test('flujo presupuesto → autorización → pago → reverso conserva trazabilidad', async ({ page }) => {
    const errores = await preparar(page);
    const d = await ficha(page, 'Presupuesto');
    await d.locator('[name="concepto0"]').fill('Pantalla compatible');
    await d.locator('[name="precio0"]').fill('50000');
    await d.getByRole('button', { name: 'Guardar nueva versión', exact: false }).click();
    await expect(d.locator('.ficha-cuerpo')).toContainText('Versión 1 · pendiente');
    await d.locator('[name="evidencia"]').fill('Cliente confirmó presencialmente el presupuesto completo');
    await d.getByRole('button', { name: 'Registrar decisión del cliente' }).click();
    await expect(d.locator('.ficha-cuerpo')).toContainText('Versión 1 · aprobado');
    await d.getByRole('button', { name: 'Pagos', exact: true }).click();
    await d.locator('[name="monto"]').fill('12000');
    await d.getByRole('button', { name: 'Registrar pago recibido' }).click();
    await expect(d.locator('.ficha-lista')).toContainText('12.000');
    await d.locator('form').filter({ hasText: 'Registrar reverso' }).locator('[name="motivo"]').fill('Se devuelve pago por cambio de alcance');
    await d.getByRole('button', { name: 'Registrar reverso', exact: false }).click();
    await expect(d.locator('.ficha-lista')).toContainText('Revertido');
    const abono = await page.evaluate(() => window.__db._datos.get('equipos').get('a').abono);
    expect(abono).toBe(0);
    expect(errores).toEqual([]);
});

test('navegación de teclado y móvil no desborda; conserva un formulario si se cancela descarte', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await preparar(page);
    const d = await ficha(page, 'Diagnóstico');
    await d.locator('[name="pruebas"]').fill('Texto aún no guardado');
    await d.getByRole('button', { name: 'Calidad', exact: true }).click();
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(d.locator('[name="pruebas"]')).toHaveValue('Texto aún no guardado');
    expect(await d.evaluate(n => n.scrollWidth <= n.clientWidth + 1)).toBe(true);
    await d.locator('[name="pruebas"]').focus();
    await page.keyboard.press('Tab');
    expect(await d.evaluate(n => n.contains(document.activeElement))).toBe(true);
});

test('borrador del procedimiento conserva pasos al llegar un cambio ajeno y detecta conflicto', async ({ page }) => {
    await preparar(page);
    const tarjeta = page.locator('[data-id="a"]').first();
    await tarjeta.locator('.procedimiento > summary').click();
    await tarjeta.locator('.procedimiento input[type="checkbox"]').first().check();
    await page.evaluate(() => window.__db.collection('equipos').doc('b').update({ notas: 'Otra sesión' }));
    await expect(tarjeta.locator('.procedimiento input[type="checkbox"]').first()).toBeChecked();
    await page.evaluate(() => window.__db.collection('equipos').doc('a').update({ procedimiento: window.TechFixDominio.crearProcedimiento('pantalla') }));
    await expect(tarjeta.locator('.procedimiento [role="status"]')).toContainText('Conflicto');
    await expect(tarjeta.getByRole('button', { name: 'Guardar procedimiento y avance' })).toBeDisabled();
});

test('gestión muestra inventario, agenda e informe completo', async ({ page }) => {
    const errores = await preparar(page);
    await page.getByRole('button', { name: 'Gestión del taller', exact: true }).click();
    const d = page.getByRole('dialog', { name: 'Gestión del taller', exact: true });
    await d.getByRole('button', { name: 'Inventario', exact: true }).click();
    for (const [k, valor] of Object.entries({ nombre: 'Pantalla OLED', marca: 'Apple', modelo: 'iPhone 13', cantidad: '2', costo: '25000' })) await d.locator('[name="' + k + '"]').fill(valor);
    await d.getByRole('button', { name: 'Registrar lote recibido' }).click();
    await expect(d.locator('.ficha-cuerpo')).toContainText('disponible 2 / reservado 0');
    await d.getByRole('button', { name: 'Informes', exact: true }).click();
    await d.getByRole('button', { name: 'Consultar todas las órdenes y calcular' }).click();
    await expect(d.locator('.ficha-cuerpo')).toContainText('Órdenes consultadas: 2');
    expect(errores).toEqual([]);
});

test('plantilla privada se versiona y se aplica con confirmación explícita', async ({ page }) => {
    await preparar(page);
    await page.getByRole('button', { name: 'Gestión del taller', exact: true }).click();
    const gestion = page.getByRole('dialog', { name: 'Gestión del taller', exact: true });
    await gestion.getByRole('button', { name: 'Plantillas', exact: true }).click();
    await gestion.locator('[name="titulo"]').fill('Revisión de carga del taller');
    await gestion.locator('[name="pasos"]').fill('Descartar humedad y batería dañada\nConfirmar variante y registrar síntomas');
    await gestion.getByRole('button', { name: 'Guardar versión de plantilla' }).click();
    await expect(gestion.locator('[name="id"]')).toContainText('Revisión de carga del taller · v1');
    await gestion.getByRole('button', { name: 'Cerrar ficha' }).click();
    const d = await ficha(page, 'Procedimiento');
    await d.locator('[name="confirmar"]').selectOption('si');
    await d.getByRole('button', { name: 'Aplicar plantilla y reiniciar pasos' }).click();
    await expect(d.locator('.procedimiento > summary')).toContainText('Revisión de carga del taller');
});

test('SDK Firebase empaquetado inicia el login sin credenciales ni escrituras reales', async ({ page }) => {
    const errores = [];
    page.on('pageerror', e => errores.push(e.message));
    await page.route('**/*.googleapis.com/**', r => r.abort());
    await page.goto('/');
    await expect(page.locator('#login-screen')).toBeVisible();
    await expect(page.locator('#login-screen h1')).toHaveText('KryoFix');
    await expect.poll(() => page.evaluate(() => window.TechFix?.iniciada)).toBe(true);
    await page.evaluate(async () => { if ('serviceWorker' in navigator) await navigator.serviceWorker.ready; });
    await expect(page.getByRole('dialog', { name: 'Version nueva disponible', exact: true })).toHaveCount(0);
    expect(errores).toEqual([]);
});

test('la ficha en tema oscuro conserva contraste de texto y fondo', async ({ page }) => {
    await preparar(page);
    await page.locator('#btn-theme').click();
    const d = await ficha(page, 'Diagnóstico');
    const contraste = await d.evaluate(n => {
        const css = getComputedStyle(n);
        const luminancia = color => {
            const c = color.match(/\d+/g).slice(0, 3).map(v => {
                const x = Number(v) / 255;
                return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
            });
            return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
        };
        const a = luminancia(css.color), b = luminancia(css.backgroundColor);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    expect(contraste).toBeGreaterThan(4.5);
});

test('compras pendientes, recepción y devolución funcionan desde la ficha', async ({ page }) => {
    const errores = await preparar(page);
    await page.getByRole('button', { name: 'Gestión del taller', exact: true }).click();
    const d = page.getByRole('dialog', { name: 'Gestión del taller', exact: true });
    await d.getByRole('button', { name: 'Compras', exact: true }).click();
    for (const [k, v] of Object.entries({ nombre: 'Pantalla nueva', marca: 'Apple', modelo: 'iPhone 13', proveedor: 'Proveedor de prueba', cantidad: '3', costo: '25000' })) await d.locator('[name="' + k + '"]').fill(v);
    await d.getByRole('button', { name: 'Registrar compra pendiente' }).click();
    await expect(d.locator('[name="id"]')).toContainText('Pantalla nueva');
    await d.getByRole('button', { name: 'Confirmar resolución de compra' }).click();
    await expect(d.locator('.ficha-cuerpo')).toContainText('Proveedor de prueba · recibida');
    await d.getByRole('button', { name: 'Inventario', exact: true }).click();
    await expect(d.locator('.ficha-cuerpo')).toContainText('disponible 3 / reservado 0');
    const f = d.locator('form').filter({ has: page.getByRole('button', { name: 'Confirmar movimiento de inventario' }) });
    await f.locator('[name="tipo"]').selectOption('devolucion');
    await f.locator('[name="cantidad"]').fill('1'); await f.locator('[name="motivo"]').fill('Defecto al probar el repuesto');
    await f.getByRole('button').click();
    await expect(d.locator('.ficha-cuerpo')).toContainText('disponible 2 / reservado 0');
    await expect(d.locator('.ficha-cuerpo')).toContainText('devolucion -1'); expect(errores).toEqual([]);
});

test('garantía abre una orden vinculada sin reabrir la original', async ({ page }) => {
    await preparar(page);
    await page.evaluate(() => window.__db.collection('equipos').doc('a').update({ estado: 'entregado', abono: 50000 }));
    // Entregadas quedan fuera del filtro inicial: abrir mediante el enlace privado.
    await page.evaluate(() => { window.location.hash = '#orden=a'; });
    // La apertura por hash se escucha al iniciar; usar el historial accesible en la gestión.
    await page.getByRole('button', { name: 'Gestión del taller', exact: true }).click();
    const gestion = page.getByRole('dialog', { name: 'Gestión del taller', exact: true });
    await gestion.getByRole('button', { name: /KRF-000001 · Cliente de prueba/ }).click();
    const d = page.locator('#ficha-dialog');
    await d.getByRole('button', { name: 'Garantía', exact: true }).click();
    const f = d.locator('form').filter({ has: page.getByRole('button', { name: 'Crear orden de retrabajo' }) });
    await f.locator('[name="motivo"]').fill('Pantalla con falla recurrente');
    await f.getByRole('button').click();
    await expect(d.getByRole('button', { name: 'Abrir orden de retrabajo' })).toBeVisible();
    await d.getByRole('button', { name: 'Abrir orden de retrabajo' }).click();
    await expect(d.getByRole('button', { name: 'Ver orden original de garantía' })).toBeVisible();
    expect(await page.evaluate(() => window.__db._datos.get('equipos').get('a').estado)).toBe('entregado');
});

test('firma táctil/lápiz conserva trazos al rotar y confirma entrega', async ({ page }) => {
    const errores = await preparar(page);
    await page.evaluate(() => window.__db.collection('equipos').doc('a').update({ estado: 'reparado', costo: 0, abono: 0,
        calidad: { pantalla: 'correcto', carga: 'correcto', audio: 'correcto', camaras: 'correcto', conectividad: 'correcto' } }));
    await page.evaluate(() => window.TechFix.archivarProyecto('a'));
    const canvas = page.locator('#canvas-firma'); await expect(canvas).toBeVisible();
    const r = await canvas.boundingBox();
    await canvas.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: r.x + 15, clientY: r.y + 20 });
    await canvas.dispatchEvent('pointermove', { pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: r.x + 80, clientY: r.y + 50 });
    await canvas.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 1, isPrimary: true });
    const antes = await canvas.evaluate(c => c.toDataURL());
    const v = page.viewportSize(); await page.setViewportSize({ width: v.height, height: v.width });
    expect(await canvas.evaluate(c => c.toDataURL())).toBe(antes);
    await page.getByRole('button', { name: 'Confirmar y entregar', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__db._datos.get('equipos').get('a').estado)).toBe('entregado');
    expect(errores).toEqual([]);
});

test('viewport reducido por teclado mantiene formularios alcanzables y objetivos táctiles', async ({ page }) => {
    await preparar(page); const d = await ficha(page, 'Diagnóstico');
    await page.setViewportSize({ width: page.viewportSize().width, height: 350 });
    await d.locator('[name="causa"]').fill('Prueba con teclado abierto');
    await d.getByRole('button', { name: 'Guardar diagnóstico', exact: true }).click();
    await expect(d.locator('.ficha-cabecera + p')).toContainText('Revisión 1');
    expect(await d.evaluate(n => n.scrollWidth <= n.clientWidth + 1)).toBe(true);
    if (await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches)) {
        const botones = await d.locator('.ficha-pestanas button').evaluateAll(ns => ns.map(n => n.getBoundingClientRect().height));
        expect(botones.every(h => h >= 44)).toBe(true);
    }
});

test('perfil backend opcional: aprobación muestra texto seguro y confirma decisión sin login', async ({ page }) => {
    perfilBackendOpcional.add(page);
    await page.route('**/entorno.js', route => route.fulfill({ contentType: 'application/javascript', body: 'window.KryoFixEntorno = {modo: "completo"};' }));
    const token = 'a'.repeat(43); let decisiones = 0;
    await page.route('**/api/aprobacion', async route => {
        const d = route.request().postDataJSON();
        if (d.decision) decisiones++;
        await route.fulfill({ json: d.decision ? { confirmado: true, decision: d.decision } : {
            expira: Date.now() + 3600000, presupuesto: { version: 1, total: 12000, lineas: [{ concepto: '<img src=x onerror=alert(1)>', cantidad: 1, precio: 12000 }], plazo: '3 días', condiciones: 'Pruebas incluidas' } } });
    });
    await page.goto('/aprobacion.html#' + token);
    await expect(page.locator('#detalle-presupuesto')).toContainText('<img src=x onerror=alert(1)>');
    await expect(page.locator('#detalle-presupuesto img')).toHaveCount(0);
    await page.getByLabel('Tu nombre').fill('Cliente de prueba'); await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Aprobar presupuesto', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Decisión confirmada: aprobado'); expect(decisiones).toBe(1);
});

test('selección de fotografía comprime y previsualiza evidencia sin desbordar', async ({ page }) => {
    await preparar(page);
    const captura = page.locator('#foto-evidencia');
    await expect(captura).toHaveAttribute('capture', 'environment');
    await captura.setInputFiles({ name: 'evidencia.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64') });
    await expect(page.locator('#img-evidencia-preview')).toBeVisible();
    await expect(page.locator('#img-evidencia-preview')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('enlace inválido no muestra formulario ni consulta el backend', async ({ page }) => {
    let solicitudes = 0;
    await page.route('**/api/aprobacion', route => { solicitudes++; return route.abort(); });
    await page.goto('/aprobacion.html#invalido');
    await expect(page.getByRole('status')).toContainText('Enlace incompleto o inválido');
    await expect(page.locator('#decision-presupuesto')).toBeHidden(); expect(solicitudes).toBe(0);
});

test('Spark muestra operaciones manuales y no controles que requieran Blaze', async ({ page }) => {
    await preparar(page);
    const d = await ficha(page, 'Evidencias');
    await expect(d.locator('.ficha-cuerpo')).toContainText('80 KiB');
    await expect(d.getByRole('button', { name: 'Migrar archivo a Storage privado' })).toHaveCount(0);
    await d.getByRole('button', { name: 'Contacto', exact: true }).click();
    await expect(d.getByRole('button', { name: 'Abrir mensaje en WhatsApp' })).toBeVisible();
    await expect(d.getByRole('button', { name: 'Programar mensaje de servicio' })).toHaveCount(0);
    await d.getByRole('button', { name: 'Cerrar ficha' }).click();
    await page.getByRole('button', { name: 'Gestión del taller', exact: true }).click();
    const gestion = page.getByRole('dialog', { name: 'Gestión del taller', exact: true });
    await gestion.getByRole('button', { name: 'Informes', exact: true }).click();
    await expect(gestion.getByRole('button', { name: 'Calcular informe consistente en el servidor' })).toHaveCount(0);
    await expect(gestion.getByRole('button', { name: 'Consultar todas las órdenes y calcular' })).toBeVisible();
});

test('copia privada JSON descarga una orden con sus pagos y eventos', async ({ page }) => {
    await preparar(page);
    const d = await ficha(page);
    const descarga = page.waitForEvent('download');
    await d.getByRole('button', { name: 'Descargar copia privada de esta orden (JSON)' }).click();
    const archivo = await descarga;
    expect(archivo.suggestedFilename()).toBe('KryoFix-orden-a.json');
    const { readFile } = await import('node:fs/promises');
    const copia = JSON.parse(await readFile(await archivo.path(), 'utf8'));
    expect(copia.formato).toBe('kryofix-orden-v1');
    expect(copia.orden.cliente).toBe('Cliente de prueba');
    expect(copia.pagos).toEqual([]); expect(copia.eventos).toEqual([]);
});


test('Spark rechaza incluso enlaces válidos de aprobación remota sin consultar API', async ({ page }) => {
    await page.goto('/aprobacion.html#' + 'a'.repeat(43));
    await expect(page.getByRole('status')).toContainText('registra la aprobación manualmente');
    await expect(page.locator('#decision-presupuesto')).toBeHidden();
});
