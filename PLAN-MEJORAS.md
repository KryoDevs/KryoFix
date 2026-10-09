# KryoFix — Actualización de octubre y plan de pulido

**Rama:** `arena/7cb786cc-techfix-tracker` · **Estado:** 201/201 pruebas, lint y
auditoría estática sin hallazgos.

Este documento separa dos cosas: **lo que ya se corrigió en código** (verificado)
y **lo que se propone mejorar** (ideas priorizadas, no implementadas).

---

# Parte 1 — Cambios ya aplicados

Todos tienen prueba de regresión. Suman **17 pruebas nuevas** (184 → 201).

## 1. El login decía la causa equivocada

**Problema:** la causa más frecuente de "no me deja entrar" —el proveedor de
correo/contraseña sin habilitar en Firebase— caía en el mensaje genérico
*"Credenciales incorrectas"*. El técnico repetía la contraseña hasta que Firebase
le bloqueaba la cuenta (`too-many-requests`).

**Ahora:** cada problema de configuración dice qué hacer. El código real queda en
la consola para diagnosticar.

| Código Firebase | Mensaje mostrado |
|---|---|
| `operation-not-allowed` | "Actívalo en Authentication → Sign-in method" |
| `invalid-api-key` | "La clave no es válida; apunta a otro proyecto" |
| `unauthorized-domain` | "Agrega el dominio en Authorized domains" |
| `project-not-found` | "El proyecto de la configuración no existe" |

Los errores de credenciales **siguen siendo genéricos a propósito**: no se revela
si un correo existe o no.

## 2. "Cuenta no autorizada" era un callejón sin salida

**Problema:** al rechazar un UID, el mensaje decía "inicia sesión con el usuario
correcto" **sin decir cuál era**. Con UIDs de 28 caracteres, comparar a ojo es
imposible. Es exactamente lo que te pasó hoy.

**Ahora:** el mensaje y la consola muestran **ambos UID** lado a lado, y el
publicador confirma qué UID guardó antes de desplegar.

## 3. Buscar "gonzalez" no encontraba "González"

**Problema:** la comparación era literal. En Chile casi nadie escribe la tilde
cuando busca, así que la orden quedaba **escondida**. Además, dos palabras solo
funcionaban en el orden exacto en que estaban guardadas.

```
"gonzalez"   → 0 resultados   ← el bug
"maria gonzalez" → 0 resultados
```

**Ahora:** ignora tildes y mayúsculas, y acepta varios términos en cualquier orden.

| Antes | Ahora |
|---|---|
| `gonzalez` → 0 | → 1 |
| `gonzalez maria` → 0 | → 1 |
| `perez samsung` → 0 | → 1 |

Además, si escribiste varios términos y **casi** todos coinciden, avisa
*"1 orden coincide con casi todos los términos"* en vez de un "sin resultados" seco.

## 4. Los indicadores anunciaban un alcance falso

**Problema:** la interfaz decía *"calculadas sobre las últimas **500** órdenes"*.
Pero en el modo publicado (Spark) el tope real es **100**. El taller podía leer
un saldo parcial creyendo que era el saldo completo.

**Ahora:** el número refleja el modo real, y al llegar al tope aparece un aviso
explícito:

> ⚠ Se alcanzaron 100 órdenes cargadas
> Los indicadores solo cubren esas 100 más recientes. Usa "Gestión del taller" →
> Historial para paginarlas.

## 5. `el()` fallaba en silencio

Herramienta interna que construye el DOM. **Ignoraba la opción `id` sin avisar**:
creaba el elemento sin el atributo y nadie se enteraba hasta que la función que
dependía de él no hacía nada. Me costó una vuelta de depuración encontrarlo.

**Ahora:** una opción desconocida lanza un error explicativo en vez de producir un
nodo invisible.

---

# Parte 2 — Ideas para mejorar (propuestas, no implementadas)

Ordenadas por relación entre beneficio y esfuerzo. **E** = esfuerzo
(S = 1 jornada, M = 3-5).

## Prioridad alta — impacto directo en el trabajo diario

### A. Respaldo: que el taller nunca dependa de una sola copia 🔴 **E: M**

Es el mayor riesgo actual del sistema. Si Firestore pierde datos o alguien
borra una orden equivocada, **no hay forma de recuperar**. Hoy la única defensa
es la exportación manual por ficha.

Propuesta, en orden de madurez:

1. **Exportación completa del taller a un archivo** (CSV + JSON) desde
   "Gestión del taller". Hoy el CSV solo tiene lo que estás viendo en pantalla.
2. **Copia automática semanal** a Google Drive mediante el.rule de Scheduler.
   *Requiere Blaze.*
3. **Aviso visible de "última copia"** en el panel, aunque sea manual.

### B. Búsqueda también dentro de la ficha 🔴 **E: S**

