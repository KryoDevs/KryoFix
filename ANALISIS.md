# Análisis de TechFix Tracker Pro

Revisión completa del repositorio en el commit `d751523`, con los bugs encontrados,
las tres listas solicitadas (10 bien / 10 mal / 10 mejorables) y el registro del
ciclo de corrección.

**Tamaño auditado:** 1.386 líneas en 8 archivos (`app.js` 548, `index.html` 265,
`estilos.css` 253, `status.html` 152, `status.js` 78, `sw.js` 53, `manifest.json`,
`firebase.json`).

---

## Resumen ejecutivo

El proyecto es un buen producto con una base técnica sencilla y sensata, pero
tenía **tres fallas de seguridad críticas** que exponían datos personales de los
clientes del taller, y **una falla visual que dejaba la pantalla principal sin
estilos**.

| Severidad | Encontrados | Resueltos |
|-----------|-------------|-----------|
| 🔴 Crítica (seguridad / pérdida de datos) | 5 | 5 |
| 🟠 Alta (funcionalidad rota) | 8 | 8 |
| 🟡 Media (robustez, rendimiento, UX) | 11 | 11 |
| ⚪ Mejoras de fondo | 10 | 3 (resto documentado) |

Estado final de la verificación automática:

```
ESLint ................ 0 errores
Auditoría estática .... 0 errores, 0 avisos
Tests (jsdom) ......... 28 / 28
```

---

## 🔴 Fallas graves encontradas

### 1. Fuga de datos entre técnicos (crítica)

`app.js:122` consultaba la colección completa y filtraba **en el navegador**:

```js
db.collection('equipos').orderBy('timestamp','desc').limit(500)
  .onSnapshot(snapshot => {
      snapshot.forEach(doc => {
          const data = doc.data();
          if (!data.uid || data.uid === currentUser.uid) { ... }   // filtro en cliente
      });
```

Cualquier usuario autenticado **descargaba hasta 500 órdenes de todos los
técnicos**: nombre del cliente, teléfono, IMEI, PIN del equipo, fotografía y
firma. El filtro visual no impide nada: los datos ya viajaron al dispositivo y
son visibles en la pestaña Network o con `TechFix.proyectos()`.

El mismo defecto provocaba un **bug funcional**: si otros usuarios tenían 500
registros más recientes, el técnico no veía **ninguno** de los suyos.

**Corregido:** el filtro es ahora del lado del servidor
(`.where('uid','==',currentUser.uid)`), más `firestore.rules` que lo imponen,
más el índice compuesto que la consulta necesita.

### 2. La página pública del QR exponía la ficha completa (crítica)

`status.js:32` leía la colección privada:

```js
db.collection('equipos').doc(ticketId).onSnapshot(doc => { ... })
```

La página solo pinta estado y modelo, pero **descarga el documento entero** y es
pública, sin autenticación. Para que funcionara, las reglas tenían que permitir
lectura anónima sobre `equipos`. Resultado: con el ID impreso en un ticket (o
probando IDs) se obtenía **el PIN de desbloqueo del teléfono del cliente**, su
número, su IMEI, la foto del equipo y su firma manuscrita.

**Corregido:** se introdujo la colección espejo `seguimiento`, que solo contiene
`uid`, `estado`, `modelo` y `actualizado`. Las reglas usan `keys().hasOnly([...])`,
así que es *imposible* publicar un campo sensible por error. `equipos` pasó a ser
estrictamente privada.

### 3. Reglas de Firestore ausentes del repositorio (crítica)

No existía `firestore.rules` ni sección `firestore` en `firebase.json`. El propio
código lo delataba:

```js
Swal.fire('Error de Permisos', 'Actualiza las reglas de Firestore en la consola de Firebase.', 'error');
```

Las reglas son el **único** control de acceso real de esta arquitectura y estaban
fuera del control de versiones, sin revisión ni despliegue reproducible.

**Corregido:** `firestore.rules` + `firestore.indexes.json` versionados y
referenciados en `firebase.json`, con validación de propiedad, de forma del
documento y de rangos (`abono <= costo`).

### 4. La pantalla principal se renderizaba sin estilos (alta)

`app.js` generaba tarjetas con clases que **no existían** en `estilos.css`:

| Clase usada por el JS | ¿Definida en el CSS? |
|---|---|
| `tarjeta-proyecto` | ❌ (el CSS definía `tarjeta`) |
| `badge-estado`, `estado-ingresado`… | ❌ |
| `tarjeta-fecha` | ❌ (el CSS definía `fecha`) |
| `select-estado-rapido` | ❌ (el CSS definía `select-estado`) |
| `btn-whatsapp` | ❌ (el CSS definía `btn-wsp`) |

