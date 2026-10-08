# KryoFix — activación y validación externa

**Edición elegida para el taller: Spark.** La guía activa es
[PUBLICAR-SPARK.md](PUBLICAR-SPARK.md), con paquete limitado a Hosting y Firestore.
Este documento conserva instrucciones de backend opcional que **no deben
aplicarse** a la edición sin facturación.

**Este documento no es evidencia de un despliegue realizado.** El código se prueba
contra emuladores y navegadores en CI. No se activaron servicios facturables, no se
migraron datos productivos ni se enviaron mensajes a clientes durante esta sesión.

Decisión actual: **seguir sin facturación (Spark), sin proveedor y con envíos
apagados**. Las pruebas continúan en emuladores; el workflow cloud de staging
queda deshabilitado. Ver [STAGING.md](STAGING.md). Las instrucciones cloud de
este documento son referencia futura, **no autorización para ejecutarlas**.

## 1. Preparar un entorno de pruebas separado

- Proyecto Firebase de **staging**, distinto de `techfix-tracker-9a128`.
- Auth por correo/contraseña, Firestore, Hosting y bucket privado.
- Functions de segunda generación / Scheduler requieren el plan y facturación
  correspondientes. El propietario debe autorizar esa contratación.
- Habilitar APIs y asignar permisos mínimos al desplegador y a la cuenta de
  ejecución: Functions/Run/Eventarc, Scheduler/PubSub, Firestore, Storage y acceso
  a los secretos concretos. No conceder Owner como solución genérica.
- Bucket con acceso uniforme y sin concesiones a `allUsers` o
  `allAuthenticatedUsers`. Las reglas `storage.rules` niegan acceso directo: solo
  la API Admin autenticada lee/escribe después de verificar el dueño de la orden.
- Configurar dominios autorizados de Auth y restricciones adecuadas de la API key
  web. Esa configuración web es pública; **no es una cuenta de servicio**.

Preparar configuración pública (variables de entorno o gestor de configuración,
no credenciales pegadas en el chat):

```bash
npm ci
npm ci --prefix functions
# FIREBASE_WEB_CONFIG = JSON de la configuración de la aplicación WEB de staging
# ENTORNO_STAGING=true impide apuntar accidentalmente al proyecto productivo
node tools/configurar-entorno.mjs
# FIREBASE_PROJECT_ID, STORAGE_BUCKET_PRIVADO; HABILITAR_ENVIOS=false inicialmente
node tools/configurar-backend.mjs
```

`configurar-entorno.mjs` genera `app/entorno.js` y ajusta el dominio de frames de
la CSP. App y portal QR usan el mismo entorno. No subir una configuración temporal
de staging como configuración productiva. `configurar-backend.mjs` solo escribe
parámetros no secretos en `functions/.env.<proyecto>` (excluido de Git).

## 2. Secretos y mensajería

Crear `WEBHOOK_SECRET` (aleatorio, al menos 32 caracteres) y `PROVEEDOR_TOKEN` en
Secret Manager mediante Firebase CLI o consola. No incluirlos en JavaScript web,
Git, registros, capturas ni conversaciones. Las claves de prueba generadas por
`tools/preparar-emuladores.mjs` **solo sirven para emuladores demo**.

La integración implementada es un **contrato HTTP para un proveedor/adaptador**.
No se afirma que cualquier URL de Meta, Twilio u otro proveedor acepte este formato.
La selección del proveedor y, si corresponde, su adaptador comercial siguen siendo
una decisión externa necesaria. No hay un proveedor contratado/configurado aquí.

### Contrato de envío

`PROVEEDOR_URL` debe ser HTTPS, no redirigir y aceptar:

```text
POST /ruta-del-adaptador
Authorization: Bearer <PROVEEDOR_TOKEN>
Content-Type: application/json
Idempotency-Key: <clave-estable>

{"idempotencyKey":"...","telefono":"569...","mensaje":"KryoFix: ..."}
```

Respuesta exitosa: `{"id":"identificador-estable-del-proveedor"}`.
El adaptador **debe deduplicar** la misma clave, incluido un reintento tras timeout.
Sin esa garantía no activar reintentos automáticos: podrían duplicar mensajes.
Para WhatsApp, usar una API oficial y respetar consentimiento, plantillas aprobadas,
ventanas de conversación y políticas del proveedor; no automatizar WhatsApp Web.

### Confirmación de entrega

POST JSON a `/api/confirmacion-mensaje`:

```json
{"id":"clave-estable","proveedorId":"identificador-del-proveedor","estado":"entregado"}
```

También se acepta `fallido`. Cabecera `X-KryoFix-Signature`: HMAC-SHA256 hexadecimal
del **cuerpo crudo exacto**, usando `WEBHOOK_SECRET`. No es un endpoint público sin
firma. Un callback temprano puede confirmar una solicitud cuya respuesta HTTP se
perdió; una respuesta tardía del worker no degrada `entregado` a `aceptado`.

- `HABILITAR_ENVIOS=false` por defecto. La cola puede existir, pero no se envía nada.
- El worker revisa consentimiento, teléfono y estado actual antes de reclamar el
  mensaje. Cambio de situación o revocación cancela pendientes.
