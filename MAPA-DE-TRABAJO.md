# KryoFix — Mapa de trabajo

**Gestión de servicio técnico · Desarrollado por KryoDevs**  
Fecha: 6 de octubre de 2026 · Estado: propuesta de ejecución incremental.

> Objetivo: convertir el registro de equipos en un asistente de trabajo para Kryo / Mr Kryo, sin perder información, manteniendo el control técnico y sin reescribir la aplicación completa.
>
> Hay una implementación extendida de los flujos principales de F1–F6, pero no están cerradas todas las fases. El estado vigente está en la sección 11 y en VALIDACION.md; la sección 10 conserva el corte anterior. No se ha desplegado a producción.

## 1. Identidad del producto

| Elemento | Decisión |
|---|---|
| Nombre | **KryoFix** |
| Descriptor | **Gestión de servicio técnico** |
| Autoría | **Desarrollado por KryoDevs** |
| Identidad personal | Kryo / Mr Kryo, creador y técnico; no confundir la marca del producto con un rol de acceso |
| Criterio | «Kryo» conecta con tu apodo y «Fix» con reparación. Es corto para móvil, tickets y etiquetas |
| Firma opcional de comunicación | «Kryo / Mr Kryo · Servicio técnico»; configurable antes de usarla en mensajes a clientes |
| Identidad visual inicial | Conservar isotipo de llave/circuito y temas claro/oscuro. No hace falta sustituir todos los recursos para cambiar el nombre |

Aplicado: login, cabecera del taller, seguimiento público, título de pestaña, manifiesto PWA, ticket, título al compartir, nombre de exportaciones CSV, banco visual y documentación principal. El paquete local pasa a llamarse `kryofix`.

**Compatibilidad:** conservar proyecto/dominio Firebase, repositorio, colecciones, IDs, prefijo histórico `TF-`, claves locales, namespace de cachés `techfix-*` y APIs `TechFix*`. No se migra la base ni se modifica el destino de los QR. El nombre de una PWA ya instalada puede requerir actualización del navegador; verificarlo en dispositivos reales.

El nombre es una propuesta de producto aplicada al código, no una comprobación de disponibilidad de marca comercial, dominio o usuarios en redes. Revisar eso antes de un lanzamiento comercial. Un dominio nuevo y un logo definitivo serían proyectos separados, con redirecciones y prueba de QR antiguos.

## 2. Punto de partida y decisiones

### Ya existe en el repositorio

- Autenticación, órdenes privadas por usuario, catálogo de precios y seguimiento público mínimo.
- Recepción, estados, abonos, ticket QR, firma y exportación CSV.
- Modelos sugeridos, síntomas de recepción y procedimientos con pasos guardables.
- PWA, temas claro/oscuro, pruebas con jsdom y verificaciones en CI.

### Riesgos que determinan el orden

1. Las tarjetas se reconstruyen en actualizaciones y filtros; los borradores locales del procedimiento pueden desaparecer.
2. El indicador de red no confirma sincronización real con Firestore.
3. Dos pestañas pueden sobrescribir avances o datos; los lotes atómicos no detectan una edición obsoleta.
4. «Ingresos» representa presupuestos de órdenes cerradas, no cobros. El saldo mostrado excluye entregados con deuda.
5. La búsqueda y métricas dependen de un máximo de 500 órdenes cargadas.
6. El número legible de orden es local al dispositivo; no garantiza unicidad entre equipos.
7. Las reglas no validan todo el esquema ni las transiciones; las pruebas actuales no sustituyen emuladores ni navegador real.

### Principios

- Primero confiabilidad; después comodidad; finalmente automatización externa.
- Mantener Firebase y JavaScript en la primera etapa. Modularizar antes de considerar un framework.
- No introducir roles, multi-sucursal ni infraestructura compleja hasta necesitarlos.
- Cada fase debe poder publicarse y verificarse por separado en esta rama de trabajo.
- Distinguir sugerencia, diagnóstico confirmado, autorización y ejecución. Nunca inferir consentimiento desde un síntoma.
- Los cambios irreversibles, cobros, entrega y comunicaciones al cliente requieren controles explícitos.