Hoy el buscador solo mira tarjeta, cliente, modelo, falla, IMEI y teléfono.
**No busca en diagnóstico, notas, procedimientos ni historial.** Si el técnico
anotó "la pantalla se agrieta al mojarse" hace tres meses, no lo vuelve a encontrar.

Propuesta: extender los campos indexados y señalar visualmente *dónde* apareció
la coincidencia.

### C. Atajo de "cliente frecuente" en la recepción 🟡 **E: S**

Hoy la reutilización de cliente obliga a escribir el teléfono y esperar el
diálogo de selección. En un taller con clientes que vuelven siempre, lo más útil
sería una lista de los últimos N clientes con un toque.

### D. Vista "mi taller ahora": qué hago primero 🟡 **E: M**

Al abrir la app hoy se ve un tablero de estados. Falta la pregunta operativa:
*"¿qué ataco hoy?"*. Propuesta de un bloque superior con:

- Equipos listos hace más de 30 días (ya existe el aviso, pero escondido)
- Repuestos que llegaron y están esperando ser consumidos
- Presupuestos aprobados sin pagar
- Órdenes con saldo en equipos ya entregados

Esto último es dinero que se deja de cobrar y hoy solo aparece en un KPI.

### E. Recordatorio de garantía por vencer 🟡 **E: M**

Existe el registro de garantías, pero no hay aviso de que una warranty está por
vencer. Un taller pierde plata por no llamar al cliente a tiempo.

## Prioridad media — robustez

### F. Historial de cambios visible en la tarjeta 🟡 **E: M**

El historial existe dentro de la ficha. Poner en la tarjeta un indicador
"modificada hace 2 h por diagnóstico" permitiría detectar de un vistazo qué
órdenes se movieron hoy, especialmente cuando trabajan dos personas.

### G. Exportar a PDF el comprobante 🟢 **E: S**

Hoy el ticket se imprime con `window.print()` y depende de los estilos de
impresión del navegador. Un PDF generado sería más confiable para archivar y
enviar por WhatsApp.

### H. Manejo de clientes duplicados 🔴 **E: M**

La app avisa si comparten teléfono, pero **no sugiere fusionar**. Si "Juan Pérez"
y "J. Pérez" son la misma persona, sus órdenes quedan separadas para siempre,
y el historial queda partido.

### I. Modo "un día de trabajo" sin conexión 🟡 **E: L**

La app guarda datos localmente, pero las operaciones críticas exigen conexión.
Un taller con mala señal no puede trabajar. Permitir cola de operaciones con
resolución de conflictos al reconectar sería una diferencia grande.

## Prioridad baja — calidad de vida

### J. Catálogo técnico ampliable 🟢 **E: M**

El catálogo de modelos es una lista en el código. Cada modelo nuevo del
fabricante requiere cambiar código y republicar. Moverlo a datos editables por
el técnico lo haría crecer sin tocar el sistema.

### K. Atajos de teclado documentados 🟢 **E: S**

Existe el atajo `/` para buscar, pero no está documentado en la interfaz.
Una ayuda visual (`?`) listando atajos reduciría fricción en el uso diario.

### L. Idiomas 🟢 **E: L**

Todo está en español con posible acento Chileno ausente. Si el técnico atiende
clientes de otro origen, un segundo idioma es posible pero **no es prioridad**.

---

# Parte 3 — Qué NO conviene hacer todavía

- **No activar Blaze.** El sistema funciona bien dentro de Spark. Facturación
  solo tiene sentido cuando el respaldo automático (A) lo justifique.
- **No agregar roles ni multi-técnico.** El aislamiento por `uid` es suficiente
  mientras sea un taller. Multiusuario cambia toda la lógica de permisos.
- **No sumar_framework ni bundler.** La app son 10.000 líneas sin build. Funciona.
- **No agregar mensajes automáticos.** Sin proveedor y sin consentimiento
 escrito, es riesgo regulatorio puro.

---

# Parte 4 — Estado verificado

| Capa | Resultado |
|---|---|
| ESLint | Sin errores |
| Auditoría estática | 0 hallazgos |
| Pruebas locales | **201 aprobadas / 0 fallidas** |
| Backend (`functions`) | 0 vulnerabilidades |
| Flujo completo de taller | Verificado de punta a punta |
| Service worker | v20 (cache limpia la versión anterior) |

**Pendiente de verificación externa** (requiere tu equipo o plan de pago):

- Pruebas en teléfono/tableta reales (cámara, firma, teclado virtual)
- Impresión física
- Emuladores de Firestore (requiere Java 21)
- Navegadores reales (Playwright no se instala en este entorno)

---

Al publicar, recuerda **Ctrl+Shift+R**: sin eso el service worker puede mostrarte
la versión anterior.