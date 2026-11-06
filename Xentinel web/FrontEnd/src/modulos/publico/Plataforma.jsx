/** Presenta los módulos y dirige a cada persona según su rol. */
import { useContext as useContexto } from 'react';
import {
  Bell as Campana,
  CalendarDays as Calendario,
  ClipboardCheck as ListaVerificada,
  ScanLine as Escaneo,
  ShieldCheck as EscudoVerificado,
  UsersRound as Personas,
  ArrowUpRight as FlechaDiagonal,
} from 'lucide-react';
import { Link as Enlace } from 'react-router-dom';
import { ContextoAutenticacion } from '../../compartido/contextos/autenticacion.js';
import {
  modulosPlataforma,
  rolParaUsuario,
} from '../../configuracion/navegacion.js';
/* iconos: valor de trabajo utilizado en esta operación. */
const iconos = {
  scan: Escaneo,
  users: Personas,
  check: ListaVerificada,
  calendar: Calendario,
  bell: Campana,
  shield: EscudoVerificado,
};
/* nombresRoles: valor de trabajo utilizado en esta operación. */
const nombresRoles = {
  admin: 'Administración',
  instructor: 'Instructores',
  visitante: 'Comunidad',
  celador: 'Celadores',
};
function Plataforma() {
  /* usuario: valor de trabajo utilizado en esta operación. */
  const { usuario } = useContexto(ContextoAutenticacion);
  /* rol: valor de trabajo utilizado en esta operación. */
  const rol = rolParaUsuario(usuario);
  return (
    <section className="xn-seccion xn-pagina">
      <h1>
        Todo en su lugar.
        <br />
        <span>Tu gestión, más simple.</span>
      </h1>
      <p className="xn-pagina-introduccion">
        Accede a las herramientas de tu rol. La información de tu institución
        permanece dentro de tu sesión.
      </p>
      <div className="xn-modulo-cuadricula">
        {modulosPlataforma.map((modulo) => {
          /* Icono: valor de trabajo utilizado en esta operación. */
          const Icono = iconos[modulo.icono];
          /* autorizado: valor de trabajo utilizado en esta operación. */
          const autorizado = usuario && modulo.roles.includes(rol);
          /* destino: valor de trabajo utilizado en esta operación. */
          const destino =
            modulo.destinos[rol] || modulo.destinos[modulo.roles[0]];
          return (
            <article className="xn-modulo" key={modulo.id}>
              <Icono size={25} />
              <div className="xn-modulo-roles">
                {modulo.id === 'perfil'
                  ? 'Todos los roles'
                  : modulo.roles
                      .map((elemento) => nombresRoles[elemento])
                      .join(' · ')}
              </div>
              <h2>{modulo.titulo}</h2>
              <p>{modulo.descripcion}</p>
              {modulo.disponibilidad && (
                <small className="xn-estado-nota">
                  {modulo.disponibilidad}
                </small>
              )}
              {autorizado ? (
                <Enlace className="xn-texto-enlace" to={destino}>
                  Abrir módulo <FlechaDiagonal size={17} />
                </Enlace>
              ) : !usuario ? (
                <Enlace
                  className="xn-texto-enlace"
                  to="/login"
                  state={{
                    from: destino,
                  }}
                >
                  Iniciar sesión <FlechaDiagonal size={17} />
                </Enlace>
              ) : (
                <span className="xn-modulo-restringido">
                  Disponible para{' '}
                  {modulo.roles
                    .map((elemento) => nombresRoles[elemento].toLowerCase())
                    .join(' e ')}
                </span>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
export { Plataforma };
