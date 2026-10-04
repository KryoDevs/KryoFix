# Análisis de TechFix Tracker Pro

Este documento tiene dos partes:

- **Parte 1** — la revisión original (commit `d751523`) y su resolución.
- **Parte 2** — la **segunda auditoría** (commit `5cd5554`), que es la que originó
  los cambios de la versión anterior.
- **Parte 3** — la **tercera auditoría y rediseño integral Enterprise**, con
  corrección de bugs de runtime, nuevas funcionalidades operativas y nuevo
  sistema de diseño visual.

## Estado de la verificación automática

```
ESLint ................ 0 errores, 0 avisos
Auditoría estática .... 0 errores, 0 avisos
Tests (jsdom) ......... 75 / 75   (antes: 67 / 67)
```

Los tres comandos se ejecutan en cada push y cada PR con
`.github/workflows/calidad.yml`.

---

# Parte 1 — Revisión original (resuelta)

El proyecto tenía **tres fallas de seguridad críticas** que exponían datos
personales de los clientes del taller y **una falla visual** que dejaba la
pantalla principal sin estilos.

| Severidad | Encontrados | Resueltos |
|-----------|-------------|-----------|
| 🔴 Crítica (seguridad / pérdida de datos) | 5 | 5 |
| 🟠 Alta (funcionalidad rota) | 8 | 8 |
| 🟡 Media (robustez, rendimiento, UX) | 11 | 11 |
| ⚪ Mejoras de fondo | 10 | 3 (resto documentado) |

Resumen de lo corregido entonces:

1. **Fuga de datos entre técnicos (crítica).** La consulta descargaba hasta 500
   órdenes de *todos* los técnicos y filtraba en el navegador: nombre, teléfono,
   IMEI, PIN, foto y firma viajaban al dispositivo. Ahora `.where('uid','==',…)`
   en el servidor, con índice compuesto y reglas que lo imponen.
2. **La página pública del QR exponía la ficha completa (crítica).** `status.js`
   leía `equipos` sin autenticación. Se introdujo el espejo público
   `seguimiento` limitado por regla a `uid`, `estado`, `modelo` y `actualizado`.
3. **Reglas de Firestore ausentes del repositorio (crítica).** Único control de
   acceso real, fuera de todo control de versiones. Ahora versionadas.
4. **Pantalla principal sin estilos.** Clases generadas por `app.js` que no
   existían en el CSS (`tarjeta-proyecto`, `badge-estado`, `btn-whatsapp`…).
5. **La PWA no abría sin conexión.** SDK y SweetAlert2 venían de CDN y no estaban
   en la caché; el service worker no tenía `skipWaiting` e interceptaba POST.

*(El detalle completo, con las listas de 10 cosas bien / 10 mal / 10 mejorables,
está en el historial de Git de este archivo.)*

---

# Parte 2 — Segunda auditoría (commit `5cd5554`)

Se revisó el estado real del repositorio **antes** de tocar nada: `git log`,
configuración, código, reglas, workflows, assets y la salida del propio CI.

## 2.1 Lo primero que estaba fallando: el CI (y por tanto, la garantía de calidad)

```
completed  failure  Calidad (lint + auditoria + tests)   main  push  #36965696614
completed  failure  Calidad (lint + auditoria + tests)   main  push  #36965577419
completed  success  Deploy to Firebase Hosting on merge   main  push  #36965696625
```

La verificación estaba en rojo en `main` y, como el deploy es un workflow
independiente, **el hosting seguía publicando** versiones sin pasar ninguna
comprobación. La causa concreta:

```
app/app.js
  1338:26  error  'Blob' is not defined  no-undef
```

El código nuevo del ciclo anterior (exportar CSV) usaba `Blob` sin declararlo
entre los globales de ESLint. **Corregido**, y además ahora `npm run check`
verifica también que los assets generados estén en su sitio y sincronizados
(§2.6), de modo que un fallo se detecta antes de desplegar.

## 2.2 🔴 Hallazgos graves

### 1. `index.html` estaba corrupto (mezcla latin-1 / UTF-8)

```
app/index.html:14167  b'... placeholder="?? Buscar marca, modelo o reparaci\xf3n..." ...'
                                                      ^^^^^^^^^^^ byte 0xF3 (latin-1)
```

