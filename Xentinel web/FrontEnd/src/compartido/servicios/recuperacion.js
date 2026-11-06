/** Recuperación verificada: el correo entrega token + correo; el servidor revalida ambos al guardar. */
import { solicitar } from './cliente.js';
async function solicitarRecuperacion(correo) {
  await solicitar('/auth/olvide-contrasena', {
    method: 'POST',
    body: {
      correo,
    },
    publicRequest: true,
  });
}
export { solicitarRecuperacion };
async function verificarEnlace(token, correo, senal) {
  /* data, datos: valor de trabajo utilizado en esta operación. */
  const { data: datos } = await solicitar('/auth/validar-recuperacion', {
    method: 'POST',
    body: {
      token,
      correo,
    },
    signal: senal,
    publicRequest: true,
  });
  if (datos?.valid !== true)
    throw new Error('El enlace no es válido o ya venció. Solicita uno nuevo.');
}
export { verificarEnlace };
async function restablecerContrasena(token, correo, contrasena) {
  await solicitar('/auth/restablecer-contrasena', {
    method: 'POST',
    body: {
      token,
      correo,
      contrasena,
    },
    publicRequest: true,
  });
}
export { restablecerContrasena };
function errorContrasena(valor) {
  if (valor.length < 12) return 'Usa al menos 12 caracteres.';
  if (new TextEncoder().encode(valor).length > 72)
    return 'La contraseña supera el máximo de 72 bytes. Usa una más corta.';
  return '';
}
export { errorContrasena };