- Revocar permiso no puede deshacer un mensaje que ya está en tránsito.
- Lease transaccional, máximo cinco intentos y backoff. Agotados los intentos sin
  confirmación pasa a `revision-manual`, no se afirma falsamente que no se entregó.
- `aceptado` significa aceptado por proveedor, **no entregado**.
- Los cambios futuros de estado/presupuesto/garantía generan avisos con permiso
  vigente cuando están habilitados. No se envían masivamente recordatorios
  históricos al activar el servicio. La ficha permite programar un mensaje.

## 3. Publicar primero en staging

Con autenticación administrativa local/CI autorizada, no mediante la sesión de un
cliente del navegador:

```bash
npx firebase deploy --project <ID-STAGING> \
  --only firestore:rules,firestore:indexes,storage,functions:kryofix,hosting
```

Esperar a que terminen los índices y comprobar los endpoints. Functions usa
`us-central1`; Hosting llama a `/api/*` en el mismo origen. No introducir URLs
`localhost` en el cliente para comunicarse con el backend desplegado.

Los workflows productivos no se desbloquean hasta configurar y validar lo anterior:

- Variable `KRYOFIX_BACKEND_READY=true`, **solo después de revisar staging**.
- `KRYOFIX_STORAGE_BUCKET`: nombre del bucket privado productivo.
- `KRYOFIX_PROVEEDOR_URL`: URL del adaptador compatible (si se activa mensajería).
- `KRYOFIX_HABILITAR_ENVIOS`: `false` hasta concluir pruebas/consentimientos.
- Secretos de Functions ya configurados en el proyecto destino.
- La cuenta de servicio existente de GitHub debe tener los permisos necesarios.

El workflow de main publica backend/reglas/índices antes de Hosting. El preview de
PR comparte el backend del proyecto configurado; **no es un staging aislado** y no
se debe usar para experimentar con datos reales. Permanece deshabilitado hasta la
confirmación de compatibilidad del backend.

## 4. Evidencias, firmas y retención

- Nuevos archivos se guardan primero con la orden y se archivan automáticamente
  cuando está configurado el backend. El trigger del servidor no depende de que el
  técnico mantenga el navegador abierto. La UI también intenta la migración.
- Se verifica SHA-256 leyendo la copia de Storage antes de retirar el base64 de
  Firestore. Un fallo conserva el original. Los reintentos del mismo contenido no
  crean copias con nombres aleatorios nuevos.
- Las órdenes anteriores se migran explícitamente desde **Ficha → Evidencias**.
  No se ejecutó una migración masiva. Respaldar y verificar un lote pequeño antes
  de ampliar. La migración puede requerir revisión de archivos antiguos malformados.
- Descarga solo por POST autenticado; sin download tokens ni enlaces permanentes.
  La API y sus respuestas nunca entran en el caché del service worker.
- Retención predeterminada: indefinida. Confirmación explícita de 90–3650 días
  desde hoy por orden; no se presupone cuál es el plazo legal del taller.
- El job diario recorre hasta 500 órdenes y conserva cursor. La fecha es de
  elegibilidad: no se promete borrado instantáneo al vencer en talleres grandes.
- Una eliminación en curso bloquea extender o reemplazar ese archivo. Queda un
  evento de auditoría y la indicación de borrado en la ficha.
- Revisar copias sin referencia tras fallos/conflictos de migración: la seguridad
  prioriza conservar el original y no elimina automáticamente objetos huérfanos.
  No borrar objetos de Storage indiscriminadamente.

## 5. Checklist de aceptación externa

- [ ] Auth real: técnico propio/ajeno, cierre de sesión y dos sesiones concurrentes.
- [ ] Creación de orden, presupuesto, autorización manual/por enlace, pago/reverso,
      consumo de repuesto y entrega con firma.
- [ ] Enlace vencido/revocado, nueva versión y segundo intento de decisión.
- [ ] Bucket privado: lecturas anónimas y del SDK cliente rechazadas; lectura por
      API propia correcta; cuenta ajena rechazada.
- [ ] Migración de una foto y firma reales: comparar archivo y respaldo antes/después.
- [ ] Ensayar retención con fixture de staging, no acortando la política productiva.
- [ ] Proveedor real: deduplicación, timeout, callback firmado, rechazo, revocación y
      cambio de teléfono. Enviar solo a un destinatario de prueba autorizado.
- [ ] Android/iPhone/iPad físicos: cámara, galería, teclado virtual, firma con dedo/
      lápiz, rotación, zoom, impresión y PWA instalada. La emulación no los sustituye.
- [ ] Restauración de respaldo y procedimiento de rollback. No mezclar clientes
      viejos con reglas nuevas sin coordinar actualización/recarga.
- [ ] Revisar los nueve avisos restantes de herramientas de desarrollo. El backend
      tiene cero avisos conocidos en el audit ejecutado, no una garantía absoluta.

Las métricas de servidor proyectan solo campos financieros/de estado, sin cargar
fotos/firmas, y usan un corte transaccional consistente y la zona
`America/Santiago`. Límite explícito: 5000 órdenes / 10000 pagos por cuenta. Si se
supera, se rechaza el informe en vez de presentar cifras parciales como completas;
se necesita una estrategia incremental para ese volumen.