El archivo tenía emojis en UTF-8 y, en medio, byte `0xF3` con el resto de los
emojis convertidos en `??`. En la interfaz real se leía:

| Antes | Ahora |
|-------|-------|
| `?? Online` (indicador de red) | `📶 Online` |
| `?? Exportar` (botón nuevo) | `📤 Exportar CSV` |
| `?? Buscar marca, modelo o reparaciM-sn...` | `🔍 Buscar por marca, modelo o reparacion...` |

Una barra de búsqueda con texto ilegible en producción es un síntoma rápido de
"aquí se editó con un editor mal configurado". **Corregido** y con **regresión
automatizada**: `tools/audit.mjs` falla si un archivo de texto no está en UTF-8 o
si encuentra `??` en texto visible.

### 2. La firma de conformidad se guardaba como un rectángulo negro

El lienzo se preparaba con `ctx.clearRect(...)` (dejándolo **transparente**) y
luego se exportaba con `canvas.toDataURL('image/jpeg', 0.5)`. El JPEG no tiene
canal alfa: cada píxel transparente se codifica **negro**. Como el trazo se
dibujaba en `#111827`, el resultado era un rectángulo negro con una firma negra
casi invisible.

Es el documento que el cliente firma como conformidad de la entrega: no se podía
leer, y era imposible de recuperar después. **Corregido**: se pinta el fondo de
blanco en `prepararCanvas()` y en "Limpiar" (`fillRect`), con un test que exige
que el primer trazo del contexto sea un relleno de fondo.

### 3. El QR del ticket se generaba en un servicio de terceros

`api.qrserver.com` recibía la URL de seguimiento de **cada orden impresa**. Para
un taller, eso es enviar datos de sus órdenes a un servidor externo sin ningún
contrato; además, sin internet el ticket salía sin QR. **Corregido**:

- el QR se genera en el navegador con una librería local (`app/vendor/qrcode.js`,
  el mismo QR exacto de la orden);
- si la librería no está disponible (primer arranque sin red), se usa un **QR
  estático versionado** (`app/ticket-qr.png`) que apunta a la página de
  seguimiento, y la URL y el número de orden siempre quedan impresos como texto;
- `tests/assets.test.mjs` **decodifica** el PNG con `jsQR` y comprueba que apunta
  a la URL correcta: un QR ilegible es invisible a ojo.

### 4. Dependencias de CDN y política de seguridad

Los SDK de Firebase y SweetAlert2 se cargaban de `gstatic.com` y `jsdelivr.net`.
Eso significaba: un CDN comprometido podía ejecutar código en una página con
datos personales; una red que bloquee CDNs dejaba el taller sin aplicación; y la
CSP no podía pasar de `script-src 'self' https://…`.

**Corregido**: las cinco dependencias se sirven desde `app/vendor/` (mismo
origen), lo que **endurece la CSP a `script-src 'self'`**, elimina los CDNs del
`connect-src` y permite que el service worker las precachee (la PWA ahora sí
funciona sin conexión desde la primera instalación). Se añadió `npm run vendor`
y un test que verifica que lo servido es **byte a byte** el paquete fijado en
`package.json`.

### 5. Arranque silenciosamente roto

Si el SDK no cargaba, el archivo entero moría en la primera línea con
`firebase is not defined` y la pantalla quedaba en blanco. En la página pública
del QR el mensaje "Buscando tu equipo..." se quedaba ahí para siempre.
**Corregido**: aviso en pantalla con botón "Reintentar" en la app, y mensaje de
error claro en la página pública cuando el SDK o el permiso de lectura fallan.

## 2.3 🟠 Problemas funcionales y de datos

