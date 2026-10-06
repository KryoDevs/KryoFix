# Revisión iterativa — 4 de octubre de 2026

## Ciclos realizados

1. **Diagnóstico:** lectura del código, reglas, caché, workflows y tests. Instalación
   reproducible con `npm ci`. Base: 75 tests correctos; 13 avisos de dependencias.
2. **Arquitectura y correcciones:** extracción de dominio compartido, nuevas funciones
   operativas y regresiones. La auditoría detectó las clases CSS aún ausentes durante
   la integración; se completaron antes de continuar. Resultado: 84 tests correctos.
3. **Revisión de regresiones:** tests del service worker y consultas por enlace,
   eliminación de duplicación en el parser público y comprobación de whitespace.
   Resultado: **87/87**, lint y auditoría estática correctos; `git diff --check` limpio.

## Lista de mejoras implementadas

| Área | Cambio |
|---|---|
| Arquitectura | `dominio.js` concentra estados, transiciones, importes, escapado y parser de códigos sin acceso a red o DOM. Las páginas cargan este módulo antes de sus controladores. |
| Operación | Prioridad editable y ordenamiento por prioridad; notas internas privadas y editables. |
| Navegación | Chips de estado con conteos, acceso de teclado a KPIs, KPI de saldo funcional, atajo `/`. |
| Catálogo | Importación confirmada de siete servicios de ejemplo, sin duplicados al repetir y sin sustituir servicios ya cargados en pantalla. |
| Entrega | Resumen del saldo, pago optativo explícito y eliminación del valor del PIN en la escritura de entrega. Órdenes entregadas no se reabren desde el selector. |
| Seguridad | Validación financiera también en updates de reglas; seguimiento permite `get` anónimo, pero no enumeración con `list`. |
| Privacidad | Limpieza de formulario, catálogo, ticket y modal al salir o cambiar de usuario. El ID real del documento prevalece sobre un campo `id` almacenado. |
| CSV | Prefijo protector para texto interpretable como fórmula, conservando importes numéricos y escapado CSV. |
| Seguimiento | Parser único acepta enlace/query/ID y rechaza rutas; oculta la ficha anterior al iniciar otra consulta. Ticket imprime ID de seguimiento completo. |
| Recordatorios | Días sin retirar calculados desde reparación, no desde ingreso cuando existe fecha de reparación. |
| Diseño | Corrige flex-basis que creaba campos de 220px de alto en móvil; controles táctiles, chips, notas, prioridades, modal desplazable y colores de SweetAlert acordes al tema. |
| PWA | Caché v7 incluye dominio; QR offline abre `status.html`, no login; limpieza limitada a cachés TechFix; margen de silencio del QR dinámico corregido. |
| CI | Tanto producción como preview ejecutan comprobaciones antes del deploy. |
| Dependencias | Firebase 10.14.1 y SweetAlert2 11.26.25 fijados; vendor regenerado y verificado byte a byte. |

## Límites y próximos pasos (no implementados)

- **Dependencias:** el último `npm audit` informa 11 vulnerabilidades transitivas
  (6 moderadas, 5 altas), vinculadas a `undici` y `@grpc/grpc-js` en la cadena
  de Firebase. `npm audit fix` no las elimina; su sugerencia forzada baja Firebase
  a 9.14.0. No se aplicó esa degradación. Evaluar SDK moderno y validar Auth,
  persistencia y Firestore reales antes de migrar. No se afirma que el proyecto
  esté libre de vulnerabilidades.
- **Pruebas reales:** las reglas se comprueban estáticamente, no con emulador;
  añadir `rules-unit-testing` con propietarios distintos, listados anónimos,
  escrituras malformadas y operaciones atómicas. Las pruebas UI usan jsdom,
  no sustituyen revisión visual en navegador, impresión física ni pruebas Firebase.
- **Escalabilidad:** la consulta sigue limitada a 500 órdenes. Añadir paginación
  con cursores y métricas agregadas en servidor antes de usarla como contabilidad.
- **Archivos:** mover fotos/firmas a Storage con reglas y políticas de retención.
- **Concurrencia:** transacciones para estados/pagos e importación de catálogo
  entre pestañas; las validaciones UI no sustituyen un control transaccional.
- **Seguridad adicional:** esquema y transiciones completas en reglas, vincular
  el espejo al documento privado, sustituir migración heredada en consola por
  herramienta administrativa auditable. No ejecutar la migración sobre una base
  compartida sin revisar la propiedad de las órdenes sin UID.
- **Trazabilidad:** papelera, historial de cambios financieros, roles y numeración
  de órdenes global (el número humano actual es local al dispositivo).
- **UX:** diseñar política explícita de sincronización pendiente, validación de
  imágenes concurrentes y conservación de borradores sin almacenar PIN localmente.

## Antes de publicar

1. Revisar y desplegar reglas e índices con Firebase CLI: los workflows siguen
   publicando solo hosting. `firebase deploy --only firestore:rules,firestore:indexes`.
2. Probar login, ingreso, catálogo, entrega, QR y modo offline en un entorno de
   Firebase de pruebas. No se escribieron datos ni se desplegó a producción aquí.
3. Verificar documentos antiguos: updates requieren cliente y montos válidos.
4. Comprobar manualmente claros/oscuros, teclado, móviles y ticket impreso.

Los informes históricos de `ANALISIS.md` describen versiones anteriores, no una
garantía del estado de seguridad actual. Este documento registra esta revisión.
