/** Recuperación con código de 6 dígitos: el servidor limita los intentos y revalida al guardar. */
import { solicitar } from './cliente.js';
async function solicitarRecuperacion(correo) {
  await solicitar('/auth/olvide-contrasena', {
    method: 'POST',
    body: { correo },
    publicRequest: true,
  });
}
export { solicitarRecuperacion };
async function verificarCodigo(correo, codigo) {
  const { data: datos } = await solicitar('/auth/validar-recuperacion', {
    method: 'POST',
    body: { correo, codigo },
    publicRequest: true,
  });
  if (datos?.valid !== true)
    throw new Error('El código no es válido o ya venció. Solicita uno nuevo.');
}
export { verificarCodigo };
async function restablecerContrasena(correo, codigo, contrasena) {
  await solicitar('/auth/restablecer-contrasena', {
    method: 'POST',
    body: { correo, codigo, contrasena },
    publicRequest: true,
  });
}
export { restablecerContrasena };
function errorContrasena(valor) {
  if (valor.length < 6) return 'Usa al menos 6 caracteres.';
  if (new TextEncoder().encode(valor).length > 72)
    return 'La contraseña supera el máximo de 72 bytes. Usa una más corta.';
  return '';
}
export { errorContrasena };
