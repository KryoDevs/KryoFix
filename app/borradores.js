/* Borradores privados de procedimientos. Solo memoria de esta sesión, nunca Storage.
 * No acepta órdenes completas: evita copiar PIN, fotos, firmas o datos del cliente.
 */
(function () {
    'use strict';

    function copiarGuia(guia) {
        return {
            tipo: guia.tipo, titulo: guia.titulo, version: guia.version,
            ...(guia.plantillaId ? { plantillaId: guia.plantillaId, fuente: guia.fuente || '' } : {}),
            pasos: (Array.isArray(guia.pasos) ? guia.pasos : []).map(p => ({ texto: String(p?.texto || ''), completado: !!p?.completado }))
        };
    }

    // Orden de claves estable; independiente del orden de serialización de Firestore.
    function huella(guia) {
        if (!guia) return 'null';
        return JSON.stringify({ ...copiarGuia(guia), revision: guia.revision || 0 });
    }

    function crear(crearGuia) {
        const entradas = new Map();
        const copiarRemoto = remoto => remoto ? { ...copiarGuia(remoto), revision: remoto.revision || 0 } : null;
        function obtener(id, remoto) {
            let entrada = entradas.get(id);
            if (!entrada) {
                entrada = { guia: copiarGuia(remoto || crearGuia()), base: huella(remoto),
                    sucio: false, guardando: false, confirmando: false, conflicto: false,
                    error: '', abierto: false, remoto: copiarRemoto(remoto) };
                entradas.set(id, entrada);
            } else {
                entrada.remoto = copiarRemoto(remoto);
                if (!entrada.guardando && entrada.base !== huella(remoto)) {
                    if (entrada.sucio) entrada.conflicto = true;
                    else {
                        entrada.guia = copiarGuia(remoto || crearGuia());
                        entrada.base = huella(remoto);
                        entrada.error = '';
                    }
                }
            }
            return entrada;
        }
        return {
            obtener,
            recordarApertura(id, abierto) {
                const entrada = entradas.get(id);
                if (entrada) entrada.abierto = abierto;
            },
            vigente: (id, entrada) => entradas.get(id) === entrada,
            editar(entrada) { entrada.sucio = true; entrada.error = ''; },
            aceptar(entrada, remoto) {
                entrada.guia = copiarGuia(remoto || crearGuia());
                entrada.remoto = copiarRemoto(remoto);
                entrada.base = huella(remoto);
                entrada.sucio = false;
                entrada.conflicto = false;
                entrada.error = '';
            },
            pendientes: () => [...entradas.values()].filter(e => e.sucio || e.guardando),
            limpiar: () => entradas.clear()
        };
    }

    window.KryoFixBorradores = { crear, huella, copiarGuia };
})();
