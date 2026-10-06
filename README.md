# KryoFix — Gestión de servicio técnico

**Desarrollado por KryoDevs**, inspirado en Kryo / Mr Kryo.

PWA privada para recepción, diagnóstico, reparación y seguimiento de equipos.
HTML/CSS/JavaScript modular sin bundler + Firebase Auth, Firestore y Hosting.

- [Mapa de trabajo y estado real](MAPA-DE-TRABAJO.md)
- [Resultados del ciclo de validación y pendientes](VALIDACION.md)
- [Configuración, proveedor y puesta en marcha segura](DESPLIEGUE.md)

> Esta revisión no se ha desplegado a producción. El CI aprobó las pruebas en
> Node 20.19/22, el emulador de Firestore y Chromium. No equivale a validar el
> proyecto productivo: todavía falta staging con Auth y datos legados.

## Continuación: funcionalidades añadidas y límites

Se incorporaron compras pendientes/recepción, ajustes y devoluciones, órdenes de
retrabajo vinculadas y un backend privado de Functions. Este último implementa
aprobación por enlace, archivo privado de evidencias, retención explícita,
consentimiento/cola de mensajes e informes consistentes del servidor.

**No está desplegado ni configurado con un proveedor de mensajes real.** La cola
requiere un proveedor/adaptador compatible; no basta con pegar una URL de Meta o
Twilio. Los envíos están desactivados por defecto. Ver DESPLIEGUE.md.

La validación incluye 15 casos en cinco perfiles: computador, teléfono, tablet en
ambas orientaciones y WebKit. Son perfiles emulados; quedan pruebas físicas y
staging. El catálogo técnico no pretende cubrir todas las variantes de fabricantes.

## Funciones disponibles en código

### Recepción y taller

- Modelos sugeridos por marca (Apple, Samsung, Xiaomi, Motorola y Huawei), catálogo
  privado e historial cargado; entrada manual para modelos/variantes no incluidos.
- Síntomas habituales con comprobaciones orientativas, sin afirmar defectos de
  fábrica ni diagnósticos confirmados. Frecuencia basada en selecciones del taller.
- Agenda privada: reutilización de cliente por teléfono **con selección explícita**.
  Clientes nuevos no se fusionan automáticamente aunque compartan teléfono.
- Advertencia de IMEI/serie duplicado entre órdenes activas **cargadas**. No es una
  restricción de unicidad ni una búsqueda completa en documentos históricos.
- Numeración transaccional por usuario: `KRF-000001`. Órdenes antiguas conservan sus
  números `TF-…`, IDs y QR. La recepción nueva requiere conexión; no asigna un
  correlativo definitivo offline. Reintentos del mismo ingreso en la sesión
  conservan el ID y detectan cambios de contenido.
- Estado, prioridad, próxima acción, ticket QR, firma, CSV y seguimiento público.
- Las fotos no terminan de guardarse antes de finalizar la compresión; una lectura
  de imagen obsoleta no puede repoblar el formulario después de salir.

### Ficha de trabajo

En una tarjeta: **Abrir ficha de trabajo**. Secciones:

- **Resumen:** recepción, próxima acción, prioridad y notas privadas.
- **Diagnóstico:** variante exacta, riesgo, pruebas, hipótesis y causa confirmada.
  Flujo inicial de carga: primero riesgos, después cable/cargador y comprobaciones.
- **Procedimiento:** pasos marcables, borrador por orden y comparación de conflictos.
  Se pueden aplicar plantillas privadas con confirmación de reinicio del avance.
- **Calidad:** pantalla, carga, audio, cámaras y conectividad; «no aplica» exige motivo.
- **Presupuesto:** hasta 20 conceptos, cantidades, precios, total calculado, plazo,
  condiciones, versiones y registro manual de aprobación/rechazo del cliente.
  Cambiar el presupuesto deja su autorización pendiente otra vez.
- **Pagos:** movimientos idempotentes y reversos, sin borrar el pago original.
  Abonos de recepción/legados se preservan como apertura sin inventar fechas.
- **Repuestos:** reserva, consumo y liberación por lote; comprobación de marca,
  modelo y confirmación humana de variante; nunca stock negativo.
- **Garantía:** evaluación asociada a la orden entregada, sin alterar su entrega
  original. Los cambios se conservan en eventos; no crea automáticamente otra orden.