## 3. Ruta y dependencias

```text
F0 Identidad
   ↓
F1 Confiabilidad y separación mínima
   ↓
F2 Ficha de orden y sistema visual
   ↓
F3 Recepción, diagnóstico y control de calidad
   ↓
F4 Presupuestos, autorizaciones y pagos
   ↓
F5 Clientes, repuestos y garantías
   ↓
F6 Automatización externa y análisis completo
```

Seguridad, pruebas, documentación y migraciones acompañan todas las fases. La corrección del significado de métricas comienza en F1; el libro de pagos se implementa en F4. Si se alcanzan 500 órdenes antes, adelantar la paginación y consultas completas de F6.

**Esfuerzo orientativo:** S = 1–2 jornadas; M = 3–5; L = 6–10; XL = dividir antes de estimar. Son jornadas de desarrollo concentrado, no fechas ni compromisos; no incluyen esperas por proveedores, aprobaciones o migraciones de datos reales.

## 4. Fases de implementación

### F0 · Identidad coherente — implementada en código, pendiente de publicación

**Resultado:** KryoFix, firmado por KryoDevs, sin romper datos o enlaces.

- [x] Cambiar marca visible y metadatos de instalación.
- [x] Actualizar ticket, compartir y CSV.
- [x] Mantener infraestructura e identificadores heredados.
- [x] Documentar plan y compatibilidad.
- [ ] Verificar instalación PWA, impresión física y QR histórico en entorno de pruebas.
- [ ] Publicar tras aprobar verificaciones.

**Aceptación:** no aparece la marca anterior en los textos públicos principales; autenticación y URLs conservan sus identificadores; pruebas de marca y regresión pasan. No se requiere una migración de datos.

### F1 · Proteger el trabajo y confirmar el guardado — prioridad P0 · L

**Resultado:** el técnico sabe qué está guardado y no pierde trabajo al cambiar la vista.

**Trabajo:**
- Extraer estado de borradores y repositorio de órdenes desde `app.js`, manteniendo comportamiento.
- Guardar borradores por ID en un almacén de sesión independiente del DOM; conservar al filtrar, ordenar o recibir cambios de otra orden.
- Avisar al salir con cambios; limpiar borradores al cerrar sesión. No persistir PIN/firma/fotos en un almacén adicional de borradores.
- Diferenciar «sin guardar», «pendiente de sincronizar», «sincronizado» y «error» usando metadatos reales de Firestore.
- Conservar la edición local ante cambios remotos; detectar conflicto de revisión en lugar de sobrescribir silenciosamente.
- Usar control transaccional para acciones críticas online. Offline: edición local permitida, pero confirmación de pagos y entrega pendiente hasta validación online; no prometer que las transacciones funcionan sin red.
- Renombrar el KPI actual como importe de trabajos cerrados y visibilizar deudas de órdenes entregadas. Indicar alcance parcial de métricas.
- Añadir pruebas de reglas con emulador y casos de datos malformados; validar nuevos campos sin bloquear órdenes antiguas válidas.

**Aceptación:** marcar tres pasos, recibir una actualización de otra orden y cambiar filtros no borra el borrador. Dos pestañas reciben aviso de conflicto. Una escritura rechazada no aparece como sincronizada. Cerrar sesión elimina datos de edición de ese usuario.

### F2 · Ficha de orden y diseño centrado en acciones — prioridad P1 · L

**Depende de:** F1.

**Resultado:** tablero breve y ficha completa, accesible por enlace directo privado.

