/** Interrupción de pantalla completa ante una emergencia activa. Una sola tarea, botones grandes y sin distracciones. */
import {
  useEffect as useEfecto,
  useRef as useReferencia,
  useState as useEstado,
} from 'react';
import { Link as Enlace } from 'react-router-dom';
import {
  Check as Listo,
  LifeBuoy as Ayuda,
  LoaderCircle as Cargando,
  TriangleAlert as Triangulo,
} from 'lucide-react';
import { solicitar } from '../servicios/cliente.js';
import { useAutenticacion } from '../contextos/autenticacion.js';
import { rolParaUsuario } from '../../configuracion/navegacion.js';
import { formatearFecha } from '../utilidades/tablas.js';
import { severidadDe } from '../ganchos/useInterrupcion.js';
import { sonarSirena } from '../utilidades/sirena.js';

/* Mismo semáforo que la app y la API: rojo para crítica o alta, amarillo para moderada. */
const ETIQUETAS = {
  critica: 'Alerta roja (crítica)',
  alta: 'Alerta roja (alta)',
  moderada: 'Alerta amarilla (moderada)',
};

export function InterrupcionEmergencia({ alerta, alAtender, base }) {
  const { usuario } = useAutenticacion();
  const rol = rolParaUsuario(usuario);
  const principal = useReferencia(null);
  const [sos, cambiarSos] = useEstado({ estado: 'inactivo' });
  const severidad = severidadDe(alerta);
  /* Los simulacros de la API de riesgos llegan como «Sismo» con fuente PRUEBA. */
  const esSimulacro =
    /simulacro/i.test(alerta.tipo_alerta) || alerta.fuente === 'PRUEBA';
  /* Sirena al aparecer el aviso; se detiene al atenderlo. */
  useEfecto(() => sonarSirena(), []);
  useEfecto(() => {
    principal.current?.focus();
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = anterior;
    };
  }, []);
  /* Mismo flujo y mismo endpoint que el panel de alertas, disponible a un toque. */
  const pedirAyuda = () => {
    if (['enviando', 'enviado'].includes(sos.estado)) return;
    if (!navigator.geolocation) {
      cambiarSos({
        estado: 'error',
        mensaje: 'Tu navegador no permite obtener la ubicación.',
      });
      return;
    }
    cambiarSos({ estado: 'enviando' });
    navigator.geolocation.getCurrentPosition(
      async (posicion) => {
        try {
          await solicitar('/alertas/sos', {
            method: 'POST',
            body: {
              id_alerta: alerta.id_alerta,
              latitud: posicion.coords.latitude,
              longitud: posicion.coords.longitude,
            },
          });
          cambiarSos({ estado: 'enviado' });
        } catch (error) {
          cambiarSos({
            estado: 'error',
            mensaje: `${error.message} Vuelve a intentarlo.`,
          });
        }
      },
      () =>
        cambiarSos({
          estado: 'error',
          mensaje:
            'No pudimos obtener tu ubicación. Revisa los permisos y vuelve a intentarlo.',
        }),
      { timeout: 10000, maximumAge: 0, enableHighAccuracy: true }
    );
  };
  const atrapaFoco = (evento) => {
    if (evento.key !== 'Tab') return;
    const opciones = [
      ...evento.currentTarget.querySelectorAll('a,button:not(:disabled)'),
    ];
    const primero = opciones[0];
    const ultimo = opciones.at(-1);
    if (evento.shiftKey && document.activeElement === primero) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && document.activeElement === ultimo) {
      evento.preventDefault();
      primero.focus();
    }
  };
  return (
    <div
      className={`xn-interrupcion severidad-${severidad}`}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="interrupcion-titulo"
      aria-describedby="interrupcion-mensaje"
      onKeyDown={atrapaFoco}
    >
      <div className="xn-interrupcion-interior">
        <header className="xn-interrupcion-cabecera">
          <span>{ETIQUETAS[severidad]}</span>
          {alerta.fecha_inicio && (
            <span className="xn-interrupcion-hora">
              {formatearFecha(alerta.fecha_inicio)}
            </span>
          )}
        </header>
        {esSimulacro && (
          <p className="xn-interrupcion-simulacro">
            Simulacro. No es una emergencia real.
          </p>
        )}
        <div className="xn-interrupcion-cuerpo">
          <Triangulo className="xn-interrupcion-icono" strokeWidth={2.2} />
          <h1 id="interrupcion-titulo">{alerta.tipo_alerta}</h1>
          <p id="interrupcion-mensaje">{alerta.mensaje}</p>
        </div>
        <div className="xn-interrupcion-acciones">
          {sos.estado === 'error' && (
            <p className="xn-interrupcion-error" role="alert">
              {sos.mensaje}
            </p>
          )}
          {sos.estado === 'enviado' && (
            <p className="xn-interrupcion-enviado" role="status">
              <Listo size={24} strokeWidth={3} />
              Tu ubicación fue enviada al personal de control.
            </p>
          )}
          <div className="xn-interrupcion-botones">
            <button
              ref={principal}
              type="button"
              className="xn-interrupcion-boton"
              onClick={alAtender}
            >
              Entendido
            </button>
            {rol === 'admin' ? (
              <Enlace
                className="xn-interrupcion-boton xn-interrupcion-boton--ayuda"
                to={`${base}?modulo=alertas`}
                onClick={alAtender}
              >
                Ver solicitudes SOS
              </Enlace>
            ) : (
              <button
                type="button"
                className="xn-interrupcion-boton xn-interrupcion-boton--ayuda"
                onClick={pedirAyuda}
                disabled={['enviando', 'enviado'].includes(sos.estado)}
              >
                {sos.estado === 'enviando' ? (
                  <Cargando className="xn-girando" size={24} />
                ) : (
                  <Ayuda size={24} />
                )}
                {sos.estado === 'enviando'
                  ? 'Obteniendo ubicación…'
                  : sos.estado === 'enviado'
                    ? 'Ayuda solicitada'
                    : 'Necesito ayuda'}
              </button>
            )}
          </div>
          {rol !== 'admin' && (
            <p className="xn-interrupcion-nota">
              Al pedir ayuda compartes tu ubicación precisa con el personal de
              control de tu institución.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
