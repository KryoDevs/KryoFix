# KryoFix — pruebas sin facturación

## Decisión actual

- Todavía no hay proveedor contratado/configurado.
- **Mensajes automáticos desactivados**, tanto en parámetros como en el workflow.
- El propietario eligió **seguir sin facturación**, manteniendo Spark.
- El workflow de despliegue cloud está deshabilitado en código; confirmar su
  ejecución manual no puede activar los jobs. Requiere nueva autorización y
  un cambio revisado para reactivarlo.
- No copiar datos de clientes, no migrar producción y no activar facturación automáticamente.

## Estado real

El propietario indicó el proyecto **`kryofix`**, registró su aplicación web y
compartió la configuración pública. Está guardada separadamente en
`config/staging.firebase.public.json`; no cambia el destino predeterminado de
producción ni activa servicios. El bucket indicado es
`kryofix.firebasestorage.app`; que figure en la configuración no demuestra que
Storage esté aprovisionado o sus permisos configurados.

**Todavía no se desplegó desde esta sesión ni se verificaron los recursos cloud.**
Este entorno no tiene autenticación administrativa de Firebase (`projects:list`
devolvió `Failed to authenticate`). La conexión GitHub permite guardar código y
ver CI, pero no permitió consultar las variables de Actions. La configuración
externa debe realizarla el propietario con permisos, sin compartir secretos por chat.

## Camino activo: emuladores, sin desplegar servicios facturables

El propietario confirmó que habilitó Authentication, creó un usuario de pruebas y
creó Firestore. La captura de Storage muestra **Spark** y la exigencia de actualizar
a Blaze. No se creó Storage ni se autorizó esa actualización. Se conservan el
proyecto `kryofix` y su configuración pública, sin pedir más credenciales.

**No hay más pasos en Firebase por ahora.** No pulsar «Actualizar proyecto»,
no vincular una tarjeta y no ejecutar los comandos cloud de las secciones de
referencia que siguen.

Las pruebas existentes utilizan `demo-kryofix`, con Auth, Firestore, Storage y
Functions emulados, datos ficticios y secretos de prueba. No necesitan activar
facturación de Firebase ni desplegar en `kryofix`:

```bash
npm ci
npm ci --prefix functions
npm run check
npm run test:rules
npm run test:backend
# Para la matriz de navegadores, instalar antes los motores de Playwright:
npx playwright install --with-deps chromium webkit
npm run test:browser
```

Se requieren Node compatible (22 recomendado) y Java 21 para los emuladores.
La instalación requiere red; GitHub Actions puede tener sus propias cuotas/costos
según el plan del repositorio. Estos comandos no ejecutan `firebase deploy`.

No equivale a un staging completo accesible por internet ni a una validación en
hardware físico. `npm run serve` por sí solo **no conecta la aplicación a los
emuladores**: no utilizarlo como supuesto modo aislado de pruebas, porque el
cliente conserva la configuración productiva predeterminada. Utilizar las suites
preparadas, que aíslan sus datos y dependencias.

## Referencia inactiva: futuro cloud, solo con nueva autorización

Las instrucciones siguientes quedan conservadas para una futura decisión de
habilitar servicios cloud. **No ejecutarlas bajo la decisión actual.**

## Preparación posterior en Firebase

- Aplicación **web** registrada por el propietario; configuración pública recibida.
- Habilitar Auth por correo/contraseña con un usuario de prueba, sin reutilizar
  credenciales reales de clientes.
- Crear Firestore y Storage en modo protegido. No usar reglas abiertas de prueba.
- Las funciones del repositorio usan `us-central1`; decidir ubicaciones compatibles
  según los requisitos del proyecto antes de aprovisionar datos.
- Bucket privado, acceso uniforme, sin IAM `allUsers`/`allAuthenticatedUsers`.
  Para este staging usar un nombre que empiece por `<ID_STAGING>.` o `<ID_STAGING>-`.
- No importar la base de producción. Usar exclusivamente fixtures/datos ficticios.

## Configurar GitHub de forma segura

Crear el environment **staging** en Settings → Environments; activar revisión de
despliegue si el plan de GitHub lo permite. Añadir sus variables:

