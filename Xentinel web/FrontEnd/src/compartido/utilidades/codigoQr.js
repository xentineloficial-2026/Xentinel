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
const CARNET_FIRMADO = /^XN2:([1-9]\d{0,9}):(\d{1,12}):([A-Z2-7]{20})$/;
const CARNET_APP = /^XENTINEL:([1-9]\d{0,9}):(\d{1,15})$/;
const ID_MAXIMO = 2147483647;
/**
 * Reconoce los códigos de Xentinel: la identificación web (JSON), el carnet heredado de la
 * app (`XENTINEL:id:hora`) y el carnet rotativo firmado de la app (`XN2:id:paso:firma`).
 * Devuelve el ID y, para el carnet firmado, el código completo: el servidor verifica su
 * firma y vigencia al registrar el movimiento.
 */
export function leerCodigoAcceso(texto) {
  if (typeof texto !== 'string' || texto.length > 400)
    throw new Error('Este código no pertenece a Xentinel.');
  const contenido = texto.trim();
  for (const [patron, firmado] of [
    [CARNET_FIRMADO, true],
    [CARNET_APP, false],
  ]) {
    const partes = patron.exec(contenido);
    if (!partes) continue;
    const identificador = Number(partes[1]);
    if (identificador > ID_MAXIMO)
      throw new Error('El identificador QR no es válido.');
    return firmado
      ? { id_usuarios: identificador, codigo_qr: contenido }
      : { id_usuarios: identificador };
  }
  /* datos: valor de trabajo utilizado en esta operación. */
  let datos;
  try {
    datos = JSON.parse(contenido);
  } catch {
    throw new Error('No pudimos leer un identificador de Xentinel.');
  }
  if (
    datos?.sistema !== 'Xentinel' ||
    datos.version !== 1 ||
    !Number.isSafeInteger(datos.id_usuarios) ||
    datos.id_usuarios < 1 ||
    datos.id_usuarios > ID_MAXIMO
  )
    throw new Error('El identificador QR no es válido.');
  return { id_usuarios: datos.id_usuarios };
}
/** Compatibilidad: solo el ID. Un QR identifica; la firma la verifica el servidor. */
export function interpretarContenidoQr(texto) {
  return leerCodigoAcceso(texto).id_usuarios;
}
