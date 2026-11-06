/** Transporte /api/v1: Bearer, tiempo máximo, respuesta data/meta y errores de validación del servidor. */
import { URL_API } from '../../configuracion/api.js';
import { caducarSesion, leerSesion } from './sesion.js';
class ErrorApi extends Error {
  constructor(mensaje, estado = 0, campos = [], codigo = '') {
    super(mensaje);
    this.name = 'ApiError';
    this.status = estado;
    this.fields = campos;
    this.code = codigo;
  }
}
export { ErrorApi };
async function solicitar(
  ruta,
  {
    method: metodo = 'GET',
    body: cuerpo,
    signal: senal,
    publicRequest: peticionPublica = false,
  } = {}
) {
  /* controlador: instancia que se mantiene durante la operación y se libera cuando corresponde. */
  const controlador = new AbortController();
  /* cancelar: operación local que atiende el evento o transforma la información. */
  const cancelar = () => controlador.abort();
  senal?.addEventListener('abort', cancelar, {
    once: true,
  });
  if (senal?.aborted) controlador.abort();
  /* tiempoMaximo: valor de trabajo utilizado en esta operación. */
  const tiempoMaximo = setTimeout(cancelar, 15000);
  /* sesion: valor de trabajo utilizado en esta operación. */
  const sesion = leerSesion();
  try {
    /* respuesta: valor de trabajo utilizado en esta operación. */
    const respuesta = await fetch(`${URL_API}/api/v1${ruta}`, {
      method: metodo,
      signal: controlador.signal,
      cache: 'no-store',
      headers: {
        ...(cuerpo
          ? {
              'Content-Type': 'application/json',
            }
          : {}),
        ...(!peticionPublica && sesion
          ? {
              Authorization: `Bearer ${sesion.tokenAcceso}`,
            }
          : {}),
      },
      ...(cuerpo
        ? {
            body: JSON.stringify(cuerpo),
          }
        : {}),
    });
    if (respuesta.status === 204)
      return {
        data: null,
      };
    /* respuestaDatos: valor de trabajo utilizado en esta operación. */
    const respuestaDatos = await respuesta.json().catch(() => null);
    if (!respuesta.ok) {
      if (respuesta.status === 401 && !peticionPublica) caducarSesion();
      throw new ErrorApi(
        respuestaDatos?.error?.message ||
          respuestaDatos?.detail ||
          'No se pudo completar la solicitud.',
        respuesta.status,
        respuestaDatos?.error?.fields || [],
        respuestaDatos?.error?.code
      );
    }
    if (!respuestaDatos || !Object.hasOwn(respuestaDatos, 'data'))
      throw new ErrorApi('El servidor devolvió una respuesta inesperada.');
    return respuestaDatos;
  } catch (error) {
    if (error instanceof ErrorApi || senal?.aborted) throw error;
    throw new ErrorApi(
      controlador.signal.aborted
        ? 'El servidor tardó demasiado. Puedes volver a intentarlo.'
        : 'No pudimos conectar con el servidor. Comprueba tu conexión e inténtalo nuevamente.'
    );
  } finally {
    clearTimeout(tiempoMaximo);
    senal?.removeEventListener('abort', cancelar);
  }
}
export { solicitar };
