/* =============================================================================
 * KryoFixTaller — Prioridades del taller
 *
 * Funciones puras (sin red ni DOM) que responden a la pregunta operativa del
 * día a día: "qué ataco primero" y "qué se me está yendo".
 *
 * Regla de diseño: estas funciones NUNCA lanzan ni modifican datos. Devuelven
 * descripciones legibles para la interfaz y son fáciles de probar por separado.
 * ========================================================================== */
(function () {
    'use strict';

    const DIA = 86400000;
    const AHORA = () => Date.now();

    /** Normaliza texto para comparar nombres sin tildes, mayúsculas ni espacios. */
    function clave(texto) {
        return String(texto == null ? '' : texto)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }

    /** Solo dígitos: permite comparar teléfonos escritos de formas distintas. */
    function soloDigitos(valor) {
        return String(valor == null ? '' : valor).replace(/\D+/g, '');
    }

    /**
     * Campos por los que se busca una orden en el tablero. Antes solo se miraba
     * la tarjeta; ahora también diagnóstico, notas, presupuesto y garantía,
     * porque es donde el técnico anota lo que todavía recuerda de un equipo.
     */
    const CAMPOS_BUSQUEDA = ['cliente', 'equipo', 'modelo', 'falla', 'imei', 'accesorios', 'telefono',
        'idOrden', 'notas', 'problemaComun', 'diagnostico', 'presupuesto', 'garantia', 'eventos'];

    /** Texto indexable de una orden (diagnóstico y presupuesto como objetos). */
    function textoBuscable(p) {
        if (!p) return '';
        const partes = [];
        for (const campo of CAMPOS_BUSQUEDA) {
            const v = p[campo];
            if (v == null) continue;
            if (typeof v === 'string') partes.push(v);
            else if (Array.isArray(v)) {
                // Procedimientos y eventos guardan objetos; interesan sus textos.
                for (const item of v) partes.push(typeof item === 'string' ? item : resumirObjeto(item));
            } else if (typeof v === 'object') partes.push(resumirObjeto(v));
        }
        return clave(partes.join(' '));
    }

    /**
     * Aplana un objeto a texto. Recorre arrays y objetos anidados porque ahí
     * está el contenido real (conceptos del presupuesto, pasos del
     * procedimiento). Ignora funciones, fechas y ciclos, y corta por profundidad
     * para que un documento enorme no bloquee la interfaz.
     */
    function resumirObjeto(valor, prof = 0, vistos = new Set()) {
        if (valor == null) return '';
        const tipo = typeof valor;
        if (tipo === 'string' || tipo === 'number' || tipo === 'boolean') return String(valor);
        if (tipo !== 'object') return '';
        if (valor instanceof Date) return '';
        if (prof > 4) return '';
        if (vistos.has(valor)) return ''; // ciclo: no se repite
        vistos.add(valor);
        if (Array.isArray(valor)) return valor.map((v) => resumirObjeto(v, prof + 1, vistos)).join(' ');
        const partes = [];
        for (const v of Object.values(valor)) partes.push(resumirObjeto(v, prof + 1, vistos));
        return partes.join(' ');
    }

    /** ¿La orden cumple todos los términos escritos, en cualquier orden y sin tildes? */
    function coincide(p, terminos) {
        if (!terminos || !terminos.length) return true;
        const texto = textoBuscable(p);
        return terminos.every((t) => texto.includes(t));
    }

    /** Divide la consulta en términos comparables. */
    function terminos(consulta) {
        return clave(consulta).split(' ').filter(Boolean);
    }

    /** Días transcurridos desde una fecha en ms (null si no hay fecha válida). */
    function diasDesde(fecha, ahora = AHORA()) {
        const n = Number(fecha || 0);
        if (!n) return null;
        return Math.floor((ahora - n) / DIA);
    }

    /**
     * Bloque "qué ataco hoy": cada punto es una acción concreta con su cuenta.
     * Se ordena por urgencia: primero el dinero y los clientes que ya están
     * listos, después lo que depende de repuestos o de decisiones.
     */
    function prioridades(ordenes, opciones = {}) {
        const ahora = opciones.ahora || AHORA();
        const esperaMax = opciones.esperaListos || 30;
        const garantiaAviso = opciones.avisoGarantia || 30;
        const lista = Array.isArray(ordenes) ? ordenes.filter(Boolean) : [];
        const puntos = [];
        const cuenta = (id, titulo, detalle, urgente = false) => {
            const previo = puntos.find((x) => x.clave === id);
            if (previo) { previo.detalle.push(detalle); return; }
            puntos.push({ clave: id, titulo, detalle: [detalle], urgente });
        };

        for (const p of lista) {
            const saldo = Math.max(0, (Number(p.costo) || 0) - (Number(p.abono) || 0));
            const nombre = p.cliente || 'Sin nombre';

            // Dinero que ya se entregó y no se cobró: es lo que más cuesta perder.
            if (saldo > 0 && p.estado === 'entregado') {
                cuenta('cobro', 'Cobrar saldo en equipos ya entregados',
                    nombre + ' · ' + (p.idOrden || p.id) + ' · ' + formatear(saldo), true);
            }
            // Saldo en órdenes que siguen en el taller. Si el presupuesto ya está
            // aprobado, lacobranza se agrupa en su propia lista y no se repite.
            const autorizado = p.presupuesto?.autorizacion?.estado === 'aprobado';
            if (saldo > 0 && p.estado !== 'entregado' && !autorizado) {
                cuenta('cobro-activo', 'Órdenes activas con saldo pendiente',
                    nombre + ' · ' + (p.idOrden || p.id) + ' · ' + formatear(saldo));
            }

            // Listos hace demasiado tiempo: el cliente se va a otro taller.
            if (p.estado === 'reparado') {
                const dias = diasDesde(p.fechaReparacion || p.timestamp, ahora);
                if (dias !== null && dias >= esperaMax) {
                    cuenta('retiro', 'Listos hace más de ' + esperaMax + ' días, esperando retiro',
                        nombre + ' · ' + (p.modelo || '') + ' · ' + dias + ' días', dias >= esperaMax * 2);
                }
            }

            // Presupuesto aprobado que todavía no se pagó del todo.
            if (autorizado && saldo > 0 && p.estado !== 'entregado') {
                cuenta('cobrar-aprobado', 'Presupuesto aprobado y saldo sin cobrar',
                    nombre + ' · ' + (p.idOrden || p.id) + ' · ' + formatear(saldo));
            }

            // Garantías por vencer o ya vencidas.
            const g = p.garantia;
            if (g && g.estado !== 'cerrada') {
                const dias = diasDesde(g.en || p.fechaEntrega, ahora);
                if (dias !== null && dias >= garantiaAviso) {
                    cuenta('garantia',
                        dias > garantiaAviso ? 'Garantías vencidas o por vencer' : 'Garantías por vencer',
                        nombre + ' · ' + (p.modelo || '') + ' · ' + dias + ' días', dias > garantiaAviso);
                }
            }
        }
        puntos.sort((a, b) => Number(b.urgente) - Number(a.urgente));
        return puntos.map((x) => ({ ...x, cuenta: x.detalle.length, detalle: x.detalle.slice(0, 6) }));
    }

    /** Formato compacto de pesos, sin depender del módulo de presentación. */
    function formatear(monto) {
        const n = Number(monto) || 0;
        return '$' + n.toLocaleString('es-CL');
    }

    /**
     * Grupos de clientes que probablemente son la misma persona. No fusiona:
     * solo propone, porque dos homónimos legítimos existen.
     *
     * Criterio: mismo teléfono (últimos 9 dígitos) o nombre muy alike
     * (primer y apellido coinciden tras normalizar).
     */
    function duplicados(clientes, opciones = {}) {
        const lista = (Array.isArray(clientes) ? clientes : []).filter(c => c && (c.nombre || c.telefono));
        const umbral = opciones.umbral || 0.86;
        const grupos = [];
        const visto = new Set();
        for (let i = 0; i < lista.length; i++) {
            if (visto.has(i)) continue;
            const base = lista[i];
            const grupo = { base, candidatos: [], motivo: '' };
            for (let j = i + 1; j < lista.length; j++) {
                if (visto.has(j)) continue;
                const otro = lista[j];
                const telefono = mismoTelefono(base, otro);
                const nombre = parecidoNombre(base.nombre, otro.nombre, umbral);
                if (!telefono && !nombre) continue;
                if (!grupo.motivo) grupo.motivo = telefono ? 'mismo teléfono' : 'nombre muy parecido';
                grupo.candidatos.push(otro);
                visto.add(j);
            }
            if (grupo.candidatos.length) { visto.add(i); grupos.push(grupo); }
        }
        return grupos;
    }

    /** Últimos 9 dígitos: ignora el prefijo país y los ceros iniciales. */
    function mismoTelefono(a, b) {
        const x = soloDigitos(a?.telefono).slice(-9);
        const y = soloDigitos(b?.telefono).slice(-9);
        return x.length >= 9 && x === y;
    }

    /** Similitud de tokens (Jaccard) sobre el nombre normalizado. */
    function parecidoNombre(a, b, umbral) {
        const x = new Set(clave(a).split(' ').filter(Boolean));
        const y = new Set(clave(b).split(' ').filter(Boolean));
        if (!x.size || !y.size) return false;
        let comunes = 0;
        for (const t of x) if (y.has(t)) comunes++;
        return comunes / (x.size + y.size - comunes) >= umbral;
    }

    /**
     * Clientes recientes para la recepción, ordenados por uso real: se prioriza
     * quien más vuelve, no solo el alfabético.
     */
    function frecuentes(clientes, opciones = {}) {
        const limite = opciones.limite || 8;
        const ahora = opciones.ahora || AHORA();
        const lista = (Array.isArray(clientes) ? clientes : []).filter(c => c && c.nombre);
        return lista
            .map((c) => {
                const visitas = Number(c.ordenes || 0);
                const ultima = Number(c.actualizado || c.creado || 0);
                const dias = diasDesde(ultima, ahora);
                return { ...c, visitas, dias, activo: dias !== null && dias <= 180 };
            })
            .sort((a, b) => (Number(b.activo) - Number(a.activo)) || (b.visitas - a.visitas) ||
                (String(a.nombre).localeCompare(String(b.nombre))))
            .slice(0, limite);
    }

    window.KryoFixTallerPrioridades = {
        clave, soloDigitos, textoBuscable, coincide, terminos, diasDesde,
        prioridades, duplicados, mismoTelefono, parecidoNombre, frecuentes,
        CAMPOS_BUSQUEDA, formatear
    };
})();