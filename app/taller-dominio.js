/* Reglas puras de trabajo de KryoFix. No red, no DOM ni diagnóstico automático. */
(function () {
    'use strict';
    const PRUEBAS = ['pantalla', 'carga', 'audio', 'camaras', 'conectividad'];
    const fallo = mensaje => { throw new Error(mensaje); };
    function texto(valor, max = 500) { return String(valor ?? '').trim().slice(0, max); }
    function dinero(valor) {
        const n = Number(valor);
        if (!Number.isSafeInteger(n) || n < 0 || n > 100000000) fallo('Usa montos enteros entre 0 y 100.000.000 CLP.');
        return n;
    }
    function cantidad(valor) {
        const n = Number(valor);
        if (!Number.isSafeInteger(n) || n < 1 || n > 10000) fallo('La cantidad debe ser un entero entre 1 y 10.000.');
        return n;
    }
    function calidadAprobada(c) {
        return !!c && PRUEBAS.every(k => c[k] === 'correcto' || (c[k] === 'no-aplica' && texto(c.excepcion).length >= 5));
    }
    function autorizado(p) {
        if (!p.presupuesto) return p.schemaVersion < 2 || !p.schemaVersion || Number(p.costo || 0) === 0;
        return p.presupuesto.autorizacion?.estado === 'aprobado' && p.presupuesto.autorizacion.version === p.presupuesto.version;
    }
    function guiaDiagnostico(d) {
        if (d?.riesgo === 'si') return 'Detener pruebas de alimentación: no cargar, encender ni aplicar calor. Evaluación por personal capacitado y protocolo de seguridad.';
        if (d?.riesgo !== 'no') return 'Primero inspecciona humedad, batería y temperatura. No energices hasta descartar riesgos.';
        if (d?.sintoma === 'carga') return d.cable === 'correcto' ?
            'Cable y cargador comprobados. Inspeccionar el puerto sin objetos metálicos y documentar resultados antes de intervenir.' :
            'Comprobar cable y cargador compatibles conocidos como funcionales; registrar el resultado. No asumir que el puerto requiere reemplazo.';
        return 'Registrar pruebas no destructivas y resultados; confirmar causa y autorización antes de reparar. Consultar manual de la variante exacta.';
    }
    function fechaRegistro(registro) {
        const confirmado = registro.confirmado;
        return confirmado && typeof confirmado.toDate === 'function' ? confirmado.toDate() : new Date(confirmado ?? registro.en);
    }
    function resumenFinanciero(p) {
        return { presupuestado: Number(p.costo) || 0, cobrado: Number(p.abono) || 0,
            pendiente: Math.max(0, (Number(p.costo) || 0) - (Number(p.abono) || 0)) };
    }
    function siguienteAccion(p) {
        if (p.estado === 'entregado') return resumenFinanciero(p).pendiente ? 'Cobrar saldo pendiente' : 'Orden finalizada';
        if (p.diagnostico?.riesgo === 'si') return 'Evaluar riesgo antes de energizar';
        if (p.presupuesto && !autorizado(p)) return 'Solicitar autorización del presupuesto';
        if (p.schemaVersion >= 2 && Number(p.costo) > 0 && !p.presupuesto) return 'Preparar presupuesto para autorización';
        if (p.estado === 'repuesto') return 'Revisar disponibilidad de repuesto';
        if (p.estado === 'reparado') return 'Coordinar retiro y revisar saldo';
        if (p.diagnostico?.causa) return calidadAprobada(p.calidad) ? 'Confirmar reparación y estado' : 'Completar pruebas finales';
        return 'Registrar diagnóstico y pruebas';
    }
    function aplicar(p, accion, datos, contexto) {
        const { ahora, uid, opId } = contexto;
        const parche = {};
        let resumen = '';
        let pago = null;
        const activa = () => { if (p.estado === 'entregado') fallo('La orden está entregada y no se puede modificar su reparación.'); };
        const registrarPago = (monto, medio, motivo, reversaDe = null) => {
            const apertura = p.finanzas?.apertura ?? (Number(p.abono) || 0);
            const saldo = (Number(p.abono) || 0) + monto;
            if (saldo < 0 || saldo > Number(parche.costo ?? p.costo ?? 0)) fallo('El pago o reverso deja un saldo inválido.');
            pago = { id: opId, monto, medio: texto(medio, 50), motivo: texto(motivo), reversaDe, en: ahora, por: uid };
            parche.finanzas = { apertura, origenApertura: p.finanzas?.origenApertura || 'Abonos anteriores sin fecha/medio verificables' };
            parche.abono = saldo;
        };
        switch (accion) {
            case 'plantilla':
                activa();
                if (!datos.plantilla || !Array.isArray(datos.plantilla.pasos)) fallo('Plantilla no disponible.');
                parche.procedimiento = { tipo: datos.plantilla.tipo, titulo: datos.plantilla.titulo,
                    fuente: datos.plantilla.fuente || '', version: datos.plantilla.version, plantillaId: datos.plantillaId,
                    revision: (p.procedimiento?.revision || 0) + 1, actualizado: ahora, por: uid,
                    pasos: datos.plantilla.pasos.map(texto => ({ texto, completado: false })) };
                resumen = 'Plantilla aplicada: ' + datos.plantilla.titulo + ' v' + datos.plantilla.version + '; avance reiniciado';
                break;
            case 'diagnostico':
                activa();
                if (!['si', 'no', 'pendiente'].includes(datos.riesgo)) fallo('Indica la evaluación de riesgos.');
                parche.diagnostico = { sintoma: texto(datos.sintoma, 60), riesgo: datos.riesgo,
                    cable: ['correcto', 'falla', 'pendiente'].includes(datos.cable) ? datos.cable : 'pendiente',
                    pruebas: texto(datos.pruebas, 1500), hipotesis: texto(datos.hipotesis), causa: texto(datos.causa),
                    variante: texto(datos.variante, 100), en: ahora, por: uid };
                resumen = 'Diagnóstico y pruebas registrados';
                break;
            case 'calidad':
                activa();
                parche.calidad = { excepcion: texto(datos.excepcion), en: ahora, por: uid };
                for (const k of PRUEBAS) {
                    if (!['correcto', 'falla', 'pendiente', 'no-aplica'].includes(datos[k])) fallo('Completa todas las pruebas de calidad.');
                    parche.calidad[k] = datos[k];
                }
                if (PRUEBAS.some(k => datos[k] === 'no-aplica') && texto(datos.excepcion).length < 5) fallo('Justifica las pruebas que no aplican.');
                resumen = 'Control de calidad actualizado';
                break;
            case 'presupuestar': {
                activa();
                if (!Array.isArray(datos.lineas) || !datos.lineas.length || datos.lineas.length > 20) fallo('El presupuesto necesita entre 1 y 20 conceptos.');
                const lineas = datos.lineas.map(l => ({ concepto: texto(l.concepto, 120), cantidad: cantidad(l.cantidad), precio: dinero(l.precio) }));
                if (lineas.some(l => !l.concepto)) fallo('Describe cada concepto del presupuesto.');
                const total = dinero(lineas.reduce((n, l) => n + l.cantidad * l.precio, 0));
                if (total < Number(p.abono || 0)) fallo('Primero registra el reverso correspondiente: el presupuesto no puede ser menor que lo abonado.');
                parche.presupuesto = { version: (p.presupuesto?.version || 0) + 1, lineas, total,
                    condiciones: texto(datos.condiciones, 1000), plazo: texto(datos.plazo, 100), en: ahora,
                    autorizacion: { estado: 'pendiente' } };
                parche.costo = total;
                resumen = 'Presupuesto v' + parche.presupuesto.version + ': ' + total + ' CLP; pendiente de autorización';
                break;
            }
            case 'autorizar':
                activa();
                if (!p.presupuesto || datos.version !== p.presupuesto.version) fallo('Cambió la versión del presupuesto. Revísala antes de autorizar.');
                if (!['aprobado', 'rechazado'].includes(datos.estado) || texto(datos.evidencia).length < 5) fallo('Indica decisión y evidencia de la autorización del cliente.');
                parche.presupuesto = { ...p.presupuesto, autorizacion: { estado: datos.estado, evidencia: texto(datos.evidencia),
                    medio: texto(datos.medio, 50), en: ahora, por: uid, version: datos.version } };
                resumen = 'Presupuesto v' + datos.version + ' ' + datos.estado + ' (registro del técnico)';
                break;
            case 'pago': {
                const monto = dinero(datos.monto);
                if (!monto || !['efectivo', 'transferencia', 'tarjeta', 'otro'].includes(datos.medio)) fallo('Indica monto mayor a cero y medio de pago.');
                registrarPago(monto, datos.medio, datos.motivo || 'Pago recibido');
                resumen = 'Pago recibido: ' + monto + ' CLP';
                break;
            }
            case 'reverso': {
                const original = datos.original;
                if (!original || original.monto <= 0 || original.revertidoPor || texto(datos.motivo).length < 5) fallo('Selecciona un pago sin revertir y explica el motivo.');
                registrarPago(-original.monto, original.medio, datos.motivo, original.id);
                resumen = 'Reverso de pago: ' + original.monto + ' CLP';
                break;
            }
            case 'editar':
                activa();
                parche.cliente = texto(datos.cliente ?? p.cliente, 120);
                parche.telefono = window.TechFixDominio.normalizarTelefono(datos.telefono ?? p.telefono);
                if (!parche.cliente || parche.telefono.length < 8) fallo('Revisa nombre y teléfono.');
                for (const k of ['falla', 'accesorios', 'notas']) parche[k] = texto(datos[k] ?? p[k], k === 'notas' ? 240 : 200);
                parche.prioridad = ['normal', 'alta', 'urgente'].includes(datos.prioridad) ? datos.prioridad : (p.prioridad || 'normal');
                parche.costo = dinero(datos.costo ?? p.costo);
                if (p.presupuesto && parche.costo !== p.costo) fallo('Modifica el presupuesto desde la ficha para conservar versiones y autorización.');
                if (Number(datos.abono ?? p.abono) !== Number(p.abono)) {
                    if (p.finanzas) fallo('Registra pagos o reversos desde la ficha; no sobrescribas el abono acumulado.');
                    registrarPago(dinero(datos.abono) - Number(p.abono || 0), 'otro', 'Ajuste inicial desde editor legado');
                }
                if (Number(parche.abono ?? p.abono) > parche.costo) fallo('El abono no puede superar el presupuesto.');
                resumen = 'Datos de recepción actualizados';
                break;
            case 'estado':
                activa();
                if (!window.TechFixDominio.permiteEstado(p, datos.estado)) fallo('Transición de estado no permitida.');
                if (datos.estado === 'reparado' && p.schemaVersion >= 2) {
                    if (!autorizado(p) || !calidadAprobada(p.calidad)) fallo('Se requiere autorización del presupuesto y control de calidad aprobado.');
                    if (p.diagnostico?.riesgo === 'si') fallo('Resuelve y documenta el riesgo antes de declarar el equipo reparado.');
                }
                parche.estado = datos.estado;
                if (datos.estado === 'reparado' && !p.fechaReparacion) parche.fechaReparacion = ahora;
                resumen = 'Estado: ' + window.TechFixDominio.ESTADO_TEXTO[datos.estado];
                break;
            case 'entregar':
                activa();
                if (!String(datos.firma || '').startsWith('data:image/jpeg;base64,')) fallo('Se requiere firma de entrega.');
                if (p.schemaVersion >= 2 && (p.estado !== 'reparado' || !calidadAprobada(p.calidad))) fallo('Completa las pruebas y marca el equipo listo antes de entregar.');
                if ((p.reservas || []).some(r => r.estado === 'reservada')) fallo('Consume o libera los repuestos reservados antes de entregar.');
                if (datos.saldar && Number(p.costo) > Number(p.abono)) registrarPago(Number(p.costo) - Number(p.abono), 'otro', 'Saldo recibido al entregar con confirmación explícita');
                if (!datos.saldar && Number(p.costo) > Number(p.abono) && p.schemaVersion >= 2 && texto(datos.excepcion).length < 5) fallo('Explica la entrega con saldo pendiente o registra el pago.');
                Object.assign(parche, { estado: 'entregado', pin: '', firmaCliente: datos.firma, fechaEntrega: ahora,
                    fechaReparacion: p.fechaReparacion || ahora, excepcionEntrega: texto(datos.excepcion) });
                resumen = 'Entregado con firma' + (datos.saldar ? ' y saldo recibido' : '');
                break;
            case 'garantia':
                if (p.estado !== 'entregado' || texto(datos.motivo).length < 5) fallo('La garantía se registra sobre una orden entregada, indicando el motivo.');
                parche.garantia = { ...p.garantia, motivo: texto(datos.motivo), resultado: texto(datos.resultado), estado: datos.estado === 'cerrada' ? 'cerrada' : 'abierta', en: ahora, por: uid };
                resumen = 'Caso de garantía ' + parche.garantia.estado;
                break;
            case 'contacto':
                if (!['presupuesto', 'repuesto', 'retiro', 'garantia'].includes(datos.tipo)) fallo('Tipo de contacto inválido.');
                parche.ultimoContacto = { tipo: datos.tipo, en: ahora, por: uid, resultado: texto(datos.resultado) };
                resumen = 'Contacto registrado: ' + datos.tipo + ' (confirmación manual, no entrega automática)';
                break;
            default: fallo('Operación no reconocida.');
        }
        // Un resultado nuevo que invalida la reparación devuelve la orden a revisión.
        // Evita conservar "listo" tras fallar una prueba o cambiar un presupuesto aprobado.
        const despues = { ...p, ...parche };
        if (p.schemaVersion >= 2 && p.estado === 'reparado' && ['calidad', 'diagnostico', 'presupuestar', 'autorizar'].includes(accion)
            && (!calidadAprobada(despues.calidad) || !autorizado(despues) || despues.diagnostico?.riesgo === 'si')) {
            parche.estado = 'revision';
            resumen += ' · vuelve a revisión';
        }
        return { parche, resumen, pago };
    }
    window.KryoFixTallerDominio = { PRUEBAS, texto, dinero, cantidad, calidadAprobada, autorizado,
        guiaDiagnostico, fechaRegistro, resumenFinanciero, siguienteAccion, aplicar };
})();