- **Contacto:** prepara WhatsApp y registra manualmente el resultado. **No envía
  automáticamente ni acredita recepción del mensaje.**
- **Historial:** eventos privados con fecha confirmada, versiones de presupuestos
  y cambios de garantía. El historial legado de estados se sigue conservando.

Las órdenes nuevas con costo requieren presupuesto aprobado y calidad válida antes
de pasar a listas. Si una nueva prueba o presupuesto invalida una reparación lista,
vuelve a revisión. La entrega exige firma, estado listo y una excepción explícita
si queda deuda; consume/libera reservas antes de entregar. Un monto cambiado
durante la firma produce conflicto, no un cobro silencioso.

### Gestión del taller

Botón **Gestión del taller**:

- Historial paginado del servidor, más allá de las 500 órdenes del tablero.
- Agenda de clientes creados con el nuevo flujo.
- Inventario por lotes recibidos, proveedor, costo y variante.
- Plantillas propias, versionadas, con fuente/manual y un paso por línea; las
  órdenes conservan una copia y no cambian al editar una plantilla.
- Informe que recorre todas las órdenes, suma deuda incluyendo entregados y calcula
  pagos netos registrados en el mes, excluyendo aperturas sin fecha verificable.
  Usa la fecha confirmada por servidor cuando está disponible.
- Lista de pendientes sugeridos de autorización, repuestos y retiro.

El tablero conserva su límite de 500 registros con aviso visible. El informe
completo es una consulta paginada bajo demanda, **no un agregado contable atómico
ni un proceso de servidor programado**. Puede generar lecturas facturables.

## Confiabilidad y privacidad

- Borradores de procedimiento en memoria de sesión, independientes del DOM:
  sobreviven a filtros, ordenamiento y actualizaciones ajenas. No sobreviven a una
  recarga. Advertencia al salir; limpieza al cerrar o cambiar sesión.
- La ficha pide confirmación antes de descartar formularios. La navegación no
  descarta otros campos silenciosamente al guardar una sección.
- Procedimientos: huella + revisión y transacción, sin sobrescritura forzada.
- Pagos, estados, edición y entrega: revisión de orden, operación idempotente,
  relectura transaccional de propiedad/estado y evento en la misma operación.
- Las operaciones críticas requieren conexión. El indicador distingue caché,
  escrituras pendientes, error y confirmación del servidor para la consulta de órdenes.
- Las reglas nuevas validan transiciones, revisión, pertenencia y relación entre
  espejo público y orden; diario inmutable, pagos con reversos y rutas privadas.
  Las 10 pruebas del emulador pasaron en CI; incluyen competencia de stock y
  escrituras directas maliciosas. Los movimientos exigen autorización, deltas
  exactos y reserva vinculada a orden/evento/lote.
- Se bloqueó la migración de adopción de órdenes sin dueño desde la consola del
  navegador. No asignar propiedad histórica sin respaldo y verificación administrativa.
- Nuevas órdenes y órdenes con operaciones auditadas no se borran físicamente.
- Fotos y firmas legadas siguen en base64 hasta activar/migrar. El backend ya
  implementa Storage privado con copia verificada y retención explícita; todavía
  no se ejecutó una migración productiva. No genera enlaces públicos permanentes.

No es un sistema multi-técnico compartido: el aislamiento sigue siendo por `uid`.
Tampoco es facturación tributaria, contabilidad certificada ni diagnóstico automático.

## Estructura

```text
app/
  index.html / estilos.css         Interfaz y sistema visual claro/oscuro
  app.js                          Orquestación, recepción, impresión y código legado
  dominio.js                      Modelos, guías base y reglas compartidas
  borradores.js                   Procedimientos en memoria de sesión
  ordenes-repositorio.js          Consulta privada y procedimiento transaccional
  taller-dominio.js               Diagnóstico, calidad, dinero y reglas de trabajo
  taller-servicio.js              Casos de uso, transacciones, inventario y consultas
  ficha.js                       Ficha privada, agenda, plantillas e informes
  status.html / status.js          Seguimiento público mínimo
  vendor/                         SDKs servidos desde el propio origen
  sw.js                           PWA y cachés versionadas
firestore.rules / firestore.indexes.json
playwright.config.mjs
tests/                            Unitarias e integración con doble de Firestore
  browser/                        Chromium, UI real con backend de pruebas aislado
  emulator/                       Reglas y transacciones contra Firestore emulado
```

Colecciones:

- `equipos/{id}`: privada por propietario. Las nuevas usan `schemaVersion: 2`;
  no se hace una migración masiva de documentos antiguos.
- `catalogo/{id}`: tarifario privado, con `uid`.
- `seguimiento/{id}`: solo `uid`, `estado`, `modelo`, `actualizado`; get público,
  sin listado ni datos de cliente/diagnóstico/pagos.
- `usuarios/{uid}/clientes`, `/repuestos`, `/plantillas`, `/eventos`, `/pagos`,
  `/config`: datos privados del taller. Las versiones de plantilla son subcolecciones.

## Desarrollo y verificaciones

Recomendado: **Node 22**, Java 21 para emuladores.

```bash
npm ci
npm run serve            # 0.0.0.0:8080; en otra terminal
npm run check            # lint + auditoría estática + 157 pruebas locales
npm run test:rules       # 10 pruebas; Java 21; demo-kryofix, nunca producción
npx playwright install --with-deps chromium webkit
npm run test:backend     # 4 escenarios API/Auth/Storage; requiere npm ci --prefix functions
npm run test:browser     # 15 casos × 5 perfiles; Chromium y WebKit
npm run check:full       # todas las anteriores; falla si cualquier capa falla
```

En CI, Playwright inicia su servidor automáticamente. Para un Chromium ya
instalado se puede usar `KRYOFIX_CHROMIUM=/ruta/al/binario npm run test:browser`.
El entorno de pruebas del navegador no inicia sesión ni escribe en producción.
La prueba de arranque con SDK real bloquea las peticiones de APIs externas.

Firebase 12.19.0 compat, SweetAlert2 11.26.25 y QR 2.0.4 están versionados en
`app/vendor/`. Después de actualizar SDKs: `npm run vendor` y nueva versión de SW.
Se fijan versiones y overrides compatibles de gRPC y undici; ver auditoría y
advertencias transitivas pendientes en `VALIDACION.md`.

## Publicación y compatibilidad

El nombre KryoFix no cambia proyecto/dominio Firebase, repositorio, IDs históricos,
QR ni claves locales. Se mantienen APIs internas `TechFix*` por compatibilidad.

- Calidad/preview/producción dependen de `verificacion.yml`: pruebas locales,
  emulador y navegador. Una falla bloquea el despliegue de hosting.
- Al integrar en `main`, el workflow publica **reglas e índices antes del hosting**
  con la cuenta de servicio ya configurada en GitHub. Esa cuenta debe tener los
  permisos correspondientes; si no los tiene, el workflow falla antes de hosting.
- El preview de PR no modifica reglas del proyecto de producción. Probar los
  flujos nuevos en un proyecto de staging con sus reglas antes de usarlos con datos reales.
- Las reglas nuevas y las operaciones antiguas de clientes abiertos no tienen
  compatibilidad completa de escritura: coordinar la actualización y recarga de
  clientes; respaldar y verificar datos antiguos antes de publicar.
- Ninguna publicación ni migración se ejecutó durante esta implementación.

## Pendiente para puesta en marcha y cierre externo

1. Configurar y validar un proyecto de staging con Auth real, datos legados, dos
   sesiones, índices, IAM, bucket y restauración de respaldo.
2. Elegir el proveedor de mensajería, integrar su adaptador al contrato HTTP y
   probar deduplicación/confirmaciones con un destinatario autorizado. No enviar
   mensajes hasta tener consentimiento y activación explícita.
3. Ejecutar migración por lotes de datos históricos tras respaldo/verificación;
   revisar copias sin referencia y definir política legal de retención.
4. Probar teléfonos/tablets físicos, cámara/teclado real, impresión y PWA instalada.
5. Revisar los 9 avisos de herramientas (7 altos/2 moderados). El backend desplegable
   tiene 0 avisos conocidos en el audit ejecutado, no una garantía de invulnerabilidad.

Las funcionalidades anteriores ya tienen código, UI y pruebas; **no se presentan
como servicios productivos activados**. Compras admiten recepción completa; informes
atómicos limitados a 5000 órdenes/10000 pagos; catálogo técnico no exhaustivo. Ver
VALIDACION.md y DESPLIEGUE.md para alcance y resultados exactos.
