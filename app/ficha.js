/* Ficha privada y herramientas del taller. Formularios sin HTML interpolado. */
(function () {
    'use strict';
    const D = () => window.KryoFixTallerDominio;
    let campoNumero = 0;
    function nodo(tag, texto, clase) {
        const n = document.createElement(tag);
        if (texto !== undefined) n.textContent = texto;
        if (clase) n.className = clase;
        return n;
    }
    function boton(texto, accion) {
        const b = nodo('button', texto, 'btn-icon'); b.type = 'button'; b.addEventListener('click', accion); return b;
    }
    function campo(form, nombre, etiqueta, opciones = {}) {
        const label = nodo('label', etiqueta, 'ficha-campo');
        const c = nodo(opciones.opciones ? 'select' : opciones.multilinea ? 'textarea' : 'input');
        c.name = nombre;
        c.id = 'ficha-' + nombre + '-' + (++campoNumero);
        label.htmlFor = c.id;
        if (opciones.opciones) for (const [value, text] of opciones.opciones) {
            const o = nodo('option', text); o.value = value; c.appendChild(o);
        }
        else { if (!opciones.multilinea) c.type = opciones.tipo || 'text'; c.maxLength = opciones.max || 500; }
        if (opciones.tipo === 'number') { c.min = opciones.min ?? '0'; c.step = '1'; }
        c.value = opciones.valor ?? (opciones.opciones ? opciones.opciones[0][0] : '');
        if (opciones.requerido) c.required = true;
        label.appendChild(c); form.appendChild(label); return c;
    }
    function crear({ servicio, usuario, alOrden, procedimiento, procedimientoPendiente, alCerrar, urlSeguimiento }) {
        const dialogo = document.getElementById('ficha-dialog');
        const titulo = nodo('h2'); titulo.id = 'ficha-titulo';
        const encabezado = nodo('header', undefined, 'ficha-cabecera');
        const estado = nodo('p', '', 'texto-ayuda'); estado.setAttribute('role', 'status');
        const aviso = nodo('p', '', 'ficha-aviso'); aviso.setAttribute('role', 'status');
        const navegacion = nodo('nav', undefined, 'ficha-pestanas'); navegacion.setAttribute('aria-label', 'Secciones de la ficha');
        const cuerpo = nodo('div', undefined, 'ficha-cuerpo');
        let orden = null, seccion = 'Resumen', sucio = false, ocupado = false, token = 0, ultimoFoco = null;
        const formulariosEditados = new Set();
        const vigente = t => t === token && !!usuario();
        const confirmarDescarte = async () => !sucio || (await window.Swal.fire({ target: dialogo, title: '¿Descartar los cambios de esta sección?',
            text: 'El formulario aún no se guardó. Puedes volver para terminarlo.', icon: 'warning', showCancelButton: true,
            confirmButtonText: 'Descartar', cancelButtonText: 'Volver' })).isConfirmed;
        async function cerrar() {
            if (ocupado || !await confirmarDescarte()) return;
            limpiar();
            if (ultimoFoco?.isConnected) ultimoFoco.focus();
            alCerrar();
        }
        const cerrarBoton = boton('Cerrar ficha', cerrar);
        encabezado.append(titulo, cerrarBoton);
        dialogo.append(encabezado, estado, aviso, navegacion, cuerpo);
        dialogo.addEventListener('cancel', e => { e.preventDefault(); cerrar(); });
        function limpiar() {
            token++; sucio = false; ocupado = false; orden = null; formulariosEditados.clear();
            cuerpo.replaceChildren(); navegacion.replaceChildren(); titulo.textContent = ''; aviso.textContent = ''; estado.textContent = '';
            if (dialogo.close) dialogo.close(); else dialogo.removeAttribute('open');
        }
        function mostrar() {
            ultimoFoco = document.activeElement;
            if (!dialogo.open) { if (dialogo.showModal) dialogo.showModal(); else dialogo.setAttribute('open', ''); }
        }
        async function abrir(id) {
            if (ocupado || !await confirmarDescarte()) return;
            const t = ++token; sucio = false; orden = null;
            mostrar(); cuerpo.replaceChildren(); navegacion.replaceChildren(); titulo.textContent = 'Cargando orden…'; aviso.textContent = '';
            try {
                const p = await servicio.leerOrden(usuario().uid, id);
                if (!vigente(t)) return;
                orden = p; alOrden(p); seccion = 'Resumen';
                window.history.replaceState(null, '', '#orden=' + encodeURIComponent(id));
                await dibujar();
            } catch (e) { if (vigente(t)) aviso.textContent = e.message; }
        }
        async function gestion() {
            if (ocupado || !await confirmarDescarte()) return;
            ++token; sucio = false; orden = null; seccion = 'Historial'; mostrar(); await dibujar();
        }
        async function cambiar(nombre) {
            if (ocupado || !await confirmarDescarte()) return;
            sucio = false; seccion = nombre; await dibujar();
        }
        function formulario(etiqueta, enviar) {
            const f = nodo('form', undefined, 'ficha-form');
            f.addEventListener('input', () => { sucio = true; formulariosEditados.add(f); });
            f.addEventListener('change', () => { sucio = true; formulariosEditados.add(f); });
            const acciones = nodo('div', undefined, 'ficha-acciones');
            const submit = nodo('button', etiqueta, 'btn-guardar'); submit.type = 'submit'; acciones.appendChild(submit);
            // La operación conserva el mismo ID al reintentar tras una respuesta de red incierta.
            let opId = servicio.nuevoId();
            f.addEventListener('submit', async e => {
                e.preventDefault();
                if (ocupado || !f.reportValidity()) return;
                if ([...formulariosEditados].some(otro => otro !== f)) { aviso.textContent = 'Hay cambios en otro formulario de esta sección. Guarda ese formulario o recarga para descartarlos antes de continuar.'; return; }
                const t = token;
                ocupado = true; submit.disabled = true; aviso.textContent = 'Validando y guardando en el servidor…';
                const campos = [...f.elements];
                const datos = Object.fromEntries(new FormData(f));
                campos.forEach(c => { c.disabled = true; });
                try {
                    await enviar(datos, opId);
                    if (!vigente(t)) return;
                    sucio = false; aviso.textContent = 'Operación confirmada. Historial actualizado.';
                    opId = servicio.nuevoId();
                    if (orden) { orden = await servicio.leerOrden(usuario().uid, orden.id); if (!vigente(t)) return; alOrden(orden); }
                    ocupado = false; await dibujar(false);
                } catch (err) {
                    if (vigente(t)) aviso.textContent = err.message + ' Tus datos permanecen en el formulario. Si cambias el contenido tras un envío incierto, recarga y revisa el historial primero.';
                } finally {
                    if (vigente(t)) { ocupado = false; campos.forEach(c => { c.disabled = false; }); submit.disabled = false; }
                }
            });
            f.finalizar = () => { f.appendChild(acciones); cuerpo.appendChild(f); };
            return f;
        }
        const ejecutar = (accion, datos, opId) => servicio.ejecutar({ id: orden.id, uid: usuario().uid,
            revision: orden.revisionOrden || 0, accion, datos, opId });
        function info(texto) { cuerpo.appendChild(nodo('p', texto, 'texto-ayuda')); }
        async function dibujar(limpiarAviso = true) {
            const t = ++token;
            if (limpiarAviso) aviso.textContent = '';
            cuerpo.replaceChildren(); navegacion.replaceChildren(); formulariosEditados.clear();
            titulo.textContent = orden ? (orden.idOrden || orden.id) + ' · ' + orden.equipo + ' ' + orden.modelo : 'Gestión del taller';
            estado.textContent = orden ? orden.cliente + ' · ' + window.TechFixDominio.ESTADO_TEXTO[orden.estado] + ' · Revisión ' + (orden.revisionOrden || 0) + ' · ' + D().siguienteAccion(orden) : 'Datos privados de tu cuenta · operaciones con conexión';
            const secciones = orden ? ['Resumen', 'Diagnóstico', 'Procedimiento', 'Calidad', 'Presupuesto', 'Pagos', 'Repuestos', 'Garantía', 'Contacto', 'Historial'] : ['Historial', 'Clientes', 'Inventario', 'Plantillas', 'Informes'];
            for (const nombre of secciones) {
                const b = boton(nombre, () => cambiar(nombre)); b.setAttribute('aria-current', nombre === seccion ? 'page' : 'false'); navegacion.appendChild(b);
            }
            if (orden) cuerpo.appendChild(boton('Recargar versión del servidor', async () => {
                if (ocupado || !await confirmarDescarte()) return;
                const id = orden.id; sucio = false; await abrir(id);
            }));
            try {
                if (!orden) { await herramientas(t); return; }
                if (seccion === 'Resumen') {
                    info('Síntoma de recepción: ' + (orden.falla || 'Sin detalle'));
                    info('Diagnóstico confirmado: ' + (orden.diagnostico?.causa || 'Pendiente; una sugerencia no confirma la causa.'));
                    info('Próxima acción: ' + D().siguienteAccion(orden));
                    info('Saldo: ' + window.TechFixDominio.formatearCLP(D().resumenFinanciero(orden).pendiente));
                    info('Variante: ' + (orden.diagnostico?.variante || 'Por verificar antes de elegir repuestos.'));
                    const f = formulario('Actualizar prioridad y notas', (d, op) => ejecutar('editar', d, op));
                    campo(f, 'prioridad', 'Prioridad', { valor: orden.prioridad || 'normal', opciones: [['normal', 'Normal'], ['alta', 'Alta'], ['urgente', 'Urgente']] });
                    campo(f, 'notas', 'Notas privadas', { valor: orden.notas || '', multilinea: true, max: 240 }); f.finalizar();
                } else if (seccion === 'Diagnóstico') {
                    const d = orden.diagnostico || {};
                    const f = formulario('Guardar diagnóstico', (datos, op) => ejecutar('diagnostico', datos, op));
                    campo(f, 'variante', 'Variante exacta / código de modelo', { valor: d.variante, max: 100 });
                    campo(f, 'sintoma', 'Síntoma a evaluar', { valor: d.sintoma || orden.problemaComun?.id || 'otro', opciones: [['carga', 'No carga'], ['pantalla', 'Pantalla/táctil'], ['autonomia', 'Autonomía'], ['otro', 'Otro']] });
                    campo(f, 'riesgo', '¿Hay humedad, batería dañada o calor anormal?', { valor: d.riesgo || 'pendiente', opciones: [['pendiente', 'Sin evaluar'], ['si', 'Sí: detener alimentación'], ['no', 'No: inspección realizada']] });
                    campo(f, 'cable', 'Prueba de cable/cargador compatible (solo si es seguro)', { valor: d.cable || 'pendiente', opciones: [['pendiente', 'No probado'], ['correcto', 'Correcto'], ['falla', 'Falla']] });
                    const guia = nodo('p', D().guiaDiagnostico(d), 'ficha-aviso'); f.appendChild(guia);
                    f.addEventListener('change', () => { guia.textContent = D().guiaDiagnostico(Object.fromEntries(new FormData(f))); });
                    campo(f, 'pruebas', 'Pruebas y resultados observados', { valor: d.pruebas, multilinea: true, max: 1500 });
                    campo(f, 'hipotesis', 'Hipótesis pendiente de comprobar', { valor: d.hipotesis, multilinea: true });
                    campo(f, 'causa', 'Causa confirmada (dejar vacía si no se confirmó)', { valor: d.causa, multilinea: true }); f.finalizar();
                } else if (seccion === 'Procedimiento') {
                    cuerpo.appendChild(procedimiento(orden));
                    const plantillas = await servicio.listar(usuario().uid, 'plantillas'); if (!vigente(t)) return;
                    if (plantillas.length) {
                        const base = window.KryoFixBorradores.huella(orden.procedimiento);
                        const f = formulario('Aplicar plantilla y reiniciar pasos', (d, op) => {
                            if (procedimientoPendiente(orden)) throw new Error('Primero guarda o descarta el borrador actual del procedimiento.');
                            return ejecutar('plantilla', { plantillaId: d.plantillaId, baseProcedimiento: base }, op);
                        });
                        campo(f, 'plantillaId', 'Plantilla privada de tu taller', { opciones: plantillas.map(p => [p.id, p.titulo + ' · v' + p.version]) });
                        campo(f, 'confirmar', 'Reemplazar la guía guardada y reiniciar su avance', { opciones: [['no', 'No confirmado'], ['si', 'Confirmo el reemplazo']] });
                        const enviar = f.querySelector('[name="confirmar"]');
                        enviar.required = true;
                        enviar.setCustomValidity('Confirma el reemplazo de la guía.');
                        enviar.addEventListener('change', () => enviar.setCustomValidity(enviar.value === 'si' ? '' : 'Confirma el reemplazo de la guía.'));
                        f.finalizar();
                    }
                } else if (seccion === 'Calidad') {
                    info('Para órdenes nuevas, todas las pruebas deben estar correctas o no aplicar con justificación antes de marcar listo.');
                    const f = formulario('Guardar control de calidad', (d, op) => ejecutar('calidad', d, op));
                    for (const k of D().PRUEBAS) campo(f, k, 'Prueba: ' + k, { valor: orden.calidad?.[k] || 'pendiente', opciones: [['pendiente', 'No probado'], ['correcto', 'Correcto'], ['falla', 'Falla'], ['no-aplica', 'No aplica']] });
                    campo(f, 'excepcion', 'Justificación de pruebas que no aplican', { valor: orden.calidad?.excepcion, multilinea: true }); f.finalizar();
                } else if (seccion === 'Presupuesto') {
                    const p = orden.presupuesto;
                    info(p ? 'Versión ' + p.version + ' · ' + p.autorizacion.estado + ' · ' + window.TechFixDominio.formatearCLP(p.total) : 'No hay presupuesto versionado. El monto de recepción se conserva hasta guardar uno.');
                    const f = formulario('Guardar nueva versión (requiere autorización)', (d, op) => {
                        const lineas = [];
                        for (let i = 0; i < 20; i++) if (d['concepto' + i]?.trim()) lineas.push({ concepto: d['concepto' + i], cantidad: d['cantidad' + i], precio: d['precio' + i] });
                        return ejecutar('presupuestar', { lineas, condiciones: d.condiciones, plazo: d.plazo }, op);
                    });
                    for (let i = 0; i < 20; i++) {
                        const fila = nodo('div', undefined, 'ficha-linea');
                        const l = p?.lineas[i] || {};
                        campo(fila, 'concepto' + i, 'Concepto ' + (i + 1), { valor: l.concepto, max: 120 });
                        campo(fila, 'cantidad' + i, 'Cantidad', { valor: l.cantidad || 1, tipo: 'number', min: 1 });
                        campo(fila, 'precio' + i, 'Precio unitario CLP', { valor: l.precio ?? 0, tipo: 'number' });
                        f.appendChild(fila);
                        if (i >= Math.max(2, p?.lineas.length || 0)) fila.hidden = true;
                    }
                    f.appendChild(boton('Agregar concepto', () => { const fila = f.querySelector('.ficha-linea[hidden]'); if (fila) fila.hidden = false; }));
                    const totalPropuesto = nodo('p', '', 'ficha-aviso');
                    const calcularTotal = () => {
                        let total = 0;
                        for (let i = 0; i < 20; i++) {
                            if (f.elements.namedItem('concepto' + i).value.trim()) total += Number(f.elements.namedItem('cantidad' + i).value) * Number(f.elements.namedItem('precio' + i).value);
                        }
                        totalPropuesto.textContent = 'Total propuesto: ' + window.TechFixDominio.formatearCLP(total) + '. Guardar una versión nueva deja pendiente su autorización.';
                    };
                    f.addEventListener('input', calcularTotal); f.appendChild(totalPropuesto); calcularTotal();
                    campo(f, 'plazo', 'Plazo estimado', { valor: p?.plazo, max: 100 });
                    campo(f, 'condiciones', 'Condiciones y garantía ofrecida', { valor: p?.condiciones, multilinea: true, max: 1000 }); f.finalizar();
                    if (p) {
                        const a = formulario('Registrar decisión del cliente', (d, op) => ejecutar('autorizar', { ...d, version: p.version }, op));
                        campo(a, 'estado', 'Decisión recibida', { opciones: [['aprobado', 'Aprobado'], ['rechazado', 'Rechazado']] });
                        campo(a, 'medio', 'Medio', { opciones: [['presencial', 'Presencial'], ['whatsapp', 'WhatsApp'], ['telefono', 'Teléfono']] });
                        campo(a, 'evidencia', 'Referencia de la autorización: quién, fecha, conversación o documento', { multilinea: true, requerido: true }); a.finalizar();
                        info('Registro manual por el técnico. No es una firma digital del cliente ni un enlace de aprobación pública.');
                    }
                } else if (seccion === 'Pagos') {
                    info('Abono acumulado: ' + window.TechFixDominio.formatearCLP(orden.abono) + ' · Saldo: ' + window.TechFixDominio.formatearCLP(D().resumenFinanciero(orden).pendiente));
                    info('Apertura heredada/recepción sin fecha de cobro verificable: ' + window.TechFixDominio.formatearCLP(orden.finanzas?.apertura ?? orden.abono));
                    const f = formulario('Registrar pago recibido', (d, op) => ejecutar('pago', { ...d, monto: Number(d.monto) }, op));
                    campo(f, 'monto', 'Monto recibido CLP', { tipo: 'number', min: 1, requerido: true });
                    campo(f, 'medio', 'Medio de pago', { opciones: [['efectivo', 'Efectivo'], ['transferencia', 'Transferencia'], ['tarjeta', 'Tarjeta'], ['otro', 'Otro']] });
                    campo(f, 'motivo', 'Referencia / observación', {}); f.finalizar();
                    const pagos = await servicio.listar(usuario().uid, 'pagos', orden.id); if (!vigente(t)) return;
                    const lista = nodo('ul', undefined, 'ficha-lista');
                    for (const pago of pagos.sort((a, b) => b.en - a.en)) {
                        const li = nodo('li', D().fechaRegistro(pago).toLocaleString('es-CL') + ' · ' + window.TechFixDominio.formatearCLP(pago.monto) + ' · ' + pago.medio + (pago.revertidoPor ? ' · Revertido' : ''));
                        lista.appendChild(li);
                    }
                    cuerpo.appendChild(lista);
                    const reversibles = pagos.filter(p => p.monto > 0 && !p.revertidoPor);
                    if (reversibles.length) {
                        const r = formulario('Registrar reverso (no borra el pago)', (d, op) => ejecutar('reverso', d, op));
                        campo(r, 'pagoId', 'Pago a revertir', { opciones: reversibles.map(p => [p.id, window.TechFixDominio.formatearCLP(p.monto) + ' · ' + D().fechaRegistro(p).toLocaleString('es-CL')]) });
                        campo(r, 'motivo', 'Motivo del reverso', { requerido: true }); r.finalizar();
                    }
                } else if (seccion === 'Repuestos') {
                    const stock = await servicio.listar(usuario().uid, 'repuestos'); if (!vigente(t)) return;
                    const compatibles = stock.filter(r => r.modelo.toLowerCase() === orden.modelo.toLowerCase() && r.marca.toLowerCase() === orden.equipo.toLowerCase());
                    if (compatibles.length) {
                        const f = formulario('Reservar repuesto', (d, op) => ejecutar('reservar', { ...d, cantidad: Number(d.cantidad), compatibilidadConfirmada: d.compatibilidad === 'si' }, op));
                        campo(f, 'repuestoId', 'Repuesto / lote', { opciones: compatibles.map(r => [r.id, r.nombre + ' · ' + r.variante + ' · disponible: ' + r.disponible]) });
                        campo(f, 'cantidad', 'Unidades', { tipo: 'number', min: 1, valor: 1 });
                        campo(f, 'compatibilidad', '¿Verificaste la variante exacta y compatibilidad?', { opciones: [['no', 'Pendiente'], ['si', 'Sí, verificada']] }); f.finalizar();
                    } else info('Sin repuestos registrados para esta marca/modelo. Registra el lote comprado en Gestión → Inventario. No se generan compras automáticamente.');
                    const reservas = orden.reservas || [];
                    for (const r of reservas) info(r.nombre + ' × ' + r.cantidad + ' · ' + r.estado);
                    const activas = reservas.filter(r => r.estado === 'reservada');
                    if (activas.length) {
                        const f = formulario('Aplicar movimiento de reserva', (d, op) => {
                            const r = activas.find(r => r.id === d.reservaId);
                            return ejecutar(d.accion, { repuestoId: r.repuestoId, reservaId: r.id }, op);
                        });
                        campo(f, 'reservaId', 'Reserva', { opciones: activas.map(r => [r.id, r.nombre + ' × ' + r.cantidad]) });
                        campo(f, 'accion', 'Movimiento', { opciones: [['consumir', 'Consumir: instalado en la reparación'], ['liberar', 'Liberar: devolver al disponible']] }); f.finalizar();
                    }
                } else if (seccion === 'Garantía') {
                    info('El caso queda asociado a esta orden original. No reabre ni altera la entrega ni sus pagos.');
                    const f = formulario('Registrar seguimiento de garantía', (d, op) => ejecutar('garantia', d, op));
                    campo(f, 'motivo', 'Motivo reportado', { valor: orden.garantia?.motivo, multilinea: true, requerido: true });
                    campo(f, 'resultado', 'Evaluación / solución aplicada', { valor: orden.garantia?.resultado, multilinea: true });
                    campo(f, 'estado', 'Estado del caso', { valor: orden.garantia?.estado || 'abierta', opciones: [['abierta', 'En evaluación'], ['cerrada', 'Caso resuelto']] }); f.finalizar();
                } else if (seccion === 'Contacto') {
                    info('El envío es manual. Abrir WhatsApp no confirma que el mensaje se envió ni que el cliente lo recibió.');
                    const mensaje = 'Hola ' + orden.cliente + ', te contactamos por tu ' + orden.equipo + ' ' + orden.modelo + '. ' +
                        (orden.presupuesto?.autorizacion.estado === 'pendiente' ? 'Presupuesto v' + orden.presupuesto.version + ': ' + window.TechFixDominio.formatearCLP(orden.presupuesto.total) + '. Confírmanos tu decisión. ' : 'Estado: ' + window.TechFixDominio.ESTADO_TEXTO[orden.estado] + '. ') + urlSeguimiento(orden.id);
                    const texto = nodo('p', mensaje); cuerpo.appendChild(texto);
                    cuerpo.appendChild(boton('Abrir mensaje en WhatsApp', () => {
                        const tel = window.TechFixDominio.normalizarTelefono(orden.telefono);
                        if (tel.length < 8) { aviso.textContent = 'Revisa el teléfono antes de enviar.'; return; }
                        window.open('https://wa.me/' + tel + '?text=' + encodeURIComponent(mensaje), '_blank', 'noopener,noreferrer');
                    }));
                    const f = formulario('Registrar contacto realizado', (d, op) => ejecutar('contacto', d, op));
                    campo(f, 'tipo', 'Motivo de contacto', { opciones: [['presupuesto', 'Presupuesto'], ['repuesto', 'Repuesto'], ['retiro', 'Retiro'], ['garantia', 'Garantía']] });
                    campo(f, 'resultado', 'Resultado / respuesta', { multilinea: true, requerido: true }); f.finalizar();
                    if (orden.ultimoContacto) info('Último contacto registrado: ' + new Date(orden.ultimoContacto.en).toLocaleString('es-CL'));
                } else if (seccion === 'Historial') {
                    const eventos = await servicio.listar(usuario().uid, 'eventos', orden.id); if (!vigente(t)) return;
                    if (!eventos.length) info('Aún no hay eventos del nuevo registro. Los estados previos se conservan en el historial original.');
                    const lista = nodo('ol', undefined, 'ficha-lista');
                    for (const e of eventos.sort((a, b) => b.en - a.en)) {
                        const li = nodo('li', D().fechaRegistro(e).toLocaleString('es-CL') + ' · ' + e.resumen);
                        if (e.presupuesto) {
                            const d = nodo('details'); d.appendChild(nodo('summary', 'Ver presupuesto v' + e.presupuesto.version));
                            for (const l of e.presupuesto.lineas) d.appendChild(nodo('p', l.concepto + ' × ' + l.cantidad + ' · ' + window.TechFixDominio.formatearCLP(l.precio)));
                            d.appendChild(nodo('p', e.presupuesto.condiciones)); li.appendChild(d);
                        }
                        if (e.garantia) li.appendChild(nodo('p', e.garantia.motivo + ' · ' + e.garantia.resultado));
                        lista.appendChild(li);
                    }
                    cuerpo.appendChild(lista);
                }
            } catch (e) { if (vigente(t)) aviso.textContent = e.message; }
        }
        async function herramientas(t) {
            const uid = usuario().uid;
            if (seccion === 'Clientes') {
                const clientes = await servicio.listar(uid, 'clientes'); if (!vigente(t)) return;
                info('Agenda creada desde nuevas recepciones. Los registros anteriores no se fusionan automáticamente.');
                const buscar = campo(cuerpo, 'buscar-cliente', 'Buscar cliente por nombre o teléfono');
                const lista = nodo('ul', undefined, 'ficha-lista'); cuerpo.appendChild(lista);
                const pintar = () => {
                    lista.replaceChildren();
                    for (const c of clientes.filter(c => (c.nombre + ' ' + c.telefono).toLowerCase().includes(buscar.value.toLowerCase()))) lista.appendChild(nodo('li', c.nombre + ' · ' + c.telefono));
                }; buscar.addEventListener('input', pintar); pintar();
            } else if (seccion === 'Inventario') {
                info('Cada ingreso crea un lote de compra; no edita ni sobrescribe stock reservado. La compatibilidad debe verificarse en cada orden.');
                const f = formulario('Registrar lote recibido', (d, op) => servicio.guardarRepuesto(uid, d, op));
                for (const [k, label] of [['nombre', 'Repuesto / calidad'], ['marca', 'Marca'], ['modelo', 'Modelo exacto'], ['variante', 'Variante compatible'], ['proveedor', 'Proveedor']]) campo(f, k, label, { requerido: ['nombre', 'marca', 'modelo'].includes(k), max: 120 });
                campo(f, 'cantidad', 'Unidades recibidas', { tipo: 'number', min: 1, requerido: true });
                campo(f, 'costo', 'Costo unitario CLP', { tipo: 'number', valor: 0, requerido: true }); f.finalizar();
                const stock = await servicio.listar(uid, 'repuestos'); if (!vigente(t)) return;
                for (const r of stock) info(r.nombre + ' · ' + r.marca + ' ' + r.modelo + ' · ' + r.variante + ' · disponible ' + r.disponible + ' / reservado ' + r.reservado);
            } else if (seccion === 'Plantillas') {
                info('Guías privadas del taller, para personal capacitado. Cada edición conserva una versión; las órdenes mantienen su copia. Verifica fuente y seguridad antes de aplicar.');
                const plantillas = await servicio.listar(uid, 'plantillas'); if (!vigente(t)) return;
                const f = formulario('Guardar versión de plantilla', (d, op) => servicio.guardarPlantilla(uid, d, op));
                const seleccionar = campo(f, 'id', 'Crear o editar', { opciones: [['', 'Nueva plantilla'], ...plantillas.map(p => [p.id, p.titulo + ' · v' + p.version])] });
                campo(f, 'version', 'Versión base (control de cambios)', { valor: 0, tipo: 'number' }).readOnly = true;
                campo(f, 'titulo', 'Título', { requerido: true, max: 120 });
                campo(f, 'tipo', 'Tipo de procedimiento', { opciones: Object.entries(window.TechFixDominio.PROCEDIMIENTOS).map(([id, p]) => [id, p.titulo]) });
                campo(f, 'pasos', 'Un paso por línea (máximo 50)', { multilinea: true, requerido: true, max: 25000 });
                campo(f, 'fuente', 'Fuente / manual consultado / advertencias', { multilinea: true });
                seleccionar.addEventListener('change', () => {
                    const p = plantillas.find(p => p.id === seleccionar.value);
                    for (const k of ['titulo', 'fuente']) f.elements.namedItem(k).value = p?.[k] || '';
                    f.elements.namedItem('version').value = p?.version || 0;
                    f.elements.namedItem('tipo').value = p?.tipo || 'diagnostico';
                    f.elements.namedItem('pasos').value = p?.pasos.join('\n') || '';
                }); f.finalizar();
            } else if (seccion === 'Historial') {
                info('Consulta paginada del servidor, independiente de las 500 órdenes del tablero.');
                const lista = nodo('ul', undefined, 'ficha-lista'); cuerpo.appendChild(lista);
                let cursor = null, cargando = false;
                const cargar = boton('Cargar más órdenes', async () => {
                    if (cargando) return;
                    cargando = true; cargar.disabled = true;
                    try {
                        const pagina = await servicio.pagina(uid, cursor); if (!vigente(t)) return;
                        for (const p of pagina.ordenes) {
                            const li = nodo('li'); li.appendChild(boton((p.idOrden || p.id) + ' · ' + p.cliente + ' · ' + p.modelo + ' · ' + D().siguienteAccion(p), () => abrir(p.id))); lista.appendChild(li);
                        }
                        cursor = pagina.cursor; cargar.hidden = pagina.fin;
                    } catch (e) { if (vigente(t)) aviso.textContent = e.message; }
                    finally { cargando = false; cargar.disabled = false; }
                }); cuerpo.appendChild(cargar); cargar.click();
            } else if (seccion === 'Informes') {
                info('Lectura paginada de todas las órdenes de tu cuenta. Puede generar lecturas facturables. Es un informe operativo, no un corte contable atómico.');
                const resultado = nodo('div');
                const calcular = boton('Consultar todas las órdenes y calcular', async () => {
                    if (ocupado) return;
                    ocupado = true; calcular.disabled = true;
                    try {
                        let cursor = null, fin = false; const todas = new Map();
                        while (!fin && vigente(t)) {
                            const pagina = await servicio.pagina(uid, cursor); if (!vigente(t)) return;
                            pagina.ordenes.forEach(p => todas.set(p.id, p)); cursor = pagina.cursor; fin = pagina.fin;
                            aviso.textContent = 'Consultadas ' + todas.size + ' órdenes…';
                        }
                        const pagos = await servicio.listar(uid, 'pagos'); if (!vigente(t)) return;
                        const ordenes = [...todas.values()];
                        const saldo = ordenes.reduce((a, p) => a + D().resumenFinanciero(p).pendiente, 0);
                        const ahora = new Date();
                        const netoMes = pagos.filter(p => { const f = D().fechaRegistro(p); return f.getMonth() === ahora.getMonth() && f.getFullYear() === ahora.getFullYear(); }).reduce((a, p) => a + p.monto, 0);
                        resultado.replaceChildren(nodo('p', 'Órdenes consultadas: ' + todas.size), nodo('p', 'Saldo total por cobrar: ' + window.TechFixDominio.formatearCLP(saldo)),
                            nodo('p', 'Pagos netos registrados este mes (sin aperturas heredadas): ' + window.TechFixDominio.formatearCLP(netoMes)),
                            nodo('p', 'Garantías abiertas: ' + ordenes.filter(p => p.garantia?.estado === 'abierta').length));
                        resultado.appendChild(nodo('h3', 'Pendientes sugeridos (no envía mensajes)'));
                        for (const p of ordenes.filter(p => p.estado !== 'entregado' && (p.estado === 'repuesto' || p.estado === 'reparado' || p.presupuesto?.autorizacion.estado === 'pendiente'))) {
                            resultado.appendChild(boton((p.idOrden || p.id) + ' · ' + D().siguienteAccion(p), () => abrir(p.id)));
                        }
                        aviso.textContent = 'Consulta terminada: ' + new Date().toLocaleString('es-CL') + '. Si hubo cambios concurrentes, vuelve a calcular.';
                    } catch (e) { if (vigente(t)) aviso.textContent = e.message; }
                    finally { if (vigente(t)) { ocupado = false; calcular.disabled = false; } }
                }); cuerpo.append(calcular, resultado);
            }
        }
        return { abrir, gestion, limpiar, tienePendientes: () => sucio || ocupado };
    }
    window.KryoFixFicha = { crear };
})();
