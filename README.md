# TechFix Tracker Pro

PWA de gestión para servicio técnico de equipos y smartphones: ingreso de equipos,
seguimiento de estados, catálogo de precios, firma digital de conformidad, ticket
imprimible con QR y página pública de seguimiento para el cliente.

Stack: HTML/CSS/JavaScript sin bundler + Firebase (Auth, Firestore, Hosting).

---

## Estructura

```
app/                 Lo que se publica en Firebase Hosting
  index.html         Aplicación del técnico (login + taller + catálogo)
  app.js             Lógica principal
  tema.js            Aplica el tema guardado antes del primer pintado
  status.html/.js    Página pública de seguimiento (la que abre el QR)
  sw.js              Service worker (offline)
  estilos.css        Estilos (sus clases deben coincidir con las de app.js)
  ticket-qr.png      QR de respaldo del ticket (generado, no depende de terceros)
  vendor/            Dependencias de ejecución servidas desde el propio origen
                     (ver app/vendor/README.md)
firestore.rules      Reglas de seguridad  <-- deben desplegarse a mano
firestore.indexes.json
dev/preview.html     Banco de pruebas visual (no se despliega)
tools/audit.mjs      Auditoría estática de seguridad y regresiones
tools/vendor.mjs     Copia app/vendor/ desde node_modules (versiones fijadas)
tools/generar-qr.mjs Genera app/ticket-qr.png
tests/               Tests con jsdom y un doble de Firebase en memoria
ANALISIS.md          Informes de auditoría y su resolución
```

## Modelo de datos

| Colección     | Visibilidad                   | Contenido                                            |
|---------------|-------------------------------|------------------------------------------------------|
| `equipos`     | **Privada**, solo el dueño    | Orden completa: cliente, teléfono, IMEI, PIN, foto, firma, historial |
| `catalogo`    | **Privada**, solo el dueño    | Precios de reparación del técnico                     |
| `seguimiento` | **Pública (solo lectura)**    | Espejo mínimo: `uid`, `estado`, `modelo`, `actualizado` |

`seguimiento` existe para que la página del QR no necesite acceso a los datos
personales. Las reglas limitan el documento a esas cuatro claves, así que es
imposible publicar por error un teléfono o un PIN.

Campos destacados de una orden: `idOrden` (`TF-251002-001`, legible para dictar
por teléfono), `fecha` (ISO 8601), `fechaReparacion`, `fechaEntrega`,
`historial` (`[{estado, en, por}]`) y `evidencia`/`firmaCliente` (base64).

## Desarrollo

```bash
npm install          # dependencias de desarrollo (eslint, jsdom, firebase, …)
npm run serve        # sirve app/ en http://localhost:8080  (vista previa en vivo)
npm run serve:dev    # sirve la raíz; abre /dev/preview.html para ver los componentes
npm run check        # lint + auditoría estática + tests  (lo mismo que corre el CI)

npm run vendor       # recalcula app/vendor/ desde las versiones fijadas
npm run qr           # regenera app/ticket-qr.png (usa el dominio de producción)
npm run assets       # vendor + qr, tras actualizar dependencias o el dominio
```

`npm run check` es la verificación completa: lint, auditoría estática y 75 tests.
La auditoría falla si reaparece alguno de los problemas documentados en
`ANALISIS.md` (consultas sin filtro por `uid`, clases CSS huérfanas, service
worker sin `skipWaiting`, archivos no UTF-8, dependencias por CDN, CSP con
`unsafe-inline`, QR generado por terceros, etc.).

### Dependencias de ejecución

Las librerías de runtime (Firebase 10.8.1 compat, SweetAlert2 11.14.5 y
qrcode-generator 2.0.4) **se versionan dentro de `app/vendor/`**, no se cargan de
un CDN. Las mismas versiones están como `devDependencies` fijadas solo para poder
copiarlas de forma reproducible con `npm run vendor`. Para subir una versión:
cambiar la versión exacta en `package.json`, `npm install`, `npm run vendor`,
actualizar `VERSION` en `app/sw.js` y subir el número si los archivos son fijos
en algún HTML.

## Despliegue

El hosting se publica solo con GitHub Actions (preview en cada PR, producción al
mergear a `main`). Antes de mergear, el workflow **Calidad** tiene que estar verde:
el deploy de hosting es independiente y publicaría igual.

**Las reglas e índices de Firestore NO se despliegan con ese workflow** y hay que
publicarlos manualmente:

```bash
firebase deploy --only firestore:rules,firestore:indexes
```

El índice compuesto (`uid` + `timestamp desc`) es obligatorio: sin él la lista de
equipos no carga y la app muestra el aviso correspondiente.

### Migración desde la versión anterior (una sola vez)

Los datos creados antes de la revisión no tienen espejo de `seguimiento`, y
algunos pueden no tener `uid`. Con las reglas nuevas quedarían inaccesibles.

> Hazlo **antes** de desplegar `firestore.rules`, con sesión iniciada en la app,
> desde la consola del navegador:

```js
await TechFix.migrar()
```

Esto rellena el `uid` que falte y crea el espejo público de cada orden, de modo
que los códigos QR ya impresos siguen funcionando. Después, despliega las reglas.

### Seguridad del hosting

`firebase.json` define la CSP (`script-src 'self'`, sin `unsafe-inline`), HSTS,
`X-Content-Type-Options`, `X-Frame-Options` y `Referrer-Policy`. Al no haber
scripts de terceros, cualquier servicio externo nuevo obliga a modificar la CSP
de forma explícita: es intencional.

## Variables y secretos

La `apiKey` de Firebase que aparece en el código **no es un secreto**: identifica
el proyecto y está pensada para ser pública. La protección real son
`firestore.rules`. El único secreto del repositorio es
`FIREBASE_SERVICE_ACCOUNT_TECHFIX_TRACKER_9A128`, almacenado en GitHub Actions.
