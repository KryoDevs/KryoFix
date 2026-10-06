// Comprobar identidad del secreto SIN mostrar su contenido ni autenticar aún.
const proyecto = process.env.FIREBASE_PROJECT_ID;
if (!proyecto || proyecto === 'techfix-tracker-9a128') throw new Error('Se requiere un destino de staging separado.');
let cuenta;
try { cuenta = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_STAGING || 'null'); }
catch (_e) { throw new Error('El secreto de la cuenta de staging no es JSON válido.'); }
if (!cuenta || cuenta.type !== 'service_account' || cuenta.project_id !== proyecto ||
    typeof cuenta.client_email !== 'string' || !cuenta.client_email.endsWith('@' + proyecto + '.iam.gserviceaccount.com') ||
    typeof cuenta.private_key !== 'string' || !cuenta.private_key.includes('BEGIN PRIVATE KEY')) {
    throw new Error('Configura una cuenta de servicio exclusiva del proyecto de staging; no se acepta la de producción.');
}
console.log('Destino de la cuenta de staging verificado. No se mostraron credenciales.');
