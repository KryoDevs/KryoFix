# KryoFix — Mejoras de prioridad alta y media (octubre 2026)

**Estado:** 235/235 pruebas · lint limpio · auditoría estática sin hallazgos.
Las 9 ideas del plan anterior están implementadas y probadas.

---

# Alta prioridad

## A. Respaldo del taller — botón **💾 Respaldo**

El mayor riesgo anterior era perder datos sin forma de recuperarlos. El CSV
antiguo solo exportaba **lo que se veía en pantalla**.

Ahora un botón genera un JSON con **todo**: recorre todas las órdenes por
páginas del servidor e incluye pagos, clientes, repuestos, compras, movimientos
de inventario y plantillas.

Copia literal de lo que descarga:

> Copia de datos de tu taller. Contiene datos personales de clientes y, si
> existen, PIN y firmas. Guárdalo en un lugar privado.

**Lo que sigue sin resolverse** (y conviene decirlo): un archivo descargado en
el navegador no es un respaldo verificado. Si cierras la pestaña antes de elegir
la carpeta, se pierde. El respaldo automático programado requiere Blaze.

## B. La búsqueda entra en la ficha

Antes solo miraba la tarjeta. Ahora busca también en **diagnóstico, notas,
presupuesto, garantía e historial**, incluidos los arrays anidados (conceptos de
presupuesto, pasos de procedimiento, resúmenes de evento).

Si escribes varios términos y **casi** todos coinciden, avisa
*"1 orden coincide con casi todos los términos escritos"* en vez de un
"sin resultados" mudo.

## C. Cliente frecuente con un toque

En el formulario de recepción aparecen hasta 6 clientes frecuentes como botones.
Ordenados por **recencia y visitas**, no alfabéticamente: un cliente que vino
hace 400 días no es frecuente hoy aunque haya venido 9 veces.

Un toque rellena nombre y teléfono.

## D. Panel "🎯 Qué ataco hoy"

Responde la pregunta operativa que faltaba. Cada punto es una acción con su
cuenta:

- 🔴 **Cobrar saldo en equipos ya entregados** — es dinero que ya no está en el taller
- **Presupuesto aprobado y saldo sin cobrar**
- **Listos hace más de 30 días, esperando retiro**
- 🔴 **Garantías vencidas o por vencer**
- **Órdenes activas con saldo pendiente**

Una orden nunca aparece en dos listas. Si no hay nada pendiente, el panel se
oculta en vez de mostrar ceros.

## H. Fusión de clientes duplicados

"Juan Pérez" y "J. Perez" con el mismo teléfono quedaban separados para siempre,
con el historial partido.

Ahora **detecta** los casos probables (mismo teléfono en los últimos 9 dígitos, o
nombre casi idéntico tras normalizar tildes) y **propone** fusionarlos. Nunca
fuse solo: el técnico elige cuál se conserva y confirma leyendo qué se absorbe.

Al fusionar:

- Las órdenes del cliente absorbido pasan al conservado
- El nombre alternativo se guarda como **alias** (no se pierde nada escrito)
- Todos los teléfonos quedan registrados
- Se guarda un **registro de auditoría** con qué se absorbió y por qué

Reglas de Firestore nuevas: la reasignación solo puede tocar `clienteId` y
`clienteFusionDe` — **no puede alterar estado, dinero, diagnóstico ni firma**.
El cliente conservado no puede cambiar de nombre. Ningún cliente se borra sin que
exista el registro de fusión.

---

# Media prioridad

## E. Garantía vencida visible

La garantía ya no se esconde dentro de la ficha. Aparece:

- En la tarjeta: 🔒 *Garantía vencida hace 35 días*
- En el panel de prioridades, en rojo cuando está vencida

## F. Cuándo se movió cada orden

Cada tarjeta muestra *Actualizada hoy / ayer / hace N días*. Permite ver de un
vistazo qué órdenes se tocaron, sobre todo cuando trabajan dos personas.

## G. Comprobante en PDF

Acción **Guardar como PDF** que abre el diálogo de impresión con el comprobante
listo. No depende de una librería externa ni de los estilos de impresión del
navegador.

## I. Modo sin conexión explicativo

Aquí fui deliberadamente conservador. **No** implementé escrituras sin red: eso
exige resolución de conflictos y puede duplicar pagos o perder una entrega. Es un
cambio arquitectónico grande con riesgo real de dinero.

Lo que sí se hizo es que el modo offline sea **honesto**: un panel indica qué
sigue funcionando (consultar, imprimir, preparar borradores), qué queda en
espera (pagos, estados, entregas) y avisa específicamente si hay **borradores sin
guardar** que se perderían al cerrar la pestaña.

---

# Bugs reales encontrados de paso

| Hallazgo | Corrección |
|---|---|
| `resumirObjeto` descartaba los arrays | "Cambio de pantalla" **no era buscable** dentro del presupuesto |
| El doble de pruebas no tenía `tx.delete` | La fusión no se podía probar |
| Los documentos del doble no traían `.ref` | Código que reasigna documentos nunca se ejercitó |
| `tx.getAll` no soportado | Se unificó con `Promise.all`, como el resto del código |

---

# Verificación

| Capa | Resultado |
|---|---|
| ESLint | Sin errores |
| Auditoría estática | 0 hallazgos |
| Pruebas | **235 aprobadas / 0 fallidas** |
| Reglas de Firestore | Llaves balanceadas, reglas de fusión añadidas y acotadas |
| Assets y scripts | Todos existen |
| Service worker | v21 (limpia la versión anterior) |

**Pendiente de verificación externa:** las reglas nuevas de fusión necesitan
correrse contra el emulador de Firestore (requiere Java 21) antes de confiar en
ellas con datos reales. Fue algo que no pude ejecutar aquí.

---

Al publicar, **Ctrl+Shift+R**: sin eso el service worker puede mostrar la
versión anterior.