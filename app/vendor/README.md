# app/vendor — dependencias de terceros servidas desde el propio origen

Estos archivos **no son código del proyecto**: son las dependencias de ejecución
copiadas tal cual desde paquetes npm publicados. Se sirven desde el mismo origen
(en vez de un CDN) por tres razones:

1. **Funcionamiento sin conexión real.** El service worker precachea los
   archivos del proyecto; si las librerías vivieran en un CDN, un primer arranque
   sin red mostraba `firebase is not defined` y pantalla en blanco.
2. **Seguridad.** Un CDN comprometido podría ejecutar código arbitrario en una
   página que maneja datos personales de clientes. Con `script-src 'self'` en la
   Content-Security-Policy eso es imposible.
3. **Redes restrictivas.** Talleres con firewall corporativo o DNS filtrado
   dejaban de cargar `gstatic.com` / `jsdelivr.net`.

## Contenido y versiones

| Archivo | Origen | Versión |
|---------|--------|---------|
| `firebase-app-compat.js` | `firebase/firebase-app-compat.js` | 10.14.1 |
| `firebase-auth-compat.js` | `firebase/firebase-auth-compat.js` | 10.14.1 |
| `firebase-firestore-compat.js` | `firebase/firebase-firestore-compat.js` | 10.14.1 |
| `sweetalert2.all.min.js` | `sweetalert2/dist/sweetalert2.all.min.js` | 11.26.25 |
| `qrcode.js` | `qrcode-generator/dist/qrcode.js` | 2.0.4 |

Licencias: Firebase (Apache-2.0), SweetAlert2 (MIT), qrcode-generator (MIT).

## Cómo actualizarlas

Las versiones están fijadas en `devDependencies` (`package.json`) **solo** para
poder copiar los archivos de forma reproducible:

```bash
npm install                       # trae las versiones fijadas a node_modules/
npm run vendor                    # copia los archivos a app/vendor/ y avisa si algo cambio
npm run check                     # lint + auditoria + tests
```

`tools/vendor.mjs` verifica el tamaño y las licencias esperadas, así que un
paquete distinto (o una descarga a medias) falla de forma visible en vez de
romper la app en producción.
