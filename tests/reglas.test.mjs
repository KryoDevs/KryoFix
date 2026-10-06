/**
 * Verificacion estatica del modelo de seguridad de firestore.rules.
 *
 * No sustituye a las pruebas con el emulador (@firebase/rules-unit-testing, la
 * mejora pendiente documentada en ANALISIS.md), pero deja escrito en ejecutable
 * que la coleccion publica siga limitada a campos no personales: una regresion
 * aqui expondria datos de clientes.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rules = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');

/**
 * Devuelve el cuerpo del bloque `match /coleccion/{id} { ... }`.
 * Ojo: el patron de ruta tambien usa llaves (`{id}`), por eso se localiza el
 * cuerpo con la expresion completa y no con el primer "{" a secas.
 */
function bloque(coleccion) {
    const coincidencia = new RegExp(`match\\s+/${coleccion}/\\{[^}]*\\}\\s*\\{`).exec(rules);
    assert.ok(coincidencia, `no existe el bloque match /${coleccion}/`);
    const desde = coincidencia.index + coincidencia[0].length - 1;
    let profundidad = 0;
    for (let i = desde; i < rules.length; i++) {
        if (rules[i] === '{') profundidad++;
        else if (rules[i] === '}') {
            profundidad--;
            if (profundidad === 0) return rules.slice(desde, i + 1);
        }
    }
    throw new Error(`bloque /${coleccion}/ sin cerrar`);
}

describe('Reglas de Firestore: coleccion publica', () => {
    const seguimiento = bloque('seguimiento');

    test('es legible sin autenticacion (la usa el cliente desde el QR)', () => {
        assert.match(seguimiento, /allow get:\s*if true;/);
        assert.match(seguimiento, /allow list:\s*if false;/);
    });

    test('solo admite los cuatro campos no personales', () => {
        assert.match(
            seguimiento,
            /keys\(\)\.hasOnly\(\['uid', 'estado', 'modelo', 'actualizado'\]\)/,
            'el espejo publico debe limitar sus claves: cualquier campo nuevo seria visible para cualquiera'
        );
    });

    test('valida el estado contra la lista permitida y acota el modelo', () => {
        assert.match(seguimiento, /estado in \['ingresado', 'revision', 'repuesto', 'reparado', 'entregado'\]/);
        assert.match(seguimiento, /modelo is string/);
        assert.match(seguimiento, /modelo\.size\(\) <= 80/);
    });

    test('no se puede escribir sin autenticacion ni suplantar el uid', () => {
        assert.match(seguimiento, /allow create:\s*if seAutoAsigna\(\)/);
        assert.match(seguimiento, /allow update:\s*if esDueno\(\) && seAutoAsigna\(\) && mantieneDueno\(\)/);
        assert.ok(!/allow write:\s*if true/.test(seguimiento));
    });
});

describe('Reglas de Firestore: colecciones privadas', () => {
    for (const coleccion of ['equipos', 'catalogo']) {
        test(`${coleccion} exige sesion y propiedad del documento`, () => {
            const cuerpo = bloque(coleccion);
            assert.match(cuerpo, /allow read:\s*if esDueno\(\);/);
            assert.match(cuerpo, /allow create:\s*if seAutoAsigna\(\)/);
            assert.match(cuerpo, /allow update:\s*if esDueno\(\) && seAutoAsigna\(\) && mantieneDueno\(\)/);
            assert.match(cuerpo, /allow delete:\s*if esDueno\(\);/);
        });
    }

    test('equipos valida el dinero y el nombre del cliente', () => {
        const equipos = bloque('equipos');
        assert.match(equipos, /costo is number/);
        assert.match(equipos, /abono <= request\.resource\.data\.costo/);
        assert.match(equipos, /cliente\.size\(\) <= 120/);
    });

    test('el resto de la base queda cerrada', () => {
        assert.match(rules, /match \/\{document=\*\*\}/);
        assert.match(rules, /allow read, write: if false;/);
    });
});
