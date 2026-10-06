# Preparar KryoFix Staging — sin proveedor y sin mensajes

## Decisión actual

- Todavía no hay proveedor contratado/configurado.
- **Mensajes automáticos desactivados**, tanto en parámetros como en el workflow.
- Preparar un proyecto de pruebas distinto de producción.
- No copiar datos de clientes, no migrar producción y no activar facturación automáticamente.

## Estado real

La configuración y el workflow están preparados en el repositorio. **No se creó ni
se desplegó un proyecto Firebase de staging**: este entorno no tiene autenticación
administrativa de Firebase (`projects:list` devuelve `Failed to authenticate`).
La conexión GitHub permite guardar código/ejecutar CI, pero no permitió consultar
las variables de Actions (`Resource not accessible by integration`). La configuración
externa debe realizarla el propietario con permisos, sin compartir secretos por chat.

## Próximo paso del propietario

1. Entrar en [Firebase Console](https://console.firebase.google.com/) y crear un
   proyecto **nuevo**, por ejemplo `kryofix-staging-9a128` si ese ID está disponible.
   El nombre sugerido no está reservado ni se comprobó su disponibilidad.
2. Compartir **solo el ID del proyecto** para continuar. No enviar contraseñas,
   tokens, claves privadas ni JSON de cuentas de servicio.
3. Revisar/autorizar aparte el plan y los posibles costos de Functions, Storage y
   Scheduler antes de desplegar. Si no se autoriza facturación, conservar las
   pruebas en emuladores: no declarar disponibles los servicios cloud.

## Preparación posterior en Firebase

- Crear una aplicación **web** de staging y copiar su configuración pública completa.
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
| `KRYOFIX_STAGING_PROJECT_ID` | ID del proyecto nuevo |
| `KRYOFIX_STAGING_WEB_CONFIG` | JSON de configuración **web pública**, no de cuenta de servicio |
| `KRYOFIX_STAGING_STORAGE_BUCKET` | Bucket privado del proyecto de pruebas; coincide con el de la configuración web |

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

Workflow: **Staging aislado (manual, sin mensajes)**, archivo
`.github/workflows/staging.yml`. Requiere confirmación explícita, pasa primero toda
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
