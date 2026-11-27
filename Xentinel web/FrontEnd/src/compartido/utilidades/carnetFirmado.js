/** Carnet QR firmado XN2 en el navegador, idéntico al de la app y al que verifica el servidor:
 * `XN2:<id>:<paso>:<firma>`, con `firma = Base32(HMAC-SHA256(clave, "XN2:<id>:<paso>"))[0:20]`
 * y `paso = floor(unix_segundos / 15)`. El código cambia cada 15 segundos. */
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(bytes) {
  let bits = 0;
  let valor = 0;
  let salida = '';
  for (const byte of bytes) {
    valor = ((valor << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      salida += BASE32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) salida += BASE32[(valor << (5 - bits)) & 31];
  return salida;
}

export function decodificarClave(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const binario = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(binario, (caracter) => caracter.charCodeAt(0));
}

export function pasoDe(milisegundos, pasoSegundos = 15) {
  return Math.floor(milisegundos / 1000 / pasoSegundos);
}

/** Importa la clave una sola vez; firmar cada paso no vuelve a tocarla. */
export async function prepararFirma(base64url) {
  const sutil = globalThis.crypto?.subtle;
  if (!sutil)
    throw new Error('Este navegador no puede generar el carnet firmado.');
  const clave = await sutil.importKey(
    'raw',
    decodificarClave(base64url),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return async (identificador, paso) => {
    const mensaje = new TextEncoder().encode(`XN2:${identificador}:${paso}`);
    const firma = new Uint8Array(await sutil.sign('HMAC', clave, mensaje));
    return `XN2:${identificador}:${paso}:${base32(firma).slice(0, 20)}`;
  };
}
