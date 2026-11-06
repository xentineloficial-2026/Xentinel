/** Contrato público del QR: identificador mínimo, sin contraseña, token de sesión ni datos personales. */
export function crearContenidoQr(identificador) {
  if (!Number.isSafeInteger(identificador) || identificador < 1)
    throw new Error('Identificador no válido.');
  return JSON.stringify({
    sistema: 'Xentinel',
    version: 1,
    id_usuarios: identificador,
  });
}
/** Reconoce únicamente el formato de Xentinel; un QR identifica y no acredita por sí solo la identidad. */
export function interpretarContenidoQr(texto) {
  if (typeof texto !== 'string' || texto.length > 400)
    throw new Error('Este código no pertenece a Xentinel.');
  /* datos: valor de trabajo utilizado en esta operación. */
  let datos;
  try {
    datos = JSON.parse(texto);
  } catch {
    throw new Error('No pudimos leer un identificador de Xentinel.');
  }
  if (
    datos.sistema !== 'Xentinel' ||
    datos.version !== 1 ||
    !Number.isSafeInteger(datos.id_usuarios) ||
    datos.id_usuarios < 1 ||
    datos.id_usuarios > 2147483647
  )
    throw new Error('El identificador QR no es válido.');
  return datos.id_usuarios;
}
