# KryoFix — resultado del LOOP de implementación y validación

Fecha: **6 de octubre de 2026**. Código en la rama de trabajo, sin integración en
main, despliegue, migración productiva ni mensajes enviados a clientes.

## Estado comprobado

| Capa | Resultado |
|---|---|
| ESLint + auditoría estática | Correctos |
| Pruebas de código, UI y motor de backend | **160 aprobadas** |
| Matriz Node 20.19 / 22 | **160 aprobadas en Node 20.19 y Node 22** |
| Firestore Emulator | **10 escenarios aprobados en CI** |
| API + Auth + Functions + Storage emulados | **4 escenarios end-to-end aprobados en CI** |
| Chromium + WebKit | **75 aprobadas + 30 repeticiones WebKit aprobadas** |
| Audit del backend desplegable | **0 avisos conocidos** |
| Audit de herramientas raíz | **9 avisos: 7 altos, 2 moderados; 0 críticos** |
| Proyecto de staging, proveedor real y dispositivos físicos | **Pendientes de configuración/validación externa** |

CI completo del ciclo corregido: [37487712261](https://github.com/KryoDevs/TechFix-Tracker/actions/runs/37487712261).
Incluye API/Auth/Storage, matriz de cinco perfiles y dos repeticiones adicionales
de WebKit: **105 ejecuciones de navegador aprobadas** en total.

Antes de ese resultado hubo ciclos fallidos: la aprobación anterior de la matriz
no bastó para descartar una carrera de arranque de WebKit. Se localizó el aviso
modal de actualización que interceptaba los controles, se corrigió el ciclo de
vida del worker y se volvió a ejecutar todo, sin ocultar fallos mediante retries.
La matriz Chromium también se repitió localmente: **120 ejecuciones aprobadas**.
Se revisaron visualmente capturas de teléfono y tablet con datos ficticios.

## Pendientes funcionales implementados en esta continuación

### Compras, inventario y garantías

- Compras pendientes con proveedor, cantidad y costo; recepción completa crea un
  solo lote, cancelación no modifica stock. Reintentos idempotentes.
- Ajustes de entrada/salida y devolución al proveedor con motivo, versión observable
  de cantidades y diario inmutable. No se retiran unidades reservadas.
- Reglas validan deltas, operación nueva y vínculo con el lote. Casos adversarios
  contra emulador, no solo contra el servicio JavaScript.
- Garantía como nueva orden de retrabajo, numeración central y vínculo en ambos
  sentidos. No copia firma, pagos, PIN ni reservas; conserva la entrega original.

### Backend privado y aprobación externa

- API de Functions con verificación de ID token, dueño y entrada JSON acotada.
- Presupuesto por enlace de 256 bits, hash almacenado, caducidad de 48 horas,
  revocación al emitir otro y vínculo al desglose/versiones actuales.
- Decisión transaccional de un solo uso, reintento de la misma decisión y diario.
  No se presenta la posesión de un enlace como identidad legal o firma avanzada.
- Página pública sin datos personales privados, renderizado con texto y sin XSS.
- Storage privado: copia verificada antes de retirar base64, acceso autenticado y
  archivo automático de nuevas imágenes cuando el backend está configurado.
- Retención explícita, job con cursor, exclusión durante borrado y auditoría. No se
  borran archivos por defecto ni se realizó migración masiva.
- Informe transaccional del servidor, zona Santiago, límite declarado de volumen.
  La consulta proyecta solo los campos necesarios: no carga fotos/firmas para sumar.

### Mensajería

- Consentimiento/revocación por teléfono, cola idempotente, comprobación de estado,
  lease, reintentos con backoff y estados distintos de aceptación/entrega.
- Generación de avisos por cambios futuros y programación explícita desde la ficha.
- Callback HMAC autenticado. Respuesta perdida o callback temprano no degradan una
  entrega confirmada. Tras cinco intentos inciertos, revisión manual.
- **No hay proveedor contratado ni configurado.** El adaptador debe cumplir el
  contrato de `DESPLIEGUE.md`; no se afirma integración directa lista con Meta o
  Twilio ni se envían mensajes usando WhatsApp Web. Desactivado por defecto.

## Teléfonos y tablets

La matriz ejecuta **los mismos 15 casos** en:

| Perfil | Motor | Tamaño inicial |
|---|---|---|
| Computador | Chromium | 1280 × 900 |
| Teléfono táctil | Chromium | 390 × 844 |
| Tablet vertical | Chromium | 820 × 1180 |
| Tablet horizontal | Chromium | 1180 × 820 |
| Tablet tipo Safari | WebKit | 820 × 1180 |

Incluye diagnóstico, presupuesto/autorización/pagos/reversos, conflictos de
borrador, compras/devoluciones, garantías, firma táctil simulada con rotación,
selección/compresión de foto, viewport reducido como al abrir teclado, contraste
básico oscuro, aprobación pública y rechazo de enlaces inválidos. También se
conserva el caso a 360 px. Objetivos táctiles de al menos 44 px y fuente de campos
16 px en pantallas táctiles; el zoom no está bloqueado.

**Límite de la evidencia:** son navegadores reales con perfiles emulados, no
Android/iOS físicos. Los flujos autenticados del navegador usan un doble aislado de
Firestore; API/Auth/Storage se verifican por separado contra emuladores reales.
El teclado virtual, la cámara física, Apple Pencil, impresión y PWA instalada deben
probarse en hardware. No es una certificación completa de accesibilidad WCAG.

## Errores encontrados y corregidos durante el LOOP

| Hallazgo | Corrección / regresión |
|---|---|
| Pruebas antiguas emitían eventos de mouse al migrar la firma a Pointer Events | Casos actualizados y cobertura de dedo/lápiz, segundo puntero y cancelación |
| Selector de confirmación de entrega no coincidía con el texto real | Selector exacto; nueva ejecución de la matriz completa |
| Un segundo dedo podía interferir con el trazo | Un único pointerId activo; limpieza/cancelación terminan el trazo |
| Respuesta de firma anterior podía cerrar otra orden abierta | Token de apertura, epoch de sesión y restauración de controles por diálogo |
| Inicialización síncrona de Auth accedía antes a variables de firma | Estado inicializado antes de registrar callbacks; suite completa repetida |
| Reintento de lote aceptaba distinto contenido silenciosamente | Huella de contenido y rechazo de ID reutilizado |
| Retención podía competir con reemplazo de archivo | Bloqueo durante eliminación y comprobación de identidad antes de marcar borrado |
| Presupuesto malformado podía llegar al enlace | Validación de desglose, total y montos de la orden en el servidor |
| Callback del proveedor podía adelantarse a la respuesta del envío | Confirmación temprana y estados terminales protegidos; caso adicional de respuesta perdida |
| Arranque PWA / WebKit | Falsa actualización en primera instalación podía bloquear botones | Banner no modal, detección de reemplazo real, actualización explícita y protección de borradores; regresiones de arranque |
| Enlace tardío | Respuesta tras reiniciar sesión podía abrir un modal viejo | Token de ficha comprobado antes de mostrar el enlace |
| API privada del mismo origen podía entrar en estrategia genérica del SW | Exclusión explícita de `/api/`; prueba de no interceptación |

No existe un LOOP infinito autónomo. Se repitieron cambios, pruebas, revisión y
corrección; los fallos no se ocultaron ni se marcaron como aprobados.

## Activación y límites restantes

Ver [DESPLIEGUE.md](DESPLIEGUE.md): proyecto aislado, bucket/IAM, secretos, proveedor,
consentimientos, pruebas físicas y puerta de publicación. Los workflows bloquean
Hosting hasta confirmar configuración compatible mediante `KRYOFIX_BACKEND_READY`.

- Código y pruebas no equivalen a despliegue operativo. No se inventaron pruebas
  con credenciales reales o un proveedor externo.
- Se conservaron datos legados, IDs y QR. La migración masiva exige respaldo y
  verificación; las copias sin referencia tras conflictos requieren revisión.
- El catálogo de modelos/variantes no es una base exhaustiva de fabricantes. Las
  guías técnicas no sustituyen manuales de variante, formación ni diagnóstico físico.
- Compras: recepción completa por lote; no hay recepción parcial ni contabilidad fiscal.
- Métricas consistentes hasta los límites documentados; no se oculta un corte parcial.
- Quedan avisos en herramientas Firebase CLI transitivas. No se forzaron versiones
  mayores incompatibles para obtener artificialmente un audit sin alertas.

## Repetir las verificaciones

```bash
npm ci
npm ci --prefix functions
npm run check
npm run test:rules       # Java 21; proyecto demo-kryofix
npm run test:backend     # Auth/Firestore/Storage/Functions, solo emuladores demo
npx playwright install --with-deps chromium webkit
npm run serve           # otra terminal; CI lo inicia automáticamente
npm run test:browser
npm audit
npm audit --prefix functions
```

`npm run check:full` enlaza las capas de pruebas. Secretos de emuladores, resultados,
binarios de navegador y dependencias no se versionan. No se pidieron contraseñas,
tokens o cuentas de servicio en el chat.


## Preparación posterior de staging (decisión del propietario)

Se eligió **sin proveedor por ahora** y **preparar un staging nuevo**. Se añadió
workflow manual aislado y controles para rechazar producción, bucket/dominio ajeno,
configuración privada en la web, cuenta de servicio incorrecta y envíos activos.

- Suite local actual: **172 pruebas aprobadas** (12 nuevas de configuración segura).
- La configuración externa/despliegue **no se ejecutó**: falta autenticación de
  Firebase; las variables de Actions no son accesibles a esta integración.
- `STAGING.md` detalla creación por el propietario y configuración segura. No se
  solicita ningún secreto en chat ni se reutiliza la cuenta productiva.
- El workflow nuevo no se presenta como ejecutado; requiere proyecto/secretos y
  disponibilidad de `workflow_dispatch` en la rama predeterminada.

## Edición Spark del taller — actualización actual

La adaptación gratuita está implementada en el código; sustituye el estado
anterior de «solo emuladores». No constituye una publicación real ya realizada.

- **181 pruebas locales** aprobadas (lint y auditoría estática incluidos).
- Se repite la suite de Firestore con las reglas Spark: **13 escenarios**, que
  incluyen UID exclusivo, límites de imágenes del lado del servidor y entrega
  completa tras autorización, pago y calidad, sin Functions.
- La primera pasada CI de esta adaptación aprobó Node, las 10 pruebas de reglas
  originales, las 13 Spark y las 4 integradas de backend opcional. Falló una
  prueba antigua de aprobación porque seguía esperando backend en modo Spark.
  Se corrigió el perfil de esa prueba y se añadió la comprobación explícita de
  que Spark rechaza incluso un enlace válido sin llamar `/api`.
- Matriz actual: **18 casos × 5 perfiles**, más repetición doble de WebKit.
  Se comprueba ausencia de llamadas `/api` en Spark; solo una prueba marcada
  explícitamente como backend opcional usa su API simulada.
- Paquete generado: `.spark/`, Hosting + Firestore únicamente. QR de respaldo
  corregido a `kryofix.web.app`; modo PWA permite orientación horizontal.
- Publicador local: pide UID (no contraseña) y autenticación Google por Firebase
  CLI; no activa billing ni despliega Functions/Storage. Se comprueba el perfil
  del paquete antes de intentar autenticar/desplegar.
- Copia JSON privada por orden con pagos/eventos; no reemplaza un respaldo global
  ni ofrece restauración automática. Datos sensibles deben guardarse protegidos.
- `firebase projects:list` sigue devolviendo falta de autenticación en este
  entorno. **No se publicó, no se probó el sitio real y no se migraron datos**.
- La CI del commit vigente se consulta en el PR #5. No interpretar los conteos de
  la matriz como evidencia de hardware físico ni del despliegue real.

Guía activa y entrega para el propietario: `PUBLICAR-SPARK.md`.
