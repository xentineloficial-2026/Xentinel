/** Sesión limitada a la pestaña actual. Nunca se registran tokens en consola. */
const CLAVE_SESION = 'xentinel-session';
/* memoria: valor de trabajo utilizado en esta operación. */
let memoria = null;
function leerSesion() {
  try {
    memoria = JSON.parse(sessionStorage.getItem(CLAVE_SESION) || 'null');
  } catch {
    /* Respaldo en memoria si el navegador bloquea el almacenamiento. */
  }
  return memoria?.tokenAcceso &&
    memoria?.usuario &&
    memoria.venceEn > Date.now()
    ? memoria
    : null;
}
export { leerSesion };
function guardarSesion(sesion) {
  memoria = sesion;
  try {
    if (sesion) sessionStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
    else sessionStorage.removeItem(CLAVE_SESION);
  } catch {
    /* La sesión sigue disponible en memoria. */
  }
}
export { guardarSesion };
/** motivo reemplaza el aviso de sesión vencida tras un cambio que pide volver a ingresar,
 * como la contraseña o el correo; se muestra como confirmación, no como error. */
function caducarSesion(motivo) {
  guardarSesion(null);
  window.dispatchEvent(
    new CustomEvent('xentinel:session-expired', {
      detail: motivo ? { mensaje: motivo, tono: 'exito' } : null,
    })
  );
}
export { caducarSesion };
