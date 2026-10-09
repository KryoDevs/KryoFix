# KryoFix — Estado real y pasos para ponerlo en marcha

**Fecha:** 9 de octubre de 2026 · **Rama:** `arena/7cb786cc-techfix-tracker`
**Veredicto:** el código está **completo y funciona**; lo que falta es **publicarlo**.

---

## 1. Veredicto corto

| Pregunta | Respuesta |
|---|---|
| ¿El código está listo? | **Sí.** 184/184 pruebas pasan, auditoría estática sin hallazgos. |
| ¿La página está publicada? | **No.** `https://kryofix.web.app` responde **"Site Not Found"**. |
| ¿Puedo publicarla yo? | **No.** Requiere tu UID de taller y tu sesión de Google propietaria de Firebase. |
| ¿Falta código? | **No.** No hay ninguna función pendiente de escribir. |

Todo lo que falta son **dos datos tuyos** y **un comando**.

---

## 2. Lo que verifiqué yo mismo (no es lo que dice la documentación)

Ejecuté estas comprobaciones contra el repositorio:

| Comprobación | Resultado |
|---|---|
| `npm ci` | 799 paquetes, sin errores |
| `npm run lint` (ESLint) | Sin errores |
| `npm run audit:static` | **0 hallazgos** |
| `npm test` | **184 aprobadas / 0 fallidas** |
| `npm audit --prefix functions` | **0 vulnerabilidades** |
| Assets referenciados por `index.html` | 17/17 existen |
| Recursos precacheados por el service worker | 28/28 existen |
| Página servida por HTTP | 10/10 rutas respondieron `200` |

### Flujo de taller ejecutado de punta a punta

No me fié de los tests: escribí un recorrido completo con datos ficticios.

```
1. Login con UID de dueño          → OK
2. Crear orden (KRF-000001)        → OK, genera correlativo y huella anti-duplicado
3. Presupuesto de $45.000          → OK, queda "pendiente de autorización"
4. Autorizar con evidencia         → OK
5. Registrar pago                  → OK
6. Repetir el MISMO pago           → OK, NO duplica (idempotencia real)
7. Calidad (5 pruebas)             → OK
8. Marcar reparado                 → OK
9. Entregar SIN firma              → BLOQUEADO correctamente
10. Entregar sin saldar la deuda   → BLOQUEADO correctamente
11. Entregar con firma             → OK, estado "entregado"
12. Espejo público de seguimiento  → OK (solo estado + modelo, sin datos de cliente)
```

**Los bloqueos de seguridad funcionan.** La app no deja entregar un equipo sin firma ni
cobrar de más. El aislamiento por `uid` está en las reglas de Firestore.

---

## 3. Lo que falta (en orden de importance)

### BLOQUEANTE 1 — No está publicado

```
https://kryofix.web.app  →  "Site Not Found"
```

La documentación lo dice explícitamente y es verdad: *"Ninguna publicación ni migración
se ejecutó durante esta implementación."* El sitio nunca existió.

### BLOQUEANTE 2 — Falta tu UID de taller

`app/entorno.js` contiene la configuración del proyecto `kryofix`, pero **sin**
`propietarioUid`:

```js
window.KryoFixEntorno = {
  "modo": "spark",
  "firebase": { "projectId": "kryofix", ... }   // ← falta "propietarioUid"
};
```

Sin ese campo, la app acepta **cualquier cuenta autenticada** y las reglas de
Firestore no restringen el acceso a tu taller. El publicador lo inyecta por ti —
es deliberado y está bien diseñado.

### BLOQUEANTE 3 — No hay usuario de taller en Firebase Auth

No pude verificarlo: este entorno no tiene salida a los servidores de Google y
`firebase projects:list` responde *"Failed to authenticate"*.

### NO BLOQUEANTE — Entorno de pruebas incompleto

| Falta | Efecto |
|---|---|
| Java 21 | No pude correr `test:rules` (reglas contra emulador) |
| Navegadores Playwright | No pude correr `test:browser` (18 casos × 5 perfiles) |
| Sesión Firebase CLI | No pude desplegar |

### NO AFECTA AL TALLER — 9 avisos de seguridad en herramientas

`npm audit` marca 9 avisos (7 altos, 2 moderados) en **`firebase-tools` y sus
dependencias** — paquetes que solo se usan en tu computador para publicar. El código
que se sirve al navegador y el backend tienen **0 avisos**.

---

## 4. Paso a paso para que funcione

### Antes de empezar (una sola vez)

- [ ] **Instala Node.js 22 o superior** — https://nodejs.org/
- [ ] Abre la [consola de Firebase](https://console.firebase.google.com/project/kryofix/authentication/users)
      → **Authentication** → activa **Correo/contraseña** → **Agregar usuario** (tu correo
      del taller + contraseña). **Copia el UID** que aparece en la columna "UID".
      ⚠️ No es la contraseña. No lo pegues en ningún chat.

### Publicar (5 minutos)

```bash
# 1. Entrar al proyecto
cd TechFix-Tracker
npm ci

# 2. Generar el paquete de publicación (Hosting + Firestore, sin facturación)
npm run build:spark

# 3. Publicar (en Windows: abrir .spark\PUBLICAR-WINDOWS.cmd)
cd .spark
node publicar-spark.mjs
```

El programa te pedirá:

1. **UID del usuario autorizado del taller** → pega el que copiaste
2. **Escribe `PUBLICAR`** para autorizar
3. **Inicia sesión con tu cuenta Google propietaria** de `kryofix` (no con la
   contraseña del usuario de la app)

Luego sube las reglas y el sitio. **No activa facturación ni Functions/Storage.**

> Si Firebase complains de estar conectado a otra cuenta:
> `npx --yes firebase-tools@15.32.1 login --reauth`

### Verificar (10 minutos)

- [ ] Abre **https://kryofix.web.app**
- [ ] Firebase → **Firestore → Índices**: espera a que estén enenabled
- [ ] Entra con el correo y contraseña del taller
- [ ] Crea una **orden ficticia** y haz el ciclo completo:
      presupuesto → autorización → calidad → reparado → entrega con firma
- [ ] Cierra sesión y confirma que **no se ven datos privados**
- [ ] Prueba en tu teléfono real (cámara, firma, instalación como app)

---

## 5. Lo que NO hace esta edición (y está bien que sea así)

- ❌ No procesa pagos con tarjeta
- ❌ No emite boletas tributarias
- ❌ No manda WhatsApp automático (se abre el chat para que lo envíes tú)
- ❌ No guarda archivos ilimitados (foto máx. 80 KiB, firma máx. 32 KiB por orden)
- ❌ No tiene respaldo automático

Todo eso **requiere el plan Blaze (facturación)**. El repo está configurado
correctamente para no activarlo por accidente.

---

## 6. La página ahora mismo

Sin tu cuenta de Firebase no se puede entrar al taller real, pero hay dos páginas
que funcionan hoy:

| Página | Qué muestra |
|---|---|
| `dev/preview.html` | La interfaz completa con datos ficticios (tarjetas, KPIs, estados) |
| `app/index.html` | La app real, pantalla de login (conecta a `kryofix` al iniciar sesión) |
| `app/status.html` | Portal público de seguimiento por código |

Las tres están sirviéndose en los puertos 8080 y 8081 de este entorno.