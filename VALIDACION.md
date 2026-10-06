# KryoFix — Implementación y ciclo de validación

Fecha: 6 de octubre de 2026. Rama de trabajo de Arena; **sin despliegue ni migración de producción**.

## Resultado comprobado

| Verificación | Resultado |
|---|---|
| ESLint | Correcto |
| Auditoría estática del repositorio | Correcta |
| Pruebas locales de dominio, UI y doble de Firestore | **136 aprobadas, 0 fallidas** |
| Playwright en Chromium real | **8 aprobadas, 0 fallidas** |
| Diferencias de Git / whitespace | `git diff --check` limpio |
| Reglas y transacciones en Firestore Emulator | **Bloqueado; no ejecutado** |
| Firebase real / Auth real / staging | **No verificado** |
| Despliegue o migración de datos reales | **No realizado** |
| `npm audit` completo | **11 avisos: 7 altos y 4 moderados; 0 críticos** |

No se afirma «todo terminado», «sin errores posibles» o «sin vulnerabilidades».
Las pruebas que pasan cubren escenarios definidos; no prueban todos los estados
posibles, no certifican una reparación física y no reemplazan la validación con
Firestore real y datos legados.

## Qué quedó implementado

### Confiabilidad y arquitectura

- Borradores de procedimiento independientes del DOM, con apertura/foco conservados.
- Comparación de versión y guardado transaccional de procedimientos.
- Servicio de casos de uso para estados, edición, pagos, presupuestos, entrega,
  inventario y seguimiento. Revisión de orden y eventos en la misma transacción.
- IDs de operación, hash SHA-256 de solicitud y reintentos idempotentes para
  operaciones de orden. Mismo ID con contenido diferente es rechazado.
- Numeración central por usuario y reintento de ingreso en sesión con ID conservado.
- Fecha confirmada por servidor para eventos y nuevos pagos; apertura legada sin
  fecha inventada. Indicadores separan presupuesto, saldo y cobros registrados.
- Reglas nuevas para pertenencia, revisión/transiciones, espejo vinculado,
  diario inmutable y reversos. **Pendientes de ejecutar contra emulador.**
- Migración peligrosa de adopción de órdenes desde consola bloqueada.
- SDK Firebase actualizado a 12.19.0; vendor regenerado y SW v13.

### Operación y diseño

- Ficha privada con secciones, enlace privado por ID, navegación por teclado,
  controles accesibles, diseño móvil y temas claro/oscuro.
- Próxima acción por orden y acciones secundarias agrupadas.
- Diagnóstico que distingue síntoma, riesgo, prueba, hipótesis y causa confirmada.
- Control de calidad y excepciones justificadas. Una prueba fallida o presupuesto
  invalidado devuelve a revisión una reparación que estaba lista.
- Plantillas propias versionadas, fuente/manual, copia por orden y confirmación
  para reemplazar el procedimiento y reiniciar los pasos.
- Presupuesto desglosado con total calculado y aprobación manual por versión.
- Pagos/reversos, abonos de apertura, bloqueo de sobrescritura del acumulado.
- Entrega con firma, calidad/autorización y motivo para deuda pendiente. Captura
  revisión al abrir la firma para impedir cobros sobre un resumen obsoleto.
- Agenda creada en recepciones nuevas y selección explícita de cliente recurrente.
- Lotes de repuestos, costo/proveedor/variante, reserva, consumo y liberación.
- Seguimiento de garantía sin reabrir la entrega original, con copias en eventos.
- Mensajes de WhatsApp preparados y registro manual del resultado de contacto.
- Historial paginado e informes bajo demanda más allá de las 500 órdenes del tablero.

## LOOP realizado: detectar → corregir → volver a probar

| Ciclo / área | Hallazgo | Corrección y regresión |
|---|---|---|
| Integración | Test antiguo esperaba numeración local `TF-…` en ingresos nuevos | Nueva numeración `KRF-…`; se conserva la histórica sin renombrar documentos ni QR |
| Formularios | Asignar `type` a un `textarea` provocaba excepción y ocultaba el formulario | Tipo solo en inputs; prueba de apertura/guardado de diagnóstico |
| Selectores | Una opción inicial vacía impedía autorizar correctamente un presupuesto | Valor inicial válido; flujo navegador presupuesto → aprobación → pago |
| Modal nativo | SweetAlert se dibujaba detrás de `<dialog>` y bloqueaba confirmación | Confirmaciones dentro del diálogo activo; prueba móvil de cancelar descarte |
| Accesibilidad | IDs de campos repetidos en formularios de pago/reverso | Identificadores únicos y etiquetas asociadas |
| Navegación | Riesgo de perder cambios de otro formulario en una sección | Bloqueo hasta guardar/descartar los cambios de ese formulario |
| Concurrencia | Resumen de firma podía quedar obsoleto al recibir otro pago | Revisión capturada al abrir; entrega rechazada si hubo cambios |
| Recepción | Reintento incierto podía crear otra orden con nuevo ID | Nonce de ingreso por sesión y hash del contenido; revisión de historial si cambia |
| Sesión | Imagen o ingreso tardío podía actualizar UI tras cerrar sesión | Token de selección, época de sesión y limpieza de modales/borradores |
| Fotografías | Era posible guardar antes de terminar la compresión | Espera explícita; callbacks obsoletos no repueblan evidencia privada |
| Control final | Cambios de calidad o autorización podían dejar una orden inválida como lista | Vuelta automática a revisión y actualización del espejo |
| Dinero | Fecha del equipo podía confundirse con fecha de cobro | Ledger separado, fecha confirmada y apertura sin fecha ficticia |
| Dependencias | SDK antiguo y versiones transitivas afectadas | Firebase 12.19.0, gRPC 1.14.5 y undici 6.29.0; quedan alertas de herramientas |
| Entorno de navegador | No se podía descargar Chromium por los hosts habituales y faltaban librerías | Binario y librerías temporales fuera del repo; se ejecutaron las 8 pruebas reales |

