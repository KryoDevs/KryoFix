/* =============================================================================
 * TechFix Tracker Pro — Capa de Dominio y Reglas de Negocio (Compartida)
 *
 * Modulo puro sin dependencias de red ni del DOM. Centraliza las constantes,
 * maquina de estados, validaciones de negocio, sanitizacion y formateadores
 * compartidos entre la aplicacion del tecnico (app.js) y el portal publico de
 * seguimiento (status.js).
 * ========================================================================== */

(function () {
    'use strict';

    const ESTADOS = ['ingresado', 'revision', 'repuesto', 'reparado', 'entregado'];

    const ESTADO_TEXTO = {
        ingresado: 'Ingresado',
        revision: 'En Revision',
        repuesto: 'Esperando Repuesto',
        reparado: 'Listo para Entregar',
        entregado: 'Entregado'
    };

    const ESTADO_ETAPAS = {
        ingresado: 1,
        revision: 2,
        repuesto: 3,
        reparado: 4,
        entregado: 5
    };

    const PORCENTAJES_ESTADO = {
        ingresado: 20,
        revision: 45,
        repuesto: 65,
        reparado: 90,
        entregado: 100
    };

    const PRIORIDADES = ['normal', 'alta', 'urgente'];

    const PRIORIDAD_TEXTO = {
        normal: 'Normal',
        alta: 'Prioridad Alta',
        urgente: 'Urgente'
    };

    const PRIORIDAD_PESO = {
        urgente: 3,
        alta: 2,
        normal: 1
    };

    const CATALOGO_SUGERIDO = [
        { marca: 'Apple', modelo: 'iPhone 13', reparacion: 'Cambio de pantalla OLED', precio: 85000 },
        { marca: 'Apple', modelo: 'iPhone 13', reparacion: 'Cambio de bateria original', precio: 45000 },
        { marca: 'Apple', modelo: 'iPhone 14', reparacion: 'Cambio de modulo de pantalla', precio: 115000 },
        { marca: 'Samsung', modelo: 'Galaxy S22', reparacion: 'Cambio de pantalla AMOLED', precio: 95000 },
        { marca: 'Samsung', modelo: 'Galaxy A54', reparacion: 'Reemplazo de puerto de carga USB-C', precio: 28000 },
        { marca: 'Xiaomi', modelo: 'Redmi Note 12', reparacion: 'Cambio de pantalla completa', precio: 42000 },
        { marca: 'Motorola', modelo: 'Moto G54', reparacion: 'Limpieza quimica por humedad', precio: 35000 }
    ];

    /** Escapa texto para interpolarlo en HTML, incluidas comillas (atributos). */
    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /** Formateador de moneda CLP con numeros tabulares. */
    function formatearCLP(valor) {
        return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(Number(valor) || 0);
    }

    /** Deja solo digitos; descarta prefijos "+" y separadores para usar en wa.me. */
    function normalizarTelefono(valor) {
        return String(valor || '').replace(/\D+/g, '');
    }

    /**
     * Extrae y sanea un codigo de documento de seguimiento a partir de la
     * entrada del usuario (admite ID directo, "#id", "?id=..." o URL completa).
     * Devuelve '' si el resultado no es un ID seguro de documento Firestore.
     */
    function extraerCodigoOrden(entrada) {
        let texto = String(entrada || '').trim();
        if (!texto) return '';

        // Si el cliente pego una URL completa o query string con ?id=
        if (texto.includes('?') || /^https?:\/\//i.test(texto)) {
            try {
                const u = new URL(texto, 'https://techfix.local/');
                const paramId = u.searchParams.get('id');
                if (paramId) texto = paramId.trim();
            } catch (_e) {
                const m = texto.match(/[?&]id=([^&#\s]+)/i);
                if (m && m[1]) {
                    try {
                        texto = decodeURIComponent(m[1]).trim();
                    } catch (_err) {
                        texto = m[1].trim();
                    }
                }
            }
        }

        // Quita prefijo '#' si el cliente copio "#ABC123"
        texto = texto.replace(/^#+/, '').trim();

        // Un ID de documento en Firestore no puede contener barras ni espacios
        if (!texto || /[/?#\\\s]/.test(texto) || texto === '.' || texto === '..' || texto.length > 128) {
            return '';
        }
        return texto;
    }

    /**
     * Transiciones permitidas desde el estado actual:
     *   - hacia adelante, todos los estados posteriores;
     *   - hacia atras, solo un paso (corregir un clic equivocado).
     * 'entregado' se reserva para la entrega con firma.
     */
    function permiteEstado(p, nuevo) {
        if (!p) return false;
        if (p.estado === 'entregado') return nuevo === 'entregado';
        const actual = ESTADO_ETAPAS[p.estado] || 1;
        const destino = ESTADO_ETAPAS[nuevo];
        if (!destino) return false;
        if (nuevo === 'entregado') return p.estado === 'entregado';
        return destino >= actual - 1;
    }

    /** Calcula el saldo pendiente (nunca negativo) de una orden. */
    function calcularSaldo(p) {
        if (!p) return 0;
        return Math.max(0, (Number(p.costo) || 0) - (Number(p.abono) || 0));
    }

    /** Porcentaje de pago cubierto por el abono (0 a 100). */
    function porcentajePagado(p) {
        if (!p) return 0;
        const costo = Number(p.costo) || 0;
        const abono = Math.max(0, Number(p.abono) || 0);
        if (costo <= 0) return abono > 0 ? 100 : 0;
        return Math.min(100, Math.round((abono / costo) * 100));
    }

    window.TechFixDominio = {
        ESTADOS,
        ESTADO_TEXTO,
        ESTADO_ETAPAS,
        PORCENTAJES_ESTADO,
        PRIORIDADES,
        PRIORIDAD_TEXTO,
        PRIORIDAD_PESO,
        CATALOGO_SUGERIDO,
        escapeHtml,
        formatearCLP,
        normalizarTelefono,
        extraerCodigoOrden,
        permiteEstado,
        calcularSaldo,
        porcentajePagado
    };
})();
