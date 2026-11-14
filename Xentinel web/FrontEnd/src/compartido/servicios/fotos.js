/** Fotos de perfil: se suben y se leen con el token de la sesión, porque una etiqueta <img> no puede enviarlo. */
import { URL_API } from '../../configuracion/api.js';
import { ErrorApi } from './cliente.js';
import { leerSesion } from './sesion.js';

export const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/gif'];
export const MAXIMO_FOTO = 3 * 1024 * 1024;

/** Devuelve el motivo si el archivo no sirve; vacío si es válido. */
export function errorFoto(archivo) {
  if (!TIPOS_FOTO.includes(archivo.type))
    return 'Usa una imagen JPG, JPEG, PNG o GIF.';
  if (archivo.size > MAXIMO_FOTO) return 'La foto debe pesar máximo 3 MB.';
  return '';
}

function cabeceras() {
  const sesion = leerSesion();
  return sesion ? { Authorization: `Bearer ${sesion.tokenAcceso}` } : {};
}

export async function subirFoto(idUsuario, archivo) {
  const respuesta = await fetch(
    `${URL_API}/api/v1/usuarios/${idUsuario}/foto`,
    {
      method: 'PUT',
      headers: { ...cabeceras(), 'Content-Type': archivo.type },
      body: archivo,
    }
  );
  const cuerpo = await respuesta.json().catch(() => null);
  if (!respuesta.ok)
    throw new ErrorApi(
      cuerpo?.error?.message || 'No pudimos subir la foto.',
      respuesta.status
    );
  return cuerpo.data;
}

/** URL local de la foto para mostrarla; null si la persona no tiene foto. */
export async function leerFoto(fotoUrl, senal) {
  if (!fotoUrl) return null;
  const respuesta = await fetch(`${URL_API}${fotoUrl}`, {
    headers: cabeceras(),
    signal: senal,
  });
  if (!respuesta.ok) return null;
  return URL.createObjectURL(await respuesta.blob());
}