**Trabajo:**
- Tarjetas compactas: orden, equipo, estado, prioridad, espera, bloqueo y próxima acción.
- Ficha con Resumen, Diagnóstico, Procedimiento, Repuestos, Pagos e Historial; las secciones aún no implementadas no deben simular funcionalidad.
- Ruta interna de la orden separada del enlace público de seguimiento, con control de acceso y manejo de ID inexistente.
- Mantener foco, posición y sección abierta al actualizar datos.
- Componentes reutilizables para campos, botones, alertas, etiquetas de estado y confirmaciones.
- Unificar tokens de color, espaciado, tipografía, bordes e iconografía; reducir emojis como controles primarios.
- Priorizar una acción principal y colocar acciones destructivas en zona secundaria.
- En móvil, ficha de una columna y acciones accesibles sin tapar campos con el teclado.

**Aceptación:** abrir/reabrir una orden conserva su contexto; navegación por teclado y lector de pantalla; sin desbordamientos a 360 px; contraste revisado en ambos temas. Validar login, tablero, ficha y ticket en navegador real, no solo jsdom.

### F3 · Recepción y diagnóstico guiados — prioridad P1 · L

**Depende de:** F1 y F2.

**Resultado:** menos escritura y pasos apropiados al caso, sin inventar diagnósticos.

**Trabajo:**
- Recepción progresiva con modo rápido y reutilización confirmada de datos.
- Advertir duplicados por IMEI/serie normalizados; no fusionar equipos automáticamente.
- Catálogo con IDs de marca, familia, modelo y variante; búsqueda y entrada manual.
- Separar síntoma reportado, pruebas realizadas, hipótesis y diagnóstico confirmado.
- Resultados de pruebas: correcto, falla, no probado y no aplica con motivo.
- Árbol inicial para «no carga», con paradas de seguridad y pasos condicionales; extender después de probarlo.
- Plantillas versionadas editables y con autor/fuente/fecha de revisión; snapshot por orden y IDs estables de pasos.
- Checklist final según trabajo efectuado, con excepciones justificadas.

**Aceptación:** el flujo no propone cargar un equipo con señales de riesgo. Cambiar una plantilla no modifica órdenes existentes. Completar una prueba no confirma reparación ni autorización. El resumen técnico refleja resultados reales, no solo casillas marcadas.

### F4 · Presupuestos, autorización y dinero trazable — prioridad P1 · XL

**Depende de:** F1–F3. Dividir en tres entregas: presupuesto, autorización, pagos.

**Resultado:** saber qué se autorizó, qué se hizo y cuánto se cobró.

**Trabajo:**
- Presupuestos desglosados: repuestos, mano de obra, descuentos y condiciones; guardar versiones.
- Autorización ligada a una versión concreta. Cambios de monto o alcance invalidan la aprobación anterior para el trabajo añadido.
- Empezar con autorización registrada por el técnico y evidencia. Incorporar enlace externo protegido, con vencimiento y validación en servidor, en una entrega posterior.
- Pagos como movimientos con monto, fecha, medio, responsable e identificador de operación; correcciones como reversos, no borrados.
- Operaciones idempotentes: reintentar no registra el mismo pago dos veces.
- Separar presupuestado, cobrado, por cobrar e importe de trabajos cerrados. No llamar utilidad a una cifra sin costos completos.
- Control de saldo en entrega con excepción autorizada, y prueba final de calidad antes de marcar listo.
- Numeración central única; ingreso offline con identificador provisional que no se presenta como correlativo definitivo.

**Migración:** no inventar fechas ni medios de pago de los abonos antiguos. Preservarlos como saldo/movimiento de apertura identificado como legado y conciliar antes de generar reportes.

**Aceptación:** doble clic/reintento no duplica pago; un cambio de presupuesto pide nueva aprobación; entregados con deuda siguen en cuentas por cobrar; numeración no colisiona entre dispositivos. El ticket operativo no se presenta como documento tributario.

### F5 · Clientes, inventario y garantías — prioridad P2 · XL

**Depende de:** F3 y F4. Entregas independientes: clientes, stock, garantías.

