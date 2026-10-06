/* Acceso a órdenes: consulta privada y guardado transaccional del procedimiento.
 * Primer corte de extracción: pagos, estados y entrega aún usan el controlador legado.
 */
(function () {
    'use strict';

    function error(codigo, mensaje) { return Object.assign(new Error(mensaje), { code: codigo }); }

    function crear({ db, usuario, enLinea, timestampServidor }) {
        function exigirSesion(uid) {
            if (!usuario() || usuario().uid !== uid) throw error('sesion-cambiada', 'La sesión cambió.');
        }
        return {
            suscribir(uid, limite, recibir, fallo) {
                exigirSesion(uid);
                return db.collection('equipos').where('uid', '==', uid)
                    .orderBy('timestamp', 'desc').limit(limite)
                    .onSnapshot({ includeMetadataChanges: true }, recibir, fallo);
            },
            async guardarProcedimiento({ id, uid, base, guia }) {
                exigirSesion(uid);
                if (!enLinea()) throw error('sin-conexion', 'Conecta a internet para validar y guardar el procedimiento.');
                // Sin fallback a update: eliminaría la protección contra sobrescrituras.
                if (!db.runTransaction) throw error('transaccion-no-disponible', 'No se puede validar el guardado.');
                const ref = db.collection('equipos').doc(id);
                const copia = window.KryoFixBorradores.copiarGuia(guia);
                return db.runTransaction(async transaccion => {
                    exigirSesion(uid); // Firebase puede reejecutar el callback al detectar concurrencia.
                    const snapshot = await transaccion.get(ref);
                    exigirSesion(uid);
                    if (!snapshot.exists) throw error('not-found', 'La orden ya no existe.');
                    const orden = snapshot.data();
                    if (orden.uid !== uid) throw error('permission-denied', 'No puedes modificar esta orden.');
                    if (orden.estado === 'entregado') throw error('orden-entregada', 'La orden fue entregada. Conservamos tu borrador, pero no se puede guardar.');
                    if (window.KryoFixBorradores.huella(orden.procedimiento) !== base) {
                        throw error('conflicto', 'Otra sesión cambió el procedimiento. Revisa ambas versiones antes de continuar.');
                    }
                    const procedimiento = { ...copia,
                        revision: (Number(orden.procedimiento?.revision) || 0) + 1,
                        actualizado: timestampServidor(), por: uid };
                    transaccion.update(ref, { procedimiento });
                    return procedimiento;
                });
            }
        };
    }

    window.KryoFixOrdenes = { crear };
})();
