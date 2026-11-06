/** Decide qué alerta activa debe interrumpir la pantalla y recuerda las ya atendidas en esta sesión. */
import { useState as useEstado } from 'react';

const CLAVE_ATENDIDAS = 'xentinel-alertas-atendidas';
const ORDEN = { critica: 0, alta: 1, moderada: 2 };

/** Identifica la versión de la alerta: si el mensaje cambia, la interrupción vuelve a mostrarse. */
const huella = (alerta) =>
  `${alerta.id_alerta}|${alerta.severidad}|${alerta.mensaje}`;

/** Una severidad desconocida nunca se degrada: se trata como alta, igual que en la app. */
export const severidadDe = (alerta) =>
  ['informativa', 'moderada', 'alta', 'critica'].includes(alerta.severidad)
    ? alerta.severidad
    : 'alta';

const leerAtendidas = () => {
  try {
    return JSON.parse(sessionStorage.getItem(CLAVE_ATENDIDAS)) || [];
  } catch {
    return [];
  }
};

/** Devuelve la alerta más grave entre las activas no atendidas. */
export function useInterrupcion(alertas) {
  const [atendidas, cambiarAtendidas] = useEstado(leerAtendidas);
  const alerta = (alertas || [])
    .filter(
      (elemento) =>
        severidadDe(elemento) !== 'informativa' &&
        !atendidas.includes(huella(elemento))
    )
    .sort((a, b) => ORDEN[severidadDe(a)] - ORDEN[severidadDe(b)])[0];
  const atender = () => {
    const siguientes = [...atendidas, huella(alerta)];
    cambiarAtendidas(siguientes);
    try {
      sessionStorage.setItem(CLAVE_ATENDIDAS, JSON.stringify(siguientes));
    } catch {
      /* Sin almacenamiento, sigue atendida mientras la pestaña esté abierta. */
    }
  };
  return { alerta, atender };
}