- Clientes recurrentes y equipos vinculados; confirmar coincidencias, no fusionar por nombre/teléfono sin revisión.
- Repuestos por variante y calidad, proveedores, costos y disponibilidad.
- Movimientos de inventario: entrada, reserva, consumo, liberación, devolución y ajuste con motivo.
- Solicitud de compra cuando falte stock; reserva y consumo transaccionales para evitar dobles asignaciones.
- Relacionar devolución en garantía con orden original, pieza y motivo; registrar resultado de revisión.
- Trasladar evidencias a Storage con permisos, compresión, rutas por propietario, límites y retención. Migrar primero y borrar base64 solo después de verificar integridad y acceso.

**Aceptación:** dos órdenes no reservan la última unidad simultáneamente; cancelar libera la reserva; devolución conserva la reparación original; otro usuario no puede descargar una evidencia.

### F6 · Automatización externa y métricas completas — prioridad P2 · XL

**Depende de:** eventos fiables, autorización y datos estructurados de fases anteriores.

- Consultar activos por separado; historial paginado con cursores y búsquedas explícitas. Las métricas no dependen de las tarjetas cargadas.
- Agregados fiables y reconciliación: tiempos por etapa, cobros, pendientes, retrabajos, garantías y síntomas frente a causas confirmadas.
- Cola de notificaciones con consentimiento, plantilla, destino validado, idempotencia, límites, cancelación, reintento y estado de entrega.
- Comenzar con mensajes preparados y aprobación manual. Envío sin la app abierta requiere backend e integración oficial; revisar costos y requisitos antes de contratar.
- Alertas por tiempos y bloqueos: aprobación pendiente, llegada de repuesto, listo para retiro y seguimiento de garantía.
- Sugerir procedimientos según reparaciones confirmadas y resultados. Mostrar tamaño de muestra y alcance; no afirmar causalidad ni defectos de fábrica por frecuencia.

**Aceptación:** el mismo evento no envía dos avisos; una orden entregada deja de generar recordatorios de retiro; mensajes no contienen PIN ni notas internas; los totales incluyen órdenes fuera de la primera página.

## 5. Arquitectura objetivo, sin reescritura masiva

```text
app/
  dominio/        estados, dinero, diagnóstico, validaciones puras
  aplicacion/     registrar ingreso, aprobar presupuesto, cobrar, entregar
  datos/          repositorios Firebase, serialización, sincronización
  estado/         sesión, borradores por orden, conflictos y navegación
  interfaz/       recepción, tablero, ficha y componentes accesibles
  catalogos/      modelos, síntomas y plantillas versionadas
  estilos/        tokens, componentes, vistas e impresión
backend/          solo cuando sea necesario: autorizaciones, jobs y avisos
```

La UI llama casos de uso; no decide por sí sola reglas críticas ni escribe directamente cualquier campo. Las reglas/backend verifican permisos y consistencia aunque se omita la interfaz. Separar los datos públicos de los privados seguirá siendo obligatorio.

### Evolución de datos

| Área | Evolución propuesta | Fase |
|---|---|---|
| Orden | `schemaVersion`, revisión, eventos y timestamps confirmados | F1–F4 |
| Diagnóstico | Síntomas, resultados, causa confirmada y guía versionada | F3 |
| Presupuesto | Versiones y autorización asociada | F4 |
| Pagos | Movimientos/reversos e idempotencia | F4 |
| Cliente/equipo | Entidades reutilizables; la orden conserva snapshot de recepción | F5 |
| Inventario | Repuestos y movimientos con reservas | F5 |
| Evidencia | Referencias privadas a Storage, no URLs públicas permanentes | F5 |
| Notificación | Cola privada, intentos, resultado y consentimiento | F6 |

Mantener `uid` como propietario mientras el uso sea individual. Si trabajan varios técnicos, diseñar `tallerId`, membresías y roles antes de compartir órdenes; nunca reinterpretar documentos existentes como compartidos sin migración y reglas probadas. TypeScript y SDK modular de Firebase se evalúan después de separar módulos, sin mezclar una actualización grande con cambios de pagos.