| # | Problema encontrado | Impacto | Estado |
|---|---------------------|---------|--------|
| 1 | El botón decía **"Guardar y generar ticket"** pero no generaba ningún ticket: había que buscar la tarjeta y acertar "🧾 Ticket" | 🟠 Función prometida que no existía | ✅ Al guardar pregunta "¿Imprimir la boleta ahora?" |
| 2 | **Fechas guardadas como texto localizado** (`new Date().toLocaleDateString('es-CL')` → `02-10-2026`) | 🟠 No ordenables, ambiguas y sin zona horaria; ensucian cualquier exportación | ✅ Se guarda **ISO 8601** (con lectura tolerante de las órdenes antiguas) |
| 3 | **El selector de estado permitía "Entregado" sin firma** y retroceder de `entregado` a `ingresado` con un clic | 🟠 Contradecía el aviso de la propia app; pérdida de trazabilidad | ✅ Transiciones válidas por etapa (+1 hacia atrás), opciones deshabilitadas y aviso si se entrega sin firma |
| 4 | **Sin historial de estados**: solo el estado actual | 🟡 Imposible medir tiempos de reparación o resolver disputas | ✅ `historial: [{estado, en, por}]` con `arrayUnion` |
| 5 | **Sin recuperación ni cambio de contraseña** (mejora documentada y pendiente) | 🟠 Un taller que olvida la contraseña queda fuera de su propio sistema | ✅ "Olvidé mi contraseña" + cambio de contraseña desde la sesión |
| 6 | **Nada avisaba de equipos sin retirar**, aunque el ticket imprima "equipos no retirados en 60 días serán donados" | 🟡 Riesgo legal/operativo sin control | ✅ Aviso a los 30 días + distintivo a los 7 días en la tarjeta |
| 7 | **CSV mal escapado**: comillas internas sin duplicar, sin BOM, sin saldo, e ignoraba el filtro activo | 🟠 Filas rotas (`Ana "la jefa"`), tildes ilegibles en Excel, exportaciones que no corresponden a lo visto | ✅ Escapado RFC 4180 de todos los campos, BOM, saldo y fechas, y exporta lo que el filtro deja ver |
| 8 | **Catálogo con dos rutas de render**: el buscador reimplementaba el pintado sin debounce | 🟡 Jank al escribir y riesgo de que ambas rutas diverjan (el bug apareció dos veces) | ✅ Una sola función `renderizarCatalogo()` + debounce + estado vacío correcto |
| 9 | **Copiar el enlace de seguimiento era manual** (seleccionar el texto del ticket) | 🟡 Fricción diaria | ✅ Botón "📤 Compartir" (Web Share API → portapapeles → texto) |
| 10 | **Modal de firma sin trampa de foco** | 🟡 Accesibilidad: el tabulador se escapaba del diálogo | ✅ Trampa de foco y `aria-live` en el aviso de red |

## 2.4 🟡 Robustez, rendimiento y presentación

- **Números de orden legibles** (`TF-251002-001`): antes el ticket mostraba 8
  caracteres del ID aleatorio de Firestore, imposible de dictar por teléfono.
- **Eventos conectados de forma tolerante**: `$('foto-evidencia')`,
  `$('catalogo-form')`, `$('marca')`, `$('modelo')`… se usaban sin comprobar; un
  cambio de HTML rompía la aplicación entera sin decir nada.
- **Boleta construida con DOM**, no concatenando `innerHTML` (menos superficie de
  inyección y sin `escapeHtml` manual campo por campo).
- **Compresión de foto con reintentos**: el `while` de calidad podía quedarse
  corto con fotos muy detalladas y superar el límite de 1 MiB por documento.
  Ahora, si hace falta, reduce también el lado mayor. Límite: 200 KB.
- **Binarios**: `icon-512.png` pesaba 1 MB (y medía 1024×1024 px, no 512),
  `logo.jpg` 500 KB mostrado a 80×80. Ahora **105 KB / 17 KB / 5 KB**, con test
  de tamaño y de dimensiones para que no vuelvan a crecer.
- **Indicador de red** con `aria-live`, sin `setTimeout` duplicados.
- **`mensaje-estado` en la página pública**: el cliente ve una frase en lenguaje
  claro ("Nuestro técnico está revisando tu equipo") además de la línea de tiempo.

## 2.5 ✅ Lo que ya estaba bien (y sigue igual)

1. Aislamiento por `uid` en el servidor, espejo público mínimo y reglas
   versionadas — verificado, sin regresiones.
2. `escapeHtml` completo y uso de `textContent`/`createElement` en las tarjetas.
3. Firma táctil con `touchstart`/`touchmove` `{passive:false}` y
   `touch-action: none`; escalado de coordenadas correcto.
