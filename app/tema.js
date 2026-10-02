/**
 * Aplica el tema guardado ANTES de pintar la pagina.
 *
 * Se carga de forma sincrona desde <head>: si se hiciera desde app.js (al final
 * del body) el usuario en modo oscuro veria un destello blanco en cada carga.
 * Vive en su propio archivo en vez de en un <script> inline para poder mantener
 * una Content-Security-Policy estricta (sin 'unsafe-inline').
 */
(function () {
    let tema = 'light';
    try {
        const guardado = localStorage.getItem('theme');
        if (guardado === 'dark' || guardado === 'light') {
            tema = guardado;
        } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            // Primera visita: se respeta la preferencia del sistema operativo.
            tema = 'dark';
        }
    } catch (_e) {
        /* localStorage bloqueado (modo privado): se usa el tema claro */
    }
    document.documentElement.setAttribute('data-theme', tema);
})();