## 6. Primera entrega recomendada: backlog ejecutable

Trabajar en este orden, con cambios pequeños y revisables:

| ID | Tarea | Depende de | Verificación |
|---|---|---|---|
| KF-01 | Reproducir pérdida de borrador y añadir prueba de regresión | — | Actualización ajena + filtro conservan los checks |
| KF-02 | Extraer almacén de borradores por orden | KF-01 | Limpieza al salir; sin persistencia extra de PIN |
| KF-03 | Separar repositorio y metadatos de sincronización | KF-02 | Offline/reconexión/error sin falso «guardado» |
| KF-04 | Revisión de orden y resolución de conflictos | KF-03 | Dos pestañas no se pisan silenciosamente |
| KF-05 | Corregir etiquetas/alcance de métricas y deuda entregada | — | Caso con equipo entregado y saldo pendiente |
| KF-06 | Emulador: propiedad, esquema y escrituras críticas | KF-03 | Rechazo de acceso ajeno y transiciones no permitidas |
| KF-07 | Ficha de orden inicial y tarjeta compacta | KF-02–04 | Abrir/cerrar no pierde foco ni borrador |
| KF-08 | Pruebas navegador + revisión móvil/impresión | KF-05–07 | Flujo completo en entorno de pruebas |

**Meta de esta entrega:** ninguna automatización nueva debe hacer perder trabajo ni dar una falsa confirmación de guardado. No incluir todavía mensajería automática, inventario ni migraciones financieras masivas.

## 7. Criterio de terminado y publicación

Para cada entrega:

1. `npm run check` y `git diff --check` correctos; documentar los casos nuevos, no solo contar pruebas.
2. Tests puros y UI; emulador para seguridad/concurrencia; navegador para flujo, foco, impresión y PWA.
3. Probar datos antiguos, errores de permisos, doble clic, dos pestañas, desconexión y cierre de sesión.
4. Sin datos sensibles nuevos en seguimiento público, logs, CSV o borradores persistentes.
5. Cambios de esquema con `schemaVersion`, migración idempotente, ensayo previo, respaldo y reporte; no ejecutar migraciones desde la consola del cliente sobre datos sin propiedad confirmada.
6. Revisar dependencias con auditoría actual; resolver por actualización compatible y pruebas, no aplicar degradaciones forzadas a ciegas.
7. Publicar primero en entorno de pruebas. Hosting, reglas, índices, Storage y backend deben tener un plan coordinado: los workflows actuales publican hosting, no todo lo demás.
8. Plan de reversión por entrega: frontend anterior compatible y funciones nuevas desactivables; restaurar un respaldo solo mediante procedimiento validado, no asumir que revertir código revierte datos.
9. Aprobación de Kryo en un caso realista antes de producción; registrar versión y cambios para el usuario.

## 8. Cómo medir si mejoró

Levantar una línea base con casos de prueba y una muestra de trabajo real, sin recopilar datos personales innecesarios:

- Tiempo de recepción y cantidad de campos repetidos escritos manualmente.
- Ediciones perdidas, conflictos detectados y guardados pendientes/rechazados.
- Tiempo en espera de aprobación, repuesto y retiro.
- Saldo por cobrar frente a cobros conciliados.
- Porcentaje de reparaciones con pruebas finales y autorización registradas.
- Retornos por garantía y resultado de reparación, no solo frecuencia de síntomas.

Objetivos iniciales de aceptación: cero pérdidas en los escenarios de regresión definidos, cero pagos/avisos duplicados en pruebas de reintento y conciliación exacta en los casos financieros de prueba. Las metas de productividad se fijan después de medir; no prometer porcentajes sin una línea base.

## 9. Fuera del alcance inmediato

