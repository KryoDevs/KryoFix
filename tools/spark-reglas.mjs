// Spark: solo el UID del dueño y documentos con imágenes acotadas.
export function reglasSpark(base, uid) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid || '')) throw new Error('UID del taller inválido. Cópialo de Authentication → Usuarios.');
    const original = 'return request.auth != null;';
    if (!base.includes(original)) throw new Error('Cambió la plantilla de reglas. Revisión obligatoria antes de publicar.');
    let reglas = base.replace(original, `return request.auth != null && request.auth.uid == '${uid}';`);
    reglas = reglas.replace('    match /equipos/{equipoId} {', `    function imagenSpark(d, campo, maximo) {
      let v = d.get(campo, null);
      return v == null || (v is string && v.size() <= maximo
        && v.matches('data:image/(jpeg|png);base64,[A-Za-z0-9+/=]+'));
    }
    function archivosSpark(d) {
      return imagenSpark(d, 'evidencia', 81920) && imagenSpark(d, 'firmaCliente', 32768);
    }
    match /equipos/{equipoId} {`);
    reglas = reglas.replace('allow create: if seAutoAsigna()', 'allow create: if seAutoAsigna() && archivosSpark(request.resource.data)');
    reglas = reglas.replace('allow update: if esDueno() && seAutoAsigna() && mantieneDueno()', 'allow update: if esDueno() && seAutoAsigna() && mantieneDueno() && archivosSpark(request.resource.data)');
    return reglas;
}