4. Service worker con `skipWaiting`, `clients.claim` y sin interceptar escrituras.
5. Delegación de eventos (sin `onclick` inline) y `noopener` en `window.open`.
6. Dashboard que cuenta cierres por fecha real de reparación.
7. `enablePersistence` + borrado de la caché offline al cerrar sesión.
8. Precios con `Intl.NumberFormat('es-CL')` en todos los puntos.
9. Reglas que impiden publicar un campo sensible por error (`keys().hasOnly`).
10. Reconciliación de estados `revision`/`En Revision` heredada de datos antiguos
    documentada y tolerada.

## 2.6 Tests y auditoría: de 28 a 67 comprobaciones

| Área | Comprobación añadida |
|------|----------------------|
| Assets | El QR decodifica y apunta a `status.html`; el PNG versionado está sincronizado con el generador |
| Assets | Iconos y logo con dimensiones y peso máximos; el manifest apunta a iconos existentes |
| Dependencias | `app/vendor/` es idéntico a los paquetes fijados; sin rangos `^`/`~` en `package.json` |
| Ticket | Se imprime el número de orden; QR local o de respaldo; URL como texto |
| Firma | El fondo se pinta de blanco; la entrega guarda firma, fecha e historial |
| Estados | Transiciones válidas, opciones deshabilitadas, historial y avisos de espera |
| CSV | Escapado RFC 4180, BOM, saldo y respeto del filtro activo |
| Red | Offline/Online con estilos y visibilidad correctos |
| Formulario | Marca del campo inválido, fechas ISO y teléfono normalizado |
| Reglas | `seguimiento` limitado a 4 claves y sin escritura anónima; `equipos`/`catalogo` privadas |
| Arranque | Sin Firebase se avisa en pantalla y no hay excepciones sin capturar |

La auditoría estática (`tools/audit.mjs`) suma familias de comprobación nuevas:
codificación UTF-8, `??` en texto visible, scripts referenciados inexistentes o
servidos por CDN, CSP con `unsafe-inline`/`unsafe-eval`, uso de `Query.count()`
(que **no existe** en `firebase@10.8.1` compat), presencia del QR versionado y
precacheado de `app/vendor/`. También se corrigieron dos falsos negativos propios:
el chequeo de `noopener` solo miraba una línea y el de debounce daba por bueno
cualquier `setTimeout`.

## 2.7 ⚠️ Antes de desplegar esta versión

1. **Publica reglas e índices** (los workflows de GitHub solo despliegan hosting):
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes
   ```
2. **Las órdenes nuevas escriben campos nuevos** (`idOrden`, `historial`,
   `fechaReparacion`, `fechaEntrega`). Las antiguas siguen funcionando: la app las
   tolera y la migración existente (`await TechFix.migrar()`) sigue siendo la
   recomendada una sola vez.
3. **Sube la `VERSION` de `app/sw.js`** en cada despliegue de archivos cacheables
   (ahora `v5`). Los clientes activos reciben el aviso "Versión nueva
   disponible" y recargan.
4. **Revisa la CSP publicada**: ya no permite scripts de terceros. Si algún día
   añades un servicio externo, actualiza `connect-src`/`img-src` de forma
   consciente, no con un comodín.

## 2.8 ⚪ Mejoras de fondo que siguen pendientes (documentadas, no urgentes)

1. **Mover fotos y firmas a Firebase Storage.** Hoy son base64 dentro del
   documento: Firestore limita a 1 MiB por documento y cada `onSnapshot` vuelve a
   descargar todas las imágenes. El bucket ya está configurado y sin usar.
2. **Paginación real** en lugar de `limit(500)` (carga incremental con
   `startAfter()` o filtro por rango de fechas).
3. **Probar las reglas con el emulador** (`@firebase/rules-unit-testing`). Hoy hay
   8 comprobaciones estáticas sobre `firestore.rules`, pero no se ejecutan contra
   un emulador real.
4. **No guardar el PIN en claro** (borrarlo al entregar, cifrarlo o eliminarlo y
   usar el modo de reparación del fabricante).
5. **Roles y multi-usuario** (dueño / técnico / recepción) con *custom claims*.
6. **Borrado lógico** (papelera) en lugar del borrado definitivo actual sobre un
   documento con valor legal y contable.
7. **Historial visible en la UI**: Resuelto en la Parte 3 (`verHistorial`).

---

# Parte 3 — Tercera auditoría, mejoras funcionales y rediseño Enterprise

Durante el ciclo de auditoría profunda y mejora continua se detectaron y
resolvieron los siguientes hallazgos críticos y funcionales:

## 3.1 🔴 Bugs de código detectados y corregidos

1. **QR dinámico roto en producción (`vendor/qrcode.min.js` -> 404):**
   `app/app.js` definía `URL_QR_LIB = 'vendor/qrcode.min.js'`, mientras que el
   archivo real copiado por `tools/vendor.mjs` y precacheado por `app/sw.js` era
   `vendor/qrcode.js`. Al fallar en silencio `cargarScript(URL_QR_LIB)`, ningún
   ticket impreso en producción generaba el QR dinámico con el ID de la orden.
   - **Solución:** se corrigió `URL_QR_LIB = 'vendor/qrcode.js'` y se añadió en
     `tools/audit.mjs` la verificación de que todo archivo pasado a
     `cargarScript(...)` exista físicamente en `app/`.
2. **Botón `🔑 Contraseña` desconectado del evento `click`:**
   `cambiarContrasena()` existía en `app.js` pero no estaba enlazado a
   `#btn-contrasena`. Ahora queda conectado con `escuchar('btn-contrasena', 'click', cambiarContrasena)`.