- Diagnóstico automático definitivo mediante IA o elección automática de piezas.
- Identificación del modelo por IMEI mediante servicios externos no evaluados.
- Facturación tributaria, contabilidad formal o integración fiscal.
- Migrar a microservicios o cambiar toda la tecnología por razones estéticas.
- Multi-sucursal/roles sin una necesidad operativa confirmada.
- Renombrar Firebase, el dominio o el repositorio solo para coincidir con la marca.

**Decisión recomendada:** publicar la identidad tras verificarla y empezar por KF-01 a KF-04. Luego construir la ficha de orden sobre esa base estable; continuar con diagnóstico, autorización y pagos antes de automatizar mensajes y compras.


## 10. Seguimiento de ejecución — primera entrega de F1

**Estado: implementada y verificada con la suite local; fase 1 todavía abierta.**

| Tarea | Estado en esta entrega |
|---|---|
| KF-01 | Implementada: regresión de filtros, cambio ajeno, apertura y foco del procedimiento |
| KF-02 | Implementada para procedimientos: almacén privado en memoria, aviso al salir y limpieza de sesión |
| KF-03 | Parcial: consulta de órdenes extraída y metadata real; catálogo y demás escrituras permanecen en el controlador legado |
| KF-04 | Parcial: procedimiento con revisión, comparación y transacción; estados, pagos y entrega aún pendientes |
| KF-05 | Implementada: importe de trabajos cerrados separado semánticamente de cobros; deudas entregadas incluidas y filtro específico |
| KF-06 | Pendiente: refuerzo de reglas/esquema y pruebas contra emulador |
| KF-07–08 | Pendientes: ficha de orden y validación en navegador/dispositivos reales |

### Cambios concretos

- `app/borradores.js`: almacén por orden, huella estable, conflicto y apertura. Solo copia datos de la guía; no añade almacenamiento persistente ni copia la orden completa.
- `app/ordenes-repositorio.js`: suscripción privada con metadata y guardado transaccional del procedimiento. Relee propietario, estado y procedimiento antes de escribir; rechaza base obsoleta y orden entregada.
- `procedimiento.revision`: contador de edición independiente de la versión de plantilla. Las guías antiguas sin revisión parten de cero y suben a uno al guardar; no requiere migración masiva.
- `procedimiento.actualizado`: timestamp de servidor para nuevos guardados. La guía mantiene sus pasos/versiones y no se publica en seguimiento.
- UI distingue borrador, guardando, versión local, sincronizado, conflicto y error. El indicador global se limita a las órdenes de la consulta, no certifica catálogo, red de terceros ni todas las operaciones de la app.
- Si el procedimiento entra en conflicto, se pueden comparar versiones, conservar el borrador o descartarlo explícitamente. No existe «sobrescribir de todos modos» ni fusión automática de pasos.
- Offline: edición local permitida; el guardado transaccional exige conexión y reintento explícito. No se anuncia una cola de envío que no existe.
- Aviso de cierre de pestaña cuando hay borradores; el navegador puede limitar este aviso, especialmente en móvil. **Recargar/cerrar la pestaña todavía descarta el borrador** si se continúa con la salida.
- Saldo incluye entregados con deuda. Los indicadores siguen limitados a las últimas 500 órdenes cargadas, con aviso visible; no son contabilidad completa.

### Verificación de esta entrega

`npm run check`: **117 pruebas aprobadas**, lint y auditoría estática correctos. `git diff --check` limpio.

Se añadieron 17 pruebas de regresión, incluyendo actualización ajena, filtro, cambio de usuario, salida cancelada, error de permisos, offline/reconexión, metadata, conflicto/reintento de transacción, entrega concurrente, doble clic y respuesta tardía tras cerrar sesión. El doble de Firebase simula reintentos optimistas; **no sustituye el emulador ni una prueba real en dos navegadores**.

