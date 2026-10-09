# KryoFix — No puedo iniciar sesión

> ## ⚡ Diagnóstico aplicado el 9 de octubre de 2026
>
> El diagnóstico de la consola dio **`LOGIN OK`**. La contraseña **sí es correcta**
> y el proveedor **sí está habilitado**.
>
> El problema real es que **los dos UID no coinciden**:
>
> | | UID |
> |---|---|
> | Con el que inicias sesión | `n6o8TUgbOJP2O9yYLqeRmHjPEUE3` |
> | Con el que se publicó el sitio | `WuwekSPQ8NXJQfC5dudISPB08xBc3` |
>
> La app comparaba esos valores y cerraba la sesión al instante
> ("Cuenta no autorizada"), sin decir cuál de los dos era el correcto.
>
> **Solución:** vuelve a publicár indicando el UID de la tabla.
> Ver [Paso 3](#paso-3--solución-del-uid) más abajo.

---

Diagnóstico en 60 segundos. **No pegues tu contraseña en ningún chat**;
los pasos se hacen en tu propio navegador.

---

## Paso 1 — Averigua el error real

1. Abre `https://kryofix.web.app`
2. Presiona `F12` → pestaña **Consola**
3. Pega esto y presiona Enter (el navegador te pedirá el correo y la clave
   en dos ventanas; es normal):

```js
(async () => {
  const correo = prompt('Correo del taller:');
  const clave = prompt('Contraseña:');
  try {
    const r = await firebase.auth().signInWithEmailAndPassword(correo, clave);
    console.log('✅ LOGIN OK · UID =', r.user.uid);
    console.log('🔒 UID publicado en el sitio:', window.KryoFixEntorno.propietarioUid || '(NO CONFIGURADO)');
  } catch (e) {
    console.log('❌ ERROR =', e.code);
    console.log('   detalle =', e.message);
  }
})()
```

Copia lo que imprima y compártelo **sin la contraseña**.

---

## Paso 2 — Qué significa cada resultado

| Lo que imprime | Qué pasa | Cómo se arregla |
|---|---|---|
| `auth/operation-not-allowed` | **El proveedor no está habilitado.** Es la causa más común. | Firebase → Authentication → **Sign-in method** → activa **Correo/contraseña** |
| `auth/invalid-credential` | Correo o contraseña incorrectos | Revisa con el usuario en Authentication → Usuarios |
| `auth/user-not-found` | Ese correo no existe | Crea el usuario en Authentication → Usuarios |
| `auth/user-disabled` | La cuenta está deshabilitada | Habilítala en la lista de usuarios |
| `auth/invalid-api-key` | La configuración apunta a otro proyecto o la clave se revocó | Revisar `app/entorno.js` |
| `auth/unauthorized-domain` | Falta autorizar el dominio | Authentication → **Settings** → Authorized domains → agrega `kryofix.web.app` |
| `auth/too-many-requests` | **Cuenta bloqueada temporalmente** por intentos fallidos | Espera 10-15 minutos. No sigas reintentando |
| `auth/network-request-failed` | Sin internet o bloqueador | Revisa tu conexión / bloquea de publicidad |

---

## Paso 3 — Solución del UID

Si **sí entras** pero la app te echa y muestra *"Cuenta no autorizada"*,
significa que iniciaste sesión con un usuario **distinto** al que declaraste
al publicar. Compara lo que imprimió el paso 1:

```
✅ LOGIN OK · UID = abc123...
🔒 UID publicado en el sitio: xyz789...
```

Si **no coinciden**, tienes dos opciones:

**Opción A — usar el usuario correcto**: entra en Firebase →
Authentication → Usuarios y usa la cuenta cuyo UID publicaste.

**Opción B — cambiar el UID publicado** (lo habitual): vuelve a ejecutar el
publicador indicando el UID del usuario con el que te\logas.

```bash
npm run build:spark
cd .spark
node publicar-spark.mjs
```

El publicador ahora **muestra el UID guardado y cuántos caracteres tiene**,
para comparar con la consola de Firebase antes de desplegar:

```
UID guardado en app/entorno.js: n6o8TUgbOJP2O9yYLqeRmHjPEUE3 (28 caracteres)
```

> No copies el UID a mano desde una captura. Pégalo desde la consola de
> Firebase o selecciónalo con el cursor: son 28 caracteres y basta uno mal
> para quedar fuera del sistema.

---

## Paso 4 — Checklist en la consola de Firebase

Antes de reintentar, confirma esto en
[console.firebase.google.com/project/kryofix](https://console.firebase.google.com/project/kryofix):

- [ ] **Authentication** está habilitado en la barra superior
- [ ] **Sign-in method** → **Correo/contraseña** dice *"Habilitado"*
- [ ] **Usuarios** → existe tu correo y **no está deshabilitado**
- [ ] Copiaste el UID de la columna **UID** (no es el correo ni la contraseña)
- [ ] Si usaste "Olvidé mi contraseña", el correo de recuperación está en la lista

---

## Aviso de tu captura de pantalla

Lo que aparece en la consola —

```
Firestore (12.19.0): enableIndexedDbPersistence() will be deprecated...
```

— **no es el error**. Es una advertencia del SDK de Firebase sobre una función
que seégerá a cambiar, y la app la usa a propósito para guardar datos sin
conexión. No impide iniciar sesión.

El único indicador útil en tu captura es el `⚠ 1`: **cero errores**.
Eso significa que la app cargó bien y se conectó a Firebase. El problema está
solo en las credenciales o en la configuración de Authentication.

---

## Nota sobre cambios de versión

La app guarda una copia en caché para funcionar sin internet. Después de
publicar un arreglo, la primera carga puede mostrar la versión anterior.

Si el mensaje de error sigue siendo "Credenciales incorrectas" después de
republicar, fuerza la recarga:

- Escritorio: `Ctrl` + `Shift` + `R`
- Celular: vacía la caché del sitio desde los ajustes del navegador