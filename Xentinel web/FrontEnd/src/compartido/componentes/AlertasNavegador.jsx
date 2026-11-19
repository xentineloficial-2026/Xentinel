/** Activa las alertas sísmicas push en este navegador. Solo aparece si la web tiene Firebase. */
import { useEffect as useEfecto, useState as useEstado } from 'react';
import {
  activarAlertasSismo,
  permisoPush,
  pushDisponible,
} from '../servicios/alertasPush.js';

const CLAVE_ACTIVO = 'xentinel-push-sismos';
const leerActivo = () => {
  try {
    return localStorage.getItem(CLAVE_ACTIVO) === '1';
  } catch {
    return false;
  }
};

export function AlertasNavegador() {
  /* estado: comprobando | oculto | inactivo | activando | activo | bloqueado */
  const [estado, cambiarEstado] = useEstado('comprobando');
  const [error, cambiarError] = useEstado('');
  useEfecto(() => {
    let vigente = true;
    pushDisponible()
      .catch(() => false)
      .then((disponible) => {
        if (!vigente) return;
        if (!disponible) cambiarEstado('oculto');
        else if (permisoPush() === 'denied') cambiarEstado('bloqueado');
        else
          cambiarEstado(
            permisoPush() === 'granted' && leerActivo() ? 'activo' : 'inactivo'
          );
      });
    return () => {
      vigente = false;
    };
  }, []);
  if (estado === 'comprobando' || estado === 'oculto') return null;
  const activar = async () => {
    cambiarEstado('activando');
    cambiarError('');
    try {
      await activarAlertasSismo();
      try {
        localStorage.setItem(CLAVE_ACTIVO, '1');
      } catch {
        /* Sin almacenamiento, la suscripción sigue activa en el servidor. */
      }
      cambiarEstado('activo');
    } catch (motivo) {
      cambiarError(motivo.message);
      cambiarEstado(permisoPush() === 'denied' ? 'bloqueado' : 'inactivo');
    }
  };
  const etiqueta = {
    activo: ['es-exito', 'Activas'],
    bloqueado: ['es-peligro', 'Bloqueadas'],
  }[estado] || ['es-neutro', 'Inactivas'];
  return (
    <article className="xn-trabajo-tarjeta">
      <div className="xn-tarjeta-titulo">
        <h2>Alertas sísmicas en este navegador</h2>
        <span className={`xn-estado ${etiqueta[0]}`}>{etiqueta[1]}</span>
      </div>
      <p>
        {estado === 'bloqueado'
          ? 'El navegador bloqueó las notificaciones de Xentinel. Permítelas en la configuración del sitio (icono junto a la dirección) y vuelve a intentarlo.'
          : 'Recibe el aviso de sismos cercanos a la sede aunque Xentinel esté minimizado o cerrado.'}
      </p>
      {error && (
        <p role="alert" className="xn-acceso-error">
          {error}
        </p>
      )}
      {estado !== 'activo' && estado !== 'bloqueado' && (
        <button
          className="xn-boton"
          onClick={activar}
          disabled={estado === 'activando'}
        >
          {estado === 'activando' ? 'Activando…' : 'Activar alertas'}
        </button>
      )}
    </article>
  );
}