El LOOP no es un proceso infinito en segundo plano ni un script que modifica código
sin revisión. Se repitieron implementación, pruebas, inspección del error y
corrección, y se volvió a ejecutar la suite completa después de los cambios.

## Alcance de las pruebas de navegador

1. Ficha de diagnóstico, riesgo y guardado sin errores JavaScript.
2. Presupuesto → autorización → pago → reverso, conservando trazabilidad.
3. Vista de 360 px, teclado, sin desbordamiento y descarte cancelable.
4. Borrador ante cambio ajeno y conflicto del procedimiento.
5. Inventario, gestión e informe paginado.
6. Creación de plantilla y aplicación con confirmación.
7. Arranque del SDK Firebase empaquetado y login, sin credenciales reales.
8. Contraste básico de texto/fondo de la ficha en tema oscuro (>4,5:1).

Los flujos autenticados usan un doble de Firebase **dentro de un navegador real**,
no una conexión al proyecto productivo. La prueba del SDK real bloquea APIs externas.
El contraste de una ficha no equivale a una auditoría WCAG completa de toda la app.

## Bloqueo del emulador y protección del despliegue

Se intentó `npm run test:rules`. Falló antes de levantar Firestore:

```
Could not spawn `java -version`.
Please make sure Java is installed and on your system PATH.
```

No había Java instalado. La descarga desde repositorios del sistema y desde el host
del emulador no estaba disponible en este entorno. No se reemplazó esa prueba por
un falso resultado correcto ni se omitió silenciosamente del comando completo.

Se incorporó `tests/emulator/seguridad.test.mjs` para comprobar:

- lectura propia, ajena, anónima y rechazo del listado público;
- montos inválidos, suplantación y escrituras sin evento/revisión;
- creación atómica de correlativo, cliente y espejo público;
- pago, reverso y diario inmutable;
- procedimiento legado, conflicto y orden entregada;
- competencia por la última unidad de stock.

`.github/workflows/verificacion.yml` instala Java 21 y Chromium en el runner y
exige la ejecución real de estas capas. Los despliegues dependen de ese workflow.
**Aún no se ha ejecutado ni confirmado un resultado de CI para esta revisión.**
Si allí aparece un error de compilación de reglas, permisos, índice o transacción,
debe corregirse y repetirse la suite; no publicar saltándose el requisito.

Al integrar en `main`, el workflow está preparado para publicar reglas/índices
antes del hosting, usando la cuenta de servicio existente. Necesita permisos
suficientes y una ventana de actualización de clientes. El preview de PR no toca
las reglas de producción.

## Dependencias: pendientes reales

El `npm audit` final reporta 11 avisos transitivos (7 altos, 4 moderados), en la
cadena de herramientas de Firebase CLI, con causas en `braces`, `basic-ftp`,
`@opentelemetry/core` y `uuid` y sus dependientes. No se afirma que sean inocuos.

- Se corrigió la dependencia gRPC del SDK y undici del CLI con versiones fijadas.
- No se aplicó el downgrade forzado de Firebase sugerido por el resolvedor.
- No se cambiaron indiscriminadamente APIs mayores de herramientas para ocultar
  avisos; algunas no tienen parche publicado dentro del rango utilizado.
- Revisar una actualización compatible del CLI y repetir emuladores/despliegue de
  prueba antes de declarar cerrada esta parte. `npm audit --omit=dev` no es una
  medida suficiente aquí, porque los SDKs del frontend se copian desde devDependencies.

## Qué falta para terminar todo el mapa original

| Pendiente | Situación real / siguiente validación |
|---|---|
| Firestore real y emulador | Código/pruebas preparados, ejecución local bloqueada. Es requisito de publicación |
| Storage y retención | No implementados. Fotos/firmas conservan el formato actual; no hubo migración ni pérdida de datos |
| Aprobación externa por enlace | No implementada. Hoy hay registro manual por versión con evidencia del técnico |
| Compras, ajustes y devoluciones de stock | No implementados. Existen lotes recibidos, reserva, consumo y liberación |
| Garantía como nueva orden de retrabajo | No implementada. Existe seguimiento del caso vinculado a la orden original |
| Mensajes automáticos | No implementados. Falta backend, consentimiento, cola, proveedor, reintentos y confirmación de entrega |
| Métricas agregadas de servidor | No implementadas. Existe informe paginado bajo demanda, no un corte atómico |
| Catálogo canónico de variantes | Modelos locales y variante manual; no una base exhaustiva con identificadores del fabricante |
| Validación real de taller | Pendientes impresión física, dos sesiones reales, pérdida de red real y restauración de respaldos |

No se requieren contraseñas ni tokens en el chat. La configuración de servicios
externos debe realizarse con los gestores de secretos y permisos correspondientes.
No se activarán envíos a clientes ni migraciones masivas sin esa preparación.

## Cómo repetir la verificación

```bash
npm ci
npm run serve                 # mantener en otra terminal
npm run check
npm run test:rules            # necesita Java 21
npx playwright install --with-deps chromium
npm run test:browser
npm audit
```

`npm run check:full` enlaza las tres capas y devuelve error si falla cualquiera.
En CI se inicia el servidor de Playwright automáticamente. Resultados, trazas y
credenciales temporales están excluidos de Git; no se versionaron binarios de Java
ni Chromium ni datos reales.
