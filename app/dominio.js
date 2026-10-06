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

    // Lista local orientativa: disponible sin APIs ni tarifas cargadas.
    const MODELOS_TELEFONOS = {
        Apple: ['iPhone SE (2020)', 'iPhone SE (2022)', ...['11', '12', '13', '14', '15', '16'].flatMap(n =>
            ['iPhone ' + n, 'iPhone ' + n + ' Pro', 'iPhone ' + n + ' Pro Max']),
        'iPhone 12 mini', 'iPhone 13 mini', 'iPhone 14 Plus', 'iPhone 15 Plus', 'iPhone 16 Plus', 'iPhone 16e'],
        Samsung: ['Galaxy A04', 'Galaxy A05', 'Galaxy A05s', 'Galaxy A06', 'Galaxy A14', 'Galaxy A15', 'Galaxy A16',
            'Galaxy A24', 'Galaxy A25', 'Galaxy A26', 'Galaxy A34', 'Galaxy A35', 'Galaxy A36', 'Galaxy A54', 'Galaxy A55', 'Galaxy A56',
            ...['S21', 'S22', 'S23', 'S24', 'S25'].flatMap(n => ['Galaxy ' + n, 'Galaxy ' + n + '+', 'Galaxy ' + n + ' Ultra']),
            'Galaxy Z Flip5', 'Galaxy Z Flip6', 'Galaxy Z Fold5', 'Galaxy Z Fold6'],
        Xiaomi: ['Redmi 12', 'Redmi 13', 'Redmi 13C', 'Redmi 14C', 'Redmi Note 11', 'Redmi Note 12', 'Redmi Note 12 Pro',
            'Redmi Note 13', 'Redmi Note 13 Pro', 'Redmi Note 14', 'Redmi Note 14 Pro', 'POCO X5', 'POCO X6', 'POCO X6 Pro',
            'POCO F5', 'POCO F6', 'Xiaomi 13', 'Xiaomi 14'],
        Motorola: ['Moto E13', 'Moto E14', 'Moto G14', 'Moto G24', 'Moto G32', 'Moto G34', 'Moto G54', 'Moto G84',
            'Moto G85', 'Edge 40', 'Edge 40 Neo', 'Edge 50', 'Edge 50 Fusion', 'Edge 50 Pro'],
        Huawei: ['P30', 'P30 Pro', 'P30 Lite', 'P40', 'P40 Pro', 'P40 Lite', 'P50 Pro', 'P60 Pro', 'Mate 40 Pro',
            'Nova 9', 'Nova 10', 'Nova 11', 'Y9 Prime (2019)', 'Y9a']
    };

    function obtenerModelos(marca, catalogo = [], equipos = []) {
        const clave = String(marca || '').trim().toLowerCase();
        if (!clave) return [];
        const base = Object.entries(MODELOS_TELEFONOS).find(([nombre]) => nombre.toLowerCase() === clave);
        const candidatos = [...(base ? base[1] : []),
            ...catalogo.filter(c => String(c.marca || '').trim().toLowerCase() === clave).map(c => c.modelo),
            ...equipos.filter(c => String(c.equipo || '').trim().toLowerCase() === clave).map(c => c.modelo)];
        const unicos = new Map();
        for (const valor of candidatos) {
            const modelo = String(valor || '').trim();
            if (modelo && modelo !== 'Otro' && !unicos.has(modelo.toLowerCase())) unicos.set(modelo.toLowerCase(), modelo);
        }
        return [...unicos.values()].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
    }

    const PREPARACION = [
        'Confirmar modelo y variante exactos, síntomas, estado de recepción y autorización del cliente. Documentar las pruebas iniciales.',
        'Consultar el manual de servicio de esa variante y verificar herramientas, protección ESD y repuestos compatibles. Acordar respaldo y riesgos para los datos antes de intervenir.'
    ];
    const CIERRE = [
        'Realizar las pruebas funcionales indicadas por el fabricante, registrar resultados y comprobar que la falla quedó resuelta.',
        'Documentar piezas y trabajo realizado, limitaciones y garantía. Informar al cliente antes de marcar el equipo como listo para entregar.'
    ];
    const PROCEDIMIENTOS = {
        diagnostico: { titulo: 'Diagnóstico inicial', pasos: [...PREPARACION,
            'Inspeccionar daños, humedad y batería. Si hay hinchazón, calor anormal o líquido, no cargar ni encender; detener las pruebas y derivar a personal capacitado.',
            'Si es seguro, reproducir la falla con pruebas no destructivas: pantalla, táctil, carga, audio, cámaras y conectividad. Registrar qué funciona y qué no.',
            'Determinar pruebas adicionales y presupuesto. Solicitar autorización y seleccionar el procedimiento de reparación antes de desmontar.', ...CIERRE] },
        pantalla: { titulo: 'Cambio de pantalla', pasos: [...PREPARACION,
            'Apagar el equipo y seguir el manual para abrirlo y desconectar la batería. No aplicar calor ni hacer palanca sin conocer la ubicación de batería y flex.',
            'Retirar el módulo dañado siguiendo la secuencia del fabricante. Inspeccionar conectores y conservar los componentes emparejados que indique el manual.',
            'Instalar un módulo compatible y realizar las pruebas de imagen, táctil y sensores siguiendo el protocolo de montaje seguro.',
            'Completar calibraciones requeridas y renovar los adhesivos según el manual. No prometer resistencia al agua sin las pruebas correspondientes.', ...CIERRE] },
        bateria: { titulo: 'Cambio de batería', pasos: [...PREPARACION,
            'Inspeccionar la batería sin presionarla. Si está hinchada, perforada, caliente o emite olor, detener el trabajo y aplicar el protocolo de baterías dañadas; no cargarla ni calentarla.',
            'Si es seguro, apagar, abrir y desconectar la batería siguiendo el manual. Retirar adhesivos con el método indicado; nunca perforar, doblar ni usar herramientas metálicas sobre la celda.',
            'Instalar una batería compatible con adhesivos adecuados, comprobar conectores y cerrar según el fabricante. Gestionar la batería retirada como residuo especializado.',
            'Ejecutar el diagnóstico o calibración indicado y comprobar carga y temperatura bajo supervisión.', ...CIERRE] },
        carga: { titulo: 'Diagnóstico y reparación de carga', pasos: [...PREPARACION,
            'Descartar humedad, daños y batería hinchada antes de energizar. Si existen, detener las pruebas de carga.',
            'Comprobar cargador y cable compatibles y conocidos como funcionales. Inspeccionar el puerto sin introducir objetos metálicos.',
            'Apagar y desconectar la batería según el manual antes de intervenir el puerto. Determinar si requiere limpieza, módulo de carga o diagnóstico de placa.',
            'Realizar únicamente la intervención autorizada con repuestos compatibles. Derivar la microsoldadura a personal capacitado; no puentear protecciones.',
            'Comprobar conexión, carga y transferencia de datos si corresponde; vigilar la temperatura.', ...CIERRE] },
        humedad: { titulo: 'Evaluación de daño por líquidos', pasos: [...PREPARACION,
            'No encender, cargar ni aplicar calor. Registrar el líquido y tiempo de exposición. Si hay calor, humo o batería dañada, detenerse y aplicar el protocolo de seguridad.',
            'Personal capacitado debe aislar la alimentación siguiendo el manual de servicio e inspeccionar corrosión y conectores.',
            'Evaluar recuperación de datos y alcance del daño; obtener autorización para el tratamiento específico. No usar arroz ni asumir que el secado elimina la corrosión.',
            'Aplicar el protocolo de limpieza y secado apropiado a los componentes y productos empleados. No energizar hasta que el técnico confirme condiciones seguras.', ...CIERRE] },
        software: { titulo: 'Diagnóstico de software', pasos: [...PREPARACION,
            'Registrar versión del sistema y errores; comprobar almacenamiento y actualizaciones oficiales compatibles.',
            'Con autorización, probar reinicio y diagnósticos no destructivos. Evitar acceder a datos personales que no sean necesarios para la prueba.',
            'Antes de restablecer o reinstalar, obtener consentimiento explícito por pérdida de datos, verificar respaldo y acceso del propietario a sus cuentas. No eludir bloqueos de seguridad.',
            'Aplicar solo la solución autorizada con herramientas oficiales y verificar arranque, conectividad y funcionamiento con el cliente.', ...CIERRE] }
    };

    function crearProcedimiento(tipo = 'diagnostico') {
        const plantilla = PROCEDIMIENTOS[tipo];
        if (!plantilla) return null;
        // Instantánea versionada: futuras modificaciones no cambian órdenes en curso.
        return { tipo, titulo: plantilla.titulo, version: 1,
            pasos: plantilla.pasos.map(texto => ({ texto, completado: false })) };
    }

    // Síntomas de recepción, no estadísticas de defectos por fabricante.
    const PROBLEMAS_COMUNES = [
        { id: 'carga', titulo: 'No carga o carga intermitente', comprobacion: 'Descartar daños, humedad y batería hinchada antes de probar un cable y cargador compatibles conocidos. Inspeccionar el puerto sin objetos metálicos.' },
        { id: 'autonomia', titulo: 'Batería dura poco o se descarga rápido', comprobacion: 'Registrar consumo, antigüedad y estado de batería si el sistema lo informa. Revisar aplicaciones y temperatura antes de proponer un reemplazo.' },
        { id: 'pantalla', titulo: 'Pantalla sin imagen o táctil con fallas', comprobacion: 'Registrar golpes, imagen y zonas del táctil afectadas. Descartar accesorios que interfieran y comprobar el síntoma sin asumir que se necesita cambiar la pantalla.' },
        { id: 'reinicios', titulo: 'Lentitud, bloqueos o reinicios', comprobacion: 'Registrar cuándo ocurre, almacenamiento disponible y versión del sistema. Empezar por pruebas no destructivas; no restablecer ni reinstalar sin respaldo y autorización.' },
        { id: 'audio', titulo: 'No se escucha o el micrófono falla', comprobacion: 'Comparar llamadas, altavoz y grabación con autorización; revisar permisos y conexiones Bluetooth. No introducir objetos en las rejillas.' },
        { id: 'camara', titulo: 'Cámara no abre o no enfoca', comprobacion: 'Comprobar permisos, lentes externos y funcionamiento de cada cámara. Registrar errores y descartar accesorios antes de intervenir.' },
        { id: 'temperatura', titulo: 'Se calienta demasiado', comprobacion: 'Si hay calor anormal, hinchazón, olor o humo, detener uso y carga y aplicar el protocolo de seguridad. En condiciones seguras, registrar cuándo aparece y revisar consumo sin forzar el equipo.' },
        { id: 'humedad', titulo: 'Contacto con líquido o alerta de humedad', comprobacion: 'No cargar, encender ni aplicar calor. Registrar exposición y derivar a evaluación capacitada antes de energizar; no asumir que secar elimina la corrosión.' }
    ];

    const REVISION_POR_MARCA = {
        apple: 'En iPhone, consultar los diagnósticos y avisos de piezas del sistema cuando estén disponibles. Verificar requisitos de calibración de la variante antes de presupuestar.',
        samsung: 'En Samsung, usar los diagnósticos de Samsung Members si están disponibles en esta variante. No confundir un aviso de humedad con un puerto averiado sin revisar.',
        xiaomi: 'En Xiaomi / Redmi / POCO, registrar si usa MIUI o HyperOS y su versión. Revisar permisos y ahorro de batería antes de atribuir fallas de aplicaciones al hardware.',
        motorola: 'En Motorola, consultar los diagnósticos de Ayuda del dispositivo si están disponibles. Confirmar la variante exacta de Moto o Edge antes de elegir repuestos.',
        huawei: 'En Huawei, verificar versión de EMUI y disponibilidad de servicios y aplicaciones para esa variante y región antes de considerar una incompatibilidad como falla de hardware.'
    };

    function obtenerProblemas(marca, modelo, equipos = []) {
        const normalizar = valor => String(valor || '').trim().toLowerCase();
        const m = normalizar(marca);
        const mod = normalizar(modelo);
        if (!m || !mod || mod === 'otro') return [];
        const historial = equipos.filter(p => normalizar(p.equipo) === m && normalizar(p.modelo) === mod);
        return PROBLEMAS_COMUNES.map(problema => ({ ...problema,
            contexto: REVISION_POR_MARCA[m] || 'Confirmar la variante y consultar los diagnósticos oficiales disponibles para este equipo.',
            registros: historial.filter(p => p.problemaComun && p.problemaComun.id === problema.id).length
        })).sort((a, b) => b.registros - a.registros);
    }

    function procedimientoParaProblema(id, marca, modelo) {
        const problema = obtenerProblemas(marca, modelo).find(p => p.id === id);
        if (!problema) return crearProcedimiento();
        const guia = crearProcedimiento(id === 'humedad' ? 'humedad' : 'diagnostico');
        guia.titulo += ' · ' + problema.titulo;
        guia.pasos.splice(2, 0,
            { texto: problema.comprobacion, completado: false },
            { texto: problema.contexto, completado: false });
        return guia;
    }

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
        MODELOS_TELEFONOS,
        obtenerModelos,
        PROCEDIMIENTOS,
        crearProcedimiento,
        obtenerProblemas,
        procedimientoParaProblema,
        escapeHtml,
        formatearCLP,
        normalizarTelefono,
        extraerCodigoOrden,
        permiteEstado,
        calcularSaldo,
        porcentajePagado
    };
})();