El CSS había quedado desincronizado tras un refactor: ~60 líneas de estilos
muertos y la lista de equipos saliendo como texto plano sin tarjetas, sin colores
de estado y sin botones con formato.

**Corregido:** estilos reescritos para las clases reales, estilos muertos
eliminados, y `tools/audit.mjs` falla el build si vuelve a aparecer una clase
huérfana.

### 5. La PWA no funcionaba sin conexión (alta)

El service worker precacheaba solo los archivos propios. Firebase SDK y
SweetAlert2 venían de CDN y **no estaban en la caché**, así que abrir la app sin
red producía `firebase is not defined` y una pantalla en blanco — justo lo
contrario de lo que promete una PWA para un taller.

Además la estrategia era *cache-first* pura, sin `skipWaiting()` ni
`clients.claim()`: los usuarios quedaban con código viejo indefinidamente (el
último commit del repo, *"Forzar purga de caché del PWA para reemplazar código
corrupto en clientes locales"*, es la cicatriz de ese problema). Y se
interceptaban **todas** las peticiones, incluidas las `POST` de escritura a
Firestore.

**Corregido:** SW reescrito — red-primero para navegaciones, stale-while-revalidate
para estáticos, cache-first para librerías de versión fija (ahora sí precacheadas),
se ignoran los métodos distintos de GET y los dominios de Firebase, y
`skipWaiting` + `clients.claim` + aviso de versión nueva en la UI.

---

## ✅ 10 cosas que están BIEN

1. **El producto resuelve un problema real y completo.** El flujo ingreso →
   estados → entrega con firma → ticket con QR cubre el ciclo entero de un taller,
   sin funcionalidad de relleno.
2. **Cero build, cero framework.** HTML/CSS/JS plano: arranca instantáneo, lo
   puede mantener cualquiera, y no hay deuda de dependencias de runtime que
   envejezca.
3. **Tiempo real bien aprovechado.** Usar `onSnapshot` en vez de recargas manuales
   hace que la lista y el dashboard se mantengan vivos entre el PC del mostrador y
   el móvil del técnico, gratis.
4. **El catálogo de precios que autocompleta el presupuesto** (marca → modelo →
   reparación → precio) es una idea de producto excelente: elimina errores de
   cobro y acelera el ingreso.
5. **Firma digital pensada para táctil**, con `touchstart`/`touchmove` y
   `{ passive: false }`, y `touch-action: none` en el CSS. El detalle correcto que
   mucha gente olvida.
6. **Compresión de la foto en el cliente** antes de guardar (redimensionado a 600 px
   + JPEG con calidad reducida): hay conciencia del coste de almacenamiento.
7. **Tematización clara y barata** con variables CSS y `data-theme`, persistida en
   `localStorage`. Implementación idiomática del modo oscuro.
8. **La página pública de seguimiento por QR** es un diferenciador de servicio real
   y está bien resuelta visualmente (timeline, estados, mensaje de retiro).
9. **Formato de moneda con `Intl.NumberFormat('es-CL')`** en lugar de concatenar
   `"$"`, en todos los sitios donde se muestra dinero.
10. **Despliegue ya automatizado** con GitHub Actions: preview por PR y producción
    al mergear, con el service account en secretos y no en el repo.

*(Mención extra: ya existían un `escapeHtml()` y un intento de filtrado por `uid`.
Estaban mal implementados, pero demuestran que la seguridad estaba en el radar.)*

---

## ❌ 10 cosas que están MAL

| # | Problema | Impacto | Estado |
|---|----------|---------|--------|
| 1 | **Datos de todos los técnicos descargados por cualquiera** (`orderBy` sin `where uid`, filtrado en cliente) | 🔴 Fuga de PII + el técnico podía no ver sus propios equipos | ✅ Corregido |
| 2 | **`status.html` público leía la ficha privada completa**: con el ID del ticket se obtenía PIN, teléfono, IMEI, foto y firma | 🔴 Fuga de PII masiva | ✅ Corregido (espejo `seguimiento`) |
| 3 | **Sin `firestore.rules` en el repositorio**; el código pedía "actualizar las reglas en la consola" | 🔴 Único control de acceso sin versionar ni revisar | ✅ Corregido |
| 4 | **CSS desincronizado del JS**: `tarjeta-proyecto`, `badge-estado`, `estado-*`, `select-estado-rapido`, `btn-whatsapp`, `tarjeta-fecha` no existían | 🟠 Pantalla principal sin estilos | ✅ Corregido + test de regresión |
| 5 | **La PWA no abría sin conexión** (CDN no precacheados) y el SW cache-first sin `skipWaiting` dejaba código viejo; además interceptaba POST y otros orígenes | 🟠 Función principal rota | ✅ Corregido |
| 6 | **Firma digital descalibrada**: canvas de 300×150 interno mostrado con `width:100%`; `getPointerPos` restaba el offset sin escalar → el trazo no seguía al dedo. Y se podía guardar **una firma en blanco** como prueba de conformidad | 🟠 Documento legal inválido | ✅ Corregido |
| 7 | **El PIN del equipo era inútil y además filtraba información**: se guardaba en claro, se mostraba como `'*'.repeat(pin.length)` (revelando la longitud exacta) y **no había forma de verlo** | 🟠 Campo inservible + fuga | ✅ Máscara fija + botón "Ver" |
| 8 | **Fugas de listeners y de datos locales**: `cargarCatalogo()` nunca se desuscribía, `onAuthStateChanged` podía duplicar suscripciones, y la caché offline de Firestore no se borraba al cerrar sesión (el siguiente usuario del dispositivo veía las órdenes del anterior) | 🟠 Fuga de memoria + privacidad | ✅ Corregido |
| 9 | **Datos corruptos por falta de validación y de normalización**: `wa.me/+56 9 1234 5678` (teléfono sin limpiar) generaba enlaces rotos; marca/modelo "Otro" se guardaba **literalmente como "Otro"** perdiendo el modelo real; se aceptaban costos negativos y abonos mayores al total | 🟠 Datos inservibles | ✅ Corregido |
| 10 | **Errores silenciosos y estadísticas incorrectas**: `cambiarEstado`/`delete` sin `try/catch` (fallo mudo si no hay red o permisos); "Reparados del mes" contaba por **fecha de ingreso** en vez de fecha de reparación, así que un equipo de enero entregado en marzo se contaba en enero | 🟡 Pérdida de confianza en los datos | ✅ Corregido |

**Otros defectos corregidos en el mismo paso:** `escapeHtml()` no escapaba comillas
(inyección de atributos) y se combinaba con `onclick="..."` construido por
concatenación; URL del QR hardcodeada a `techfix-tracker-9a128.web.app` (rompía en
dominio propio y en local); `window.open` sin `noopener` (reverse tabnabbing);
destello de tema claro al cargar en modo oscuro; `innerHTML +=` dentro de bucles;
buscador re-renderizando en cada tecla; dependencia de CDN con rango flotante
(`sweetalert2@11`); sin cabeceras de seguridad en hosting; sin `.gitignore` (había
un artefacto `.firebase/` versionado); `icon-512.jpg` huérfano de 421 KB.

---

## 🔧 10 cosas que se PODRÍAN MEJORAR

Estas no son bugs: son decisiones de arquitectura que hoy funcionan pero limitan
el crecimiento. Las tres primeras son las que más rinden.

1. **Mover las fotos a Firebase Storage.** Hoy la evidencia se guarda como base64
   dentro del documento. Firestore tiene un límite duro de **1 MiB por documento**,
   y —peor— cada `onSnapshot` vuelve a descargar *todas* las imágenes de *todas*
   las órdenes. Con 100 equipos con foto son varios MB por refresco. El bucket ya
   está configurado en el proyecto y sin usar. *(Mitigado: se añadió un bucle de
   compresión que garantiza quedar bajo el límite, pero la solución correcta es
   Storage.)*
2. **Paginación real** en lugar de `limit(500)` fijo. Carga incremental con
   `startAfter()` y scroll infinito, o filtro por rango de fechas.
3. **Probar las reglas de seguridad automáticamente** con el emulador de Firestore
   y `@firebase/rules-unit-testing`. Hoy `firestore.rules` está versionado y
   revisado, pero no ejercitado por el CI.
4. **Auto-hospedar las dependencias o firmarlas con SRI.** Se fijaron versiones
   exactas y se precachean, pero un CDN comprometido aún podría ejecutar código
   arbitrario en una página que maneja datos personales. Lo ideal:
   `app/vendor/` servido desde el propio origen y CSP `script-src 'self'`.
5. **No guardar el PIN en claro.** Opciones, de menor a mayor esfuerzo: borrarlo
   automáticamente al entregar el equipo; cifrarlo con una clave derivada de la
   contraseña del técnico; o no pedirlo y usar el modo de reparación del fabricante.
6. **Generar el QR en el navegador.** Hoy se construye con `api.qrserver.com`, lo
   que envía la URL de cada orden a un tercero y falla sin internet. Una librería
   local de ~5 KB lo resuelve. *(Mitigado: el ticket ahora imprime la URL como
   texto de respaldo si el QR no carga.)*
7. **Historial de estados (auditoría).** Solo se guarda el estado actual. Un
   subdocumento `historial` con `{estado, timestamp, usuario}` permitiría medir
   tiempos de reparación, detectar cuellos de botella y resolver disputas.
8. **Optimizar los binarios.** `icon-512.png` pesa 1 MB y `logo.jpg` 500 KB para
   mostrarse a 80×80. Convertidos a WebP y redimensionados serían ~30 KB en total,
   y hoy se precachean íntegros en el service worker.
9. **Gestión de usuarios y recuperación de contraseña.** No hay "olvidé mi
   contraseña", ni alta de usuarios, ni roles (dueño / técnico / recepción). Con
   `sendPasswordResetEmail` y custom claims se cubre con poco código.
10. **Borrado lógico y exportación.** "Borrar" es permanente e irreversible sobre
    un documento legal/contable. Una papelera (`archivado: true`) con purga a los
    N días, más exportación a CSV/PDF para la contabilidad, sería más seguro.

---

## 🔁 El ciclo de corrección

La corrección no se hizo "a ojo": primero se construyó un arnés que convirtiera
cada hallazgo en una comprobación ejecutable, y luego se iteró hasta dejarlo todo
en verde.

**Herramientas creadas**

- `tools/audit.mjs` — auditoría estática con 12 familias de comprobaciones
  (sincronía CSS↔JS, consultas sin filtro por `uid`, lectura de colecciones
  privadas desde páginas públicas, reglas abiertas, escapado, service worker,
  URLs hardcodeadas, fuga de listeners, tabnabbing, accesibilidad, higiene).
- `tests/` — 28 tests sobre `jsdom` con un **doble de Firestore en memoria**
  (consultas, `onSnapshot`, lotes atómicos) y de Auth y SweetAlert2, que ejecutan
  el `app.js` y el `status.js` reales.
- `dev/preview.html` — banco de pruebas visual de las tarjetas, sin credenciales.
- `.github/workflows/calidad.yml` — ejecuta las tres cosas en cada push y PR.

**Iteraciones**

| Ronda | Foco | Auditoría | Tests |
|-------|------|-----------|-------|
| 0 | Línea base (código original) | 14 errores, 12 avisos | 3 / 27 |
| 1 | Seguridad: reglas, índices, cabeceras HTTP, CSP | 14 → 11 errores | 3 / 27 |
| 2 | `app.js`: aislamiento por `uid`, espejo público, escapado, firma, validaciones, listeners | 11 → 6 errores | 3 → 21 / 27 |
| 3 | HTML, service worker, página pública, accesibilidad | 6 → 3 errores | 21 → 26 / 27 |
| 4 | CSS sincronizado con el JS | 3 → 3 errores | 26 → 27 / 28 |
| 5 | Falsos positivos de la propia auditoría y del test de XSS | 3 → 0 errores | 28 / 28 |
| 6 | Pulido: orden de `prepararCanvas`, migración de datos, manifest, limpieza | **0 errores, 0 avisos** | **28 / 28** |

Un detalle del ciclo que vale la pena: el test *"un cliente con comillas no rompe
el atributo de la tarjeta"* falló incluso con el código ya corregido. No era una
regresión — el test buscaba la cadena `onmouseover=` en el `innerHTML`, y el dato
hostil aparecía ahí legítimamente **como texto**. Se reescribió para comprobar la
propiedad real (que ningún elemento haya ganado un atributo `on*`), que es lo que
importa.

---

## ⚠️ Antes de desplegar

1. **Ejecuta la migración** con la app abierta y sesión iniciada, **antes** de
   publicar las reglas nuevas:
   ```js
   await TechFix.migrar()
   ```
   Rellena el `uid` que falte en órdenes antiguas (con las reglas nuevas quedarían
   inaccesibles para siempre) y crea el espejo `seguimiento` de cada una, para que
   los QR ya impresos sigan funcionando.
2. **Publica reglas e índices** — el workflow de GitHub solo despliega hosting:
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes
   ```
   Sin el índice compuesto (`uid` + `timestamp desc`) la lista no carga; la app
   detecta ese caso y lo avisa explícitamente.
3. **Rota el PIN de los equipos que estén hoy en el taller** si la base estuvo
   accesible públicamente. Los PIN ya expuestos deben considerarse comprometidos.
