/** Avisa cuando cambian los recursos indicados (uno o una lista); sin canal activo, consulta
 * cada 15 s como respaldo. */
import { useEffect as useEfecto, useState as useEstado } from 'react';
import { suscribirEventos } from '../servicios/eventos.js';

const AGRUPAR_MS = 250; // Varios cambios seguidos producen una sola consulta.
const RESPALDO_MS = 15000;

export function useEventos(recurso, alCambiar) {
  const [estado, cambiarEstado] = useEstado('reconectando');
  /* Texto estable: una lista nueva en cada render no reabre la suscripción. */
  const recursos = [].concat(recurso || []).join(',');
  useEfecto(() => {
    if (!recursos) return;
    const vigilados = recursos.split(',');
    let agrupador = null;
    const avisar = () => {
      clearTimeout(agrupador);
      agrupador = setTimeout(alCambiar, AGRUPAR_MS);
    };
    let respaldo = null;
    const alEstado = (nuevo) => {
      cambiarEstado(nuevo);
      clearInterval(respaldo);
      if (nuevo === 'conectado') avisar(); // Recupera lo ocurrido antes de conectar.
      else respaldo = setInterval(alCambiar, RESPALDO_MS);
    };
    const cancelar = suscribirEventos({
      alEstado,
      alCambio: (evento) => {
        if (vigilados.includes(evento.recurso)) avisar();
      },
    });
    respaldo = setInterval(alCambiar, RESPALDO_MS);
    return () => {
      cancelar();
      clearTimeout(agrupador);
      clearInterval(respaldo);
    };
  }, [recursos, alCambiar]);
  return estado;
}