3. **Portal público `status.html` sin buscador manual para el QR estático:**
   Cuando un cliente entraba a `status.html` sin `?id=` (por ejemplo, desde el QR
   estático de respaldo `ticket-qr.png`), solo veía un mensaje de error y no
   tenía dónde escribir el código de su orden.
   - **Solución:** se incorporó `#form-buscar-orden` con `#input-codigo-orden`
     para consultar cualquier orden en vivo sin recargar la página.

## 3.2 🚀 Nuevas funcionalidades operativas implementadas

1. **Edición de órdenes en taller (`editarProyecto` / botón `✏️ Editar`):**
   Permite actualizar cliente, teléfono, diagnóstico/falla, condición/accesorios,
   presupuesto total (`costo`) y `abono` sin recrear la orden ni perder el QR
   entregado al cliente.
2. **Edición de precios en el Catálogo (`editarCatalogo`):**
   Permite modificar precios o descripciones del tarifario con un clic.
3. **Visor de Historial y Trazabilidad (`verHistorial` / botón `🕒 Historial`):**
   Muestra la línea de tiempo completa de estados por los que pasó el equipo con
   sus fechas.
4. **Nuevos KPIs financieros y operativos interactivos:**
   Se sumaron **Listos para Retiro** (`#stat-listos`) y **Saldo por Cobrar**
   (`#stat-pendiente`) al dashboard, además de filtrado rápido al hacer clic en
   las tarjetas de métricas.
5. **Ordenamiento multicriterio (`#ordenar-proyectos`) y contadores en vivo:**
   Orden por más recientes, más antiguos, mayor saldo pendiente o cliente (A-Z),
   junto a píldoras contadoras (`#contador-resultados`, `#contador-catalogo`).
6. **Formulario de ingreso colapsable (`#btn-toggle-ingreso`):**
   Permite minimizar o expandir el formulario de recepción para priorizar el
   tablero de trabajo diario.
7. **Portal de seguimiento del cliente mejorado (`status.html` / `status.js`):**
   Barra de progreso porcentual (`20%` a `100%`), distintivo de estado actual,
   fecha de última actualización, subtítulos explicativos por etapa y conmutador
   de tema claro/oscuro.

## 3.3 🎨 Rediseño visual profesional (Enterprise Design System)

- Sistema de tokens CSS semánticos para modo claro y oscuro (`estilos.css`),
  eliminando estilos inline desconectados en `status.html`.
- Tipografía moderna con números tabulares (`tabular-nums`) para importes,
  métricas y códigos de orden (`TF-YYMMDD-NNN`).
- Tarjetas de trabajo rediseñadas con jerarquía clara (encabezado de estado,
  chip monoespaciado de orden, bloque resaltado de falla, desglose financiero y
  botonera de acciones equilibrada).
- Sincronización verificada por `tools/audit.mjs` sobre las 4 piezas (`index.html`,
  `app.js`, `status.html`, `status.js`) y consistencia de `firebaseConfig`.