No se modificaron reglas ni se desplegó a producción en esta entrega. La comprobación transaccional del cliente no es una nueva frontera de seguridad: siguen pendientes validaciones de esquema y transiciones en reglas/backend. También falta extender los controles de concurrencia a pagos, estados y entrega.

**Siguiente corte recomendado:** completar KF-06 con emulador, esquema compatible y políticas de transición, y extender KF-04 a las acciones críticas. No activar automatizaciones externas ni dar por cerrada F1 antes de esa verificación.


## 11. Estado vigente — continuación de fases y LOOP de validación

Ver [VALIDACION.md](VALIDACION.md) para pruebas ejecutadas, errores encontrados,
correcciones y bloqueos. **Este corte reemplaza el estado de avance de la sección 10,
no convierte todos los objetivos del mapa en tareas terminadas.**

| Fase | Implementado en esta continuación | Pendiente para cerrarla |
|---|---|---|
| F1 | Transacciones/revisión para edición, estados, pagos y entrega; epoch de sesión; foto asíncrona protegida; firma detecta resumen obsoleto; reglas y suite de emulador | Probar Firebase real/dos sesiones; resolver avisos de herramientas (emulador ya aprobado en CI) |
| F2 | Ficha dedicada por ID privado, secciones, siguiente acción, agrupación de botones, móvil/teclado/temas probados | Revisión visual completa de todos los estados y prueba de impresión física |
| F3 | Diagnóstico carga/riesgos, hipótesis/causa, calidad y excepciones; plantillas privadas editables/versionadas con fuente y snapshot | Catálogo canónico de variantes y ampliación de árboles técnicos validados |
| F4 | Presupuestos versionados, autorización manual por versión, pagos/reversos idempotentes, apertura legada, correlativo central, entrega protegida | Autorización pública por enlace y validación integral en staging; no se migran fechas de cobro ficticias |
| F5 | Clientes explícitos, proveedores/costos por lote, reservas/consumo/liberación, seguimiento de garantía y eventos | Compras pendientes, ajustes/devoluciones, garantía como nueva orden y migración a Storage/retención |
| F6 | Historial paginado completo bajo demanda, informe de deuda y pagos netos, pendientes sugeridos y mensajes preparados | Backend de notificaciones, consentimiento, proveedor/cola y agregados del servidor |

### Resultado local final

- **136 pruebas locales aprobadas**, lint y auditoría estática correctos.
- **8 pruebas de navegador aprobadas** en Chromium real, con backend de pruebas
  aislado para los flujos autenticados; incluidas vista de 360 px y contraste de
  ficha en oscuro.
- Emulador: **8 pruebas aprobadas en CI con Java 21**, incluidas concurrencia y
  escrituras maliciosas de stock. El bloqueo local no impidió la validación remota.
- **CI aprobado en Node 20.19/22**, emulador y Chromium. Se corrigió la espera
  asíncrona de una prueba detectada por la matriz y se repitió la validación.
- Reglas de inventario reforzadas: autorización, deltas exactos y vínculo entre
  lote, reserva, orden y evento; no solo comprobaciones del servicio del navegador.
- `npm audit`: 11 avisos transitivos (7 altos, 4 moderados) en herramientas; no hay
  garantía de ausencia de vulnerabilidades. No se forzaron degradaciones del SDK.
- SDK Firebase 12.19.0 y vendor actualizado; reglas/índices se publicarán antes del
  cliente cuando se integre en main y todas las validaciones pasen.

### Nuevo criterio de salida

No declarar «todas las fases terminadas» ni publicar esta revisión hasta
validar reglas/datos legados en staging y resolver las
configuraciones y trabajos pendientes de la tabla. Fotos/firmas siguen en base64;
WhatsApp no se envía en segundo plano; una autorización registrada por el técnico
no se presenta como aprobación digital del cliente.

CI verificado del código final: [https://github.com/KryoDevs/TechFix-Tracker/actions/runs/37435626311](https://github.com/KryoDevs/TechFix-Tracker/actions/runs/37435626311).