| Variable | Valor |
|---|---|
| `KRYOFIX_STAGING_PROJECT_ID` | `kryofix` |
| `KRYOFIX_STAGING_WEB_CONFIG` | Contenido de `config/staging.firebase.public.json` (solo JSON público) |
| `KRYOFIX_STAGING_STORAGE_BUCKET` | `kryofix.firebasestorage.app` (verificar antes su creación y privacidad) |

Añadir como **secret**, nunca como variable, `FIREBASE_SERVICE_ACCOUNT_STAGING`:
cuenta dedicada `deploy-staging@<ID_STAGING>.iam.gserviceaccount.com`, perteneciente
al proyecto nuevo. Limitar sus permisos al staging y a las operaciones necesarias.
No copiar el secreto `FIREBASE_SERVICE_ACCOUNT_TECHFIX_TRACKER_9A128`.

Los controles previos rechazan:

- Proyecto productivo `techfix-tracker-9a128`.
- Proyecto web distinto al destino o dominio Auth de otro proyecto.
- Bucket ajeno/incompatible y cuentas de servicio de otro proyecto.
- Configuración privada accidental dentro del archivo web público.
- Proveedor configurado o `HABILITAR_ENVIOS=true` en este staging sin proveedor.

La verificación de identidad de la cuenta no imprime su contenido. No demuestra
por sí sola que sus permisos IAM sean suficientes: eso se comprueba al desplegar.

## Secretos de Functions sin contratar proveedor

El código declara `WEBHOOK_SECRET` y `PROVEEDOR_TOKEN`; deben existir en Secret
Manager aunque no se envíen mensajes. En staging pueden generarse valores aleatorios
exclusivos, no credenciales de un proveedor. No reutilizar los valores demo de los
emuladores ni los secretos productivos.

Si el propietario dispone de una terminal autenticada y ya autorizó los recursos:

```bash
# Autenticación en TU terminal; no compartir el resultado ni credenciales.
npx firebase login
export FIREBASE_PROJECT_ID='<ID_STAGING>'

# Genera y transmite cada valor sin imprimirlo ni guardarlo en Git.
node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('hex'))" \
  | npx firebase functions:secrets:set WEBHOOK_SECRET --data-file - --project "$FIREBASE_PROJECT_ID"
node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('hex'))" \
  | npx firebase functions:secrets:set PROVEEDOR_TOKEN --data-file - --project "$FIREBASE_PROJECT_ID"
```

No ejecutar con el proyecto productivo. `PROVEEDOR_URL` permanece vacío y los
mensajes siguen desactivados; crear esos secretos no contrata ni conecta mensajería.

## Ejecutar cuando esté preparado

Workflow: **Staging cloud pausado (sin facturación)**, archivo
`.github/workflows/staging.yml`. Actualmente sus jobs están bloqueados. Si se
autoriza y revisa su reactivación en el futuro, requiere confirmación explícita y pasa primero toda
la verificación y utiliza únicamente las credenciales/variables de staging.

GitHub necesita que un workflow `workflow_dispatch` exista en la rama predeterminada
para poder lanzarlo manualmente. Este archivo está en la rama de trabajo; si todavía
no aparece «Run workflow», no significa que se haya desplegado. Debe incorporarse
primero el workflow o ejecutar el despliegue local autorizado de `DESPLIEGUE.md`.
No se integró esta rama en main como parte de la preparación.

El workflow:

1. Ejecuta lint, pruebas de código, reglas, API/Storage y matriz de dispositivos.
2. Valida destinos antes de usar credenciales.
3. Verifica que la cuenta es exclusiva del staging.
4. Publica reglas, índices, Storage, Functions y Hosting **solo en ese proyecto**.
5. Comprueba que `/api/capacidades` devuelve 401 sin sesión.
6. Muestra la URL `https://<ID_STAGING>.web.app` en el resumen del job.

No reemplaza las pruebas de aceptación con sesión real ni las de teléfono/tablet
físicos. Seguir el checklist de [DESPLIEGUE.md](DESPLIEGUE.md). Mantener
`KRYOFIX_BACKEND_READY` productivo sin habilitar hasta concluir esa validación.
