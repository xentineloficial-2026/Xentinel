/** Cinco contactos de ejemplo con foto y datos claramente identificados. */
import { Mail as Correo, Phone as Telefono } from 'lucide-react';
import { contactos } from '../../configuracion/contactos.js';
function Contactos() {
  return (
    <section className="xn-seccion xn-pagina">
      <h1>
        Detrás de Xentinel,
        <br />
        <span>hay un equipo.</span>
      </h1>
      <p className="xn-pagina-introduccion">
        Un punto de contacto para cada conversación.
      </p>
      <p className="xn-ejemplo-notice">
        Directorio de demostración: nombres, teléfonos y correos de ejemplo. Las
        imágenes son ilustrativas.
      </p>
      <div className="xn-contacto-cuadricula">
        {contactos.map((contacto) => (
          <article className="xn-contacto-tarjeta" key={contacto.correo}>
            <div className="xn-contacto-foto">
              <img
                src={contacto.foto}
                alt={`Foto ilustrativa del contacto ${contacto.nombre}`}
                loading="lazy"
                width="320"
                height="360"
              />
            </div>
            <div className="xn-contacto-informacion">
              <p>{contacto.rol}</p>
              <h2>{contacto.nombre}</h2>
              <span>
                <Telefono size={15} />
                {contacto.telefono}
              </span>
              <span>
                <Correo size={15} />
                {contacto.correo}
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
export { Contactos };
