/** Canal SSE de /api/v1/eventos con Bearer. EventSource no admite cabeceras, por eso usa fetch. */
import { URL_API } from '../../configuracion/api.js';
import { caducarSesion, leerSesion } from './sesion.js';

// El servidor envía un checkpoint cada 15 s. Sin datos, la conexión se da por perdida:
// un proxy puede dejar el stream abierto aunque el backend ya no exista.
const SIN_DATOS_MS = 25000;
const ESPERA_MINIMA_MS = 2000;
const ESPERA_MAXIMA_MS = 15000;

/** Separa los bloques completos del búfer; lo incompleto queda para el siguiente fragmento. */
export function extraerEventos(bufer) {
  const bloques = bufer.replace(/\r\n/g, '\n').split('\n\n');
  const resto = bloques.pop();
  const eventos = [];
  for (const bloque of bloques) {
    const evento = { tipo: 'message', id: null, datos: null };
    for (const linea of bloque.split('\n')) {
      if (linea.startsWith('event: ')) evento.tipo = linea.slice(7);
      else if (linea.startsWith('id: ')) evento.id = linea.slice(4);
      else if (linea.startsWith('data: ')) {
        try {
          evento.datos = JSON.parse(linea.slice(6));
        } catch {
          evento.datos = null;
        }
      }
    }
    if (evento.datos) eventos.push(evento);
  }
  return { eventos, resto };
}

/**
 * Mantiene la conexión y reconecta conservando el cursor hasta cancelar.
 * Un fallo de red nunca se propaga: se informa el estado y se reintenta.
 */
export function suscribirEventos({ alCambio, alEstado, fetchImpl = fetch }) {
  let cancelado = false;
  let controlador = null;
  let reloj = null;
  let cursor = '0';
  let espera = ESPERA_MINIMA_MS;

  const leer = async (respuesta) => {
    const lector = respuesta.body.getReader();
    const decodificador = new TextDecoder();
    let bufer = '';
    const vigilar = () => {
      clearTimeout(reloj);
      reloj = setTimeout(() => controlador?.abort(), SIN_DATOS_MS);
    };
    vigilar();
    while (!cancelado) {
      const { value, done } = await lector.read();
      if (done) return;
      vigilar();
      bufer += decodificador.decode(value, { stream: true });
      const { eventos, resto } = extraerEventos(bufer);
      bufer = resto;
      for (const evento of eventos) {
        if (evento.tipo === 'auth-expired') {
          caducarSesion();
          cancelado = true;
          return;
        }
        if (evento.tipo === 'change') alCambio(evento.datos);
        if (evento.id) cursor = evento.id;
      }
    }
  };

  const ciclo = async () => {
    while (!cancelado) {
      const sesion = leerSesion();
      if (!sesion) break;
      controlador = new AbortController();
      try {
        const respuesta = await fetchImpl(
          `${URL_API}/api/v1/eventos?after=${cursor}`,
          {
            signal: controlador.signal,
            cache: 'no-store',
            headers: {
              Accept: 'text/event-stream',
              Authorization: `Bearer ${sesion.tokenAcceso}`,
            },
          }
        );
        if (respuesta.status === 401) {
          caducarSesion();
          break;
        }
        // El cursor es posterior al último evento: la base se restauró; se vuelve a sincronizar.
        if (respuesta.status === 409) cursor = '0';
        if (respuesta.status === 429) espera = ESPERA_MAXIMA_MS;
        if (respuesta.ok && respuesta.body) {
          alEstado('conectado');
          espera = ESPERA_MINIMA_MS;
          await leer(respuesta);
        }
      } catch {
        /* Red caída, proxy reiniciado o vigilancia vencida: se reintenta abajo. */
      } finally {
        clearTimeout(reloj);
      }
      if (cancelado) break;
      alEstado('reconectando');
      await new Promise((resolver) => {
        reloj = setTimeout(resolver, espera);
      });
      espera = Math.min(espera * 2, ESPERA_MAXIMA_MS);
    }
  };

  ciclo();
  return () => {
    cancelado = true;
    clearTimeout(reloj);
    controlador?.abort();
  };
}
