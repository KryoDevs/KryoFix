# KryoFix real en Spark — sin tarjeta ni facturación

## Qué está incluido

Cliente real conectado a tu Firebase `kryofix`: recepción, clientes, diagnóstico,
presupuestos con aprobación registrada manualmente, pagos/reversos, compras,
reservas/consumo/ajustes de inventario, garantías, historial, informes operativos,
comprobantes imprimibles y seguimiento público mínimo por código QR.
No procesa tarjetas ni emite documentos tributarios del SII.

Fotos: una evidencia comprimida de hasta **80 KiB por orden**, firma hasta **32 KiB**.
Ambas permanecen privadas en Firestore; también se limita su tamaño desde las
reglas, no solo desde el navegador. No hay archivos ilimitados ni Storage.
WhatsApp se abre para envío manual. No hay mensajes automáticos, aprobación por
link protegido, retención programada ni informes contables atómicos de servidor.
Los controles de esas funciones no aparecen en Spark y las llamadas API se bloquean.

## Publicar hoy desde Windows

1. Instala **Node.js 22 o superior** desde https://nodejs.org/ si no lo tienes.
2. Descarga y **extrae** `KryoFix-Spark.zip` en una carpeta de tu computador.
   No ejecutes el programa dentro del ZIP.
3. En Firebase, proyecto **kryofix** → Authentication → Usuarios, copia el **UID**
   del usuario que creaste para tu taller. No copies la contraseña.
4. Abre `PUBLICAR-WINDOWS.cmd`. Pega el UID cuando lo solicite.
5. Escribe **PUBLICAR** para autorizar el reemplazo de reglas y Hosting de `kryofix`.
6. Firebase abrirá el navegador: inicia sesión **con la cuenta Google propietaria
   del proyecto**, no con la contraseña del usuario de la aplicación. La sesión
   queda en tu computador; no pegues tokens ni claves en el chat.
7. Espera a que Firebase confirme que terminó. Abre **https://kryofix.web.app**.
   Es la dirección esperada del sitio; no implica que ya esté publicado.
8. Entra con el correo y contraseña del usuario del taller. Los otros UID quedan
   bloqueados por las reglas, aunque puedan autenticarse.

Si Firebase ya estaba conectado a otra cuenta Google, ejecuta en esa carpeta
`npx --yes firebase-tools@15.32.1 login --reauth` y elige la cuenta propietaria antes
de repetir la publicación. No compartas el resultado de la autenticación en chat.

Si Windows muestra que no existe `node`, instala Node, cierra la ventana y vuelve
al paso 4. En macOS/Linux: abre terminal en la carpeta extraída y ejecuta
`node publicar-spark.mjs`.

El programa descarga Firebase CLI con npm, solicita autorización y ejecuta solo:
`firebase deploy --project kryofix --only firestore:rules,firestore:indexes,hosting`.
**No activa Blaze ni despliega Functions, Storage o Scheduler.** Si aparece una
petición de facturación, detente y conserva el error; no la autorices.

## Comprobación antes de ingresar clientes

- En Firestore → Índices, esperar que los índices estén habilitados.
- Crear una orden ficticia, guardar diagnóstico, presupuesto y su aprobación manual.
- Crear stock de prueba, reservar/consumir y verificar cantidades.
- Registrar un pago y confirmar que repetir una acción no duplica el registro.
- Registrar calidad, marcar como reparado y entregar con firma.
- Abrir el comprobante, el QR y el historial; comprobar en teléfono y computador.
- Cerrar sesión y verificar que no se ven los datos privados.

Si falla una operación, no la presentes como completada: conserva el mensaje y
revisa el historial antes de reintentar. Si las reglas muestran permiso denegado,
comprueba que el UID publicado corresponde al usuario con el que iniciaste sesión.

## Límites gratuitos y continuidad

Spark tiene cuotas de lecturas, escrituras, almacenamiento y transferencia. Con
imágenes, estas cuotas se consumen más rápido. Superarlas puede bloquear el
servicio; este paquete no activa cobros para superarlas. Vigila **Uso** en Firebase.
No se promete disponibilidad ilimitada ni un número garantizado de órdenes gratis.

La pantalla principal carga 100 órdenes recientes; el historial permite paginar
las anteriores. El informe operativo admite hasta 1000 órdenes y 2000 pagos y
rechaza exceso en vez de mostrar totales incompletos. No es una instantánea atómica:
no registrar movimientos desde otro equipo mientras se obtiene un corte.

Cada ficha permite descargar una copia JSON de esa orden, sus pagos, eventos,
foto y firma. Detecta cambios durante la consulta; no incluye el inventario global
ni todas las órdenes. Puede contener PIN y datos de clientes: guárdala protegida.
Conserva comprobantes y exportaciones en un lugar privado. El CSV de la lista
filtrada no es un respaldo completo de Firestore ni contiene las fotos/firmas.
No hay restauración automática ni respaldo programado en esta edición.
No borrar datos importantes para liberar cuota sin un respaldo verificado.

## Para desarrollar

`npm run build:spark` prepara `.spark/`, sin publicar ni utilizar credenciales.
El paquete queda cerrado a datos privados hasta proporcionar el UID real mediante
el publicador. Nunca usar el `firebase.json` de la raíz para publicar esta edición;
el paquete generado tiene su propia configuración exclusiva de Spark.
Las suites de pruebas usan datos ficticios/emuladores, no el proyecto real.
