/** Equipo de trabajo de Xentinel: nombre y área de cada integrante. */
import { contactos } from '../../configuracion/contactos.js';
const iniciales = (nombre) =>
  nombre
    .split(' ')
    .slice(0, 2)
    .map((parte) => parte[0])
    .join('')
    .toUpperCase();
function Contactos() {
  return (
    <section className="xn-seccion xn-pagina">
      <h1>
        Detrás de Xentinel,
        <br />
        <span>hay un equipo.</span>
      </h1>
      <p className="xn-pagina-introduccion">
        Las personas que diseñan y construyen Xentinel.
      </p>
      <div className="xn-contacto-cuadricula">
        {contactos.map((contacto) => (
          <article className="xn-contacto-tarjeta" key={contacto.nombre}>
            <div className="xn-contacto-iniciales" aria-hidden="true">
              {iniciales(contacto.nombre)}
            </div>
            <div className="xn-contacto-informacion">
              <p>{contacto.rol}</p>
              <h2>{contacto.nombre}</h2>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
export { Contactos };
