import { writeFileSync } from 'node:fs';
// Exclusivamente configuración del proyecto demo; no contiene credenciales reales.
writeFileSync('functions/.env.local', 'STORAGE_BUCKET_PRIVADO=demo-kryofix.appspot.com\nHABILITAR_ENVIOS=false\nPROVEEDOR_URL=\n');
writeFileSync('functions/.secret.local', 'WEBHOOK_SECRET=test-webhook-secret-not-production-000000\nPROVEEDOR_TOKEN=test-only-never-send\n');
