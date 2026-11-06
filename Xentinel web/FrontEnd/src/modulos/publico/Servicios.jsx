/** Dos propuestas SaaS con identidad editorial propia y periodicidad accesible; la compra permanece bloqueada. */
import { useState as useEstado } from 'react';
import {
  ArrowUpRight as Flecha,
  Check as Verificacion,
  LockKeyhole as Candado,
} from 'lucide-react';
import './servicios.css';
/* planes: valor de trabajo utilizado en esta operación. */
const planes = [
  {
    nombre: 'Corporativo',
    numero: '01',
    subtitulo: 'El espacio para crecer juntos.',
    descripcion:
      'Una visión compartida de las personas, los accesos y los espacios de tu organización.',
    caracteristicas: [
      'Control de acceso entre sedes',
      'Personas y roles, en un solo lugar',
      'Visibilidad de entradas y salidas',
      'Acompañamiento a tu operación',
    ],
    nota: 'Para organizaciones con una mirada a gran escala.',
  },
  {
    nombre: 'Institucional',
    numero: '02',
    subtitulo: 'Una comunidad que avanza.',
    descripcion:
      'La vida académica y el cuidado de tu comunidad, conectados en una experiencia cercana.',
    caracteristicas: [
      'Perfiles para cada miembro de la comunidad',
      'Fichas, jornadas y calendario académico',
      'Consulta de asistencia y movimientos',
      'Alertas y coordinación institucional',
    ],
    nota: 'Para instituciones que cuidan a quienes aprenden.',
  },
];
export function Servicios() {
  /* periodo, cambiarPeriodo: estado de la vista y función para actualizarlo. */
  const [periodo, cambiarPeriodo] = useEstado('mensual');
  return (
    <section className="xn-servicios xn-seccion xn-pagina">
      <div className="xn-servicios-presentacion">
        <p className="xn-sello-servicios">
          <span />
          EN DESARROLLO
        </p>
        <h1>
          Un entorno seguro.
          <br />
          <span>Posibilidades más grandes.</span>
        </h1>
        <p className="xn-pagina-introduccion">
          Estamos construyendo el siguiente paso para las organizaciones que
          ponen a las personas primero.
        </p>
      </div>
      <div className="xn-franja-planes">
        <div>
          <span>Una plataforma. Dos formas de crecer.</span>
          <p>Selecciona cómo te gustaría organizar tu facturación.</p>
        </div>
        <div
          className="xn-selector-periodo"
          role="group"
          aria-label="Periodo de facturación"
        >
          {['mensual', 'anual'].map((opcion) => (
            <button
              key={opcion}
              aria-pressed={periodo === opcion}
              onClick={() => cambiarPeriodo(opcion)}
            >
              {opcion === 'mensual' ? 'Mensual' : 'Anual'}
            </button>
          ))}
        </div>
      </div>
      <div className="xn-propuestas">
        {planes.map((plan) => (
          <article className="xn-propuesta" key={plan.nombre}>
            <div className="xn-propuesta-numero">
              <span>{plan.numero} / Xentinel</span>
              <Flecha size={22} />
            </div>
            <h2>{plan.nombre}</h2>
            <p className="xn-propuesta-subtitulo">{plan.subtitulo}</p>
            <p>{plan.descripcion}</p>
            <div className="xn-propuesta-precio" aria-live="polite">
              <span>PRECIO POR ANUNCIAR</span>
              <strong>
                {periodo === 'mensual'
                  ? 'Mes a mes.'
                  : 'Una visión de todo el año.'}
              </strong>
              <p>Propuesta de facturación {periodo}.</p>
            </div>
            <button className="xn-boton" disabled>
              <Candado size={16} />
              Aún no disponible
            </button>
            <ul>
              {plan.caracteristicas.map((caracteristica) => (
                <li key={caracteristica}>
                  <Verificacion size={16} />
                  {caracteristica}
                </li>
              ))}
            </ul>
            <p className="xn-propuesta-nota">{plan.nota}</p>
          </article>
        ))}
      </div>
      <div className="xn-cierre-servicios">
        <p>La tranquilidad empieza por tener todo en su lugar.</p>
        <span>Tarifas y condiciones se anunciarán antes del lanzamiento.</span>
      </div>
    </section>
  );
}
