/** Regla de la jornada: el día de formación de 5:00 a 23:00 con el tramo de la ficha
 * marcado. Mañana, tarde y noche se distinguen de un vistazo, sin leer las horas. */
import { horaCorta, minutosDe } from './utilidades.js';

const INICIO_DIA = 5;
const FIN_DIA = 23;
const MARCAS = [6, 12, 18];

function posicion(minutos) {
  const total = (FIN_DIA - INICIO_DIA) * 60;
  return Math.min(
    100,
    Math.max(0, ((minutos - INICIO_DIA * 60) / total) * 100)
  );
}

export function JornadaRegla({ nombre, inicio, fin, compacta = false }) {
  const desde = minutosDe(inicio);
  const hasta = minutosDe(fin);
  const definida = desde !== null && hasta !== null && hasta > desde;
  const texto = definida
    ? `${nombre ? `${nombre} · ` : ''}${horaCorta(inicio)}–${horaCorta(fin)}`
    : nombre || 'Sin jornada';
  return (
    <div
      className={`xn-jornada ${compacta ? 'xn-jornada--compacta' : ''}`}
      role="img"
      aria-label={
        definida
          ? `Jornada ${nombre ?? ''} de ${horaCorta(inicio)} a ${horaCorta(fin)}`
          : 'Jornada sin horario definido'
      }
    >
      <span className="xn-jornada-texto">{texto}</span>
      <span className={`xn-jornada-barra ${definida ? '' : 'es-vacia'}`}>
        {MARCAS.map((hora) => (
          <span
            key={hora}
            className="xn-jornada-marca"
            style={{ '--x': `${posicion(hora * 60)}%` }}
            data-hora={compacta ? undefined : hora}
          />
        ))}
        {definida && (
          <span
            className="xn-jornada-tramo"
            style={{
              '--x': `${posicion(desde)}%`,
              '--ancho': `${posicion(hasta) - posicion(desde)}%`,
            }}
          />
        )}
      </span>
    </div>
  );
}
