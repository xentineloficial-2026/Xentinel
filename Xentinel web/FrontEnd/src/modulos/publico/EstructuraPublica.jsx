/** Cabecera, navegación adaptable y pie de página compartidos por las vistas públicas. */
import {
  useContext as useContexto,
  useEffect as useEfecto,
  useLayoutEffect as useEfectoDiseno,
  useRef as useReferencia,
  useState as useEstado,
} from 'react';
import {
  ArrowUpRight as FlechaDiagonal,
  Download as Descarga,
  Menu,
  X as Cerrar,
} from 'lucide-react';
import {
  Link as Enlace,
  NavLink as EnlaceNavegacion,
  Outlet as ContenidoRuta,
  useLocation as useUbicacion,
} from 'react-router-dom';
import { ContextoAutenticacion } from '../../compartido/contextos/autenticacion.js';
import { ConmutadorTema } from '../../compartido/componentes/ConmutadorTema.jsx';
import { Marca } from '../../compartido/identidad/Marca.jsx';
import { inicioParaUsuario } from '../../configuracion/navegacion.js';
import { FondoFacetas } from '../../compartido/visual/FondoFacetas.jsx';
import './publico.css';
/* En estas rutas el formulario de vidrio flota sobre las facetas 3D. */
const RUTAS_ACCESO = [
  '/login',
  '/registro',
  '/recuperar-contrasena',
  '/restablecer-contrasena',
];
function Navegacion() {
  /* abierto, cambiarAbierto: estado de la vista y función para actualizarlo. */
  const [abierto, cambiarAbierto] = useEstado(false);
  /* usuario: valor de trabajo utilizado en esta operación. */
  const { usuario } = useContexto(ContextoAutenticacion);
  const navegacion = useReferencia(null);
  /* Coloca la cápsula de vidrio sobre el enlace indicado; sin enlace vuelve al activo o se oculta. */
  const moverCapsula = (enlace) => {
    const contenedor = navegacion.current;
    const destino = enlace || contenedor?.querySelector('a.active');
    if (!contenedor) return;
    contenedor.style.setProperty('--ancho', `${destino?.offsetWidth || 0}px`);
    contenedor.style.setProperty('--x', `${destino?.offsetLeft || 0}px`);
  };
  useEfectoDiseno(() => moverCapsula());
  return (
    <header className="xn-cabecera">
      <div className="xn-cabecera-interior">
        <Marca />
        <button
          className="xn-menu-conmutador"
          type="button"
          aria-label={abierto ? 'Cerrar menú' : 'Abrir menú'}
          aria-expanded={abierto}
          aria-controls="xn-navegacion"
          onClick={() => cambiarAbierto(!abierto)}
        >
          {abierto ? <Cerrar /> : <Menu />}
        </button>
        <nav
          ref={navegacion}
          className={`xn-navegacion ${abierto ? 'esta-abierto' : ''}`}
          id="xn-navegacion"
          aria-label="Navegación principal"
          onPointerOver={(evento) =>
            moverCapsula(evento.target.closest('a'))
          }
          onPointerLeave={() => moverCapsula()}
          onKeyDown={(evento) => {
            if (evento.key === 'Escape') cambiarAbierto(false);
          }}
        >
          <EnlaceNavegacion to="/" end>
            Inicio
          </EnlaceNavegacion>
          <EnlaceNavegacion to="/plataforma">Plataforma</EnlaceNavegacion>
          <EnlaceNavegacion to="/servicios">
            Para empresas <FlechaDiagonal size={13} />
          </EnlaceNavegacion>
          <EnlaceNavegacion to="/contacto">Contáctanos</EnlaceNavegacion>
          <Enlace className="xn-movil-ingreso" to={inicioParaUsuario(usuario)}>
            {usuario ? 'Mi panel' : 'Iniciar sesión'}
          </Enlace>
        </nav>
        <div className="xn-cabecera-acciones">
          <Enlace
            className="xn-cabecera-ingreso"
            to={usuario ? inicioParaUsuario(usuario) : '/login'}
          >
            {usuario ? 'Mi panel' : 'Iniciar sesión'}
          </Enlace>
          <ConmutadorTema />
          <a className="xn-boton xn-boton--descarga" href="/Descarga.html">
            <Descarga size={16} />
            <span>Descarga nuestra app</span>
          </a>
        </div>
      </div>
    </header>
  );
}
function EstructuraPublica() {
  /* pathname, rutaActual: valor de trabajo utilizado en esta operación. */
  const { pathname: rutaActual } = useUbicacion();
  useEfecto(() => {
    /* titulos: valor de trabajo utilizado en esta operación. */
    const titulos = {
      '/': 'Gestión y control de acceso',
      '/plataforma': 'Plataforma',
      '/contacto': 'Contáctanos',
      '/servicios': 'Para empresas',
      '/privacidad': 'Política de Privacidad',
      '/terminos': 'Condiciones del Servicio',
      '/registro': 'Crear cuenta',
      '/login': 'Iniciar sesión',
      '/recuperar-contrasena': 'Recuperar contraseña',
      '/restablecer-contrasena': 'Restablecer contraseña',
    };
    document.title = `${titulos[rutaActual] || 'Plataforma'} · Xentinel`;
    window.scrollTo(0, 0);
  }, [rutaActual]);
  return (
    <div className="xn-sitio">
      <a className="xn-salto-enlace" href="#contenido">
        Saltar al contenido
      </a>
      {RUTAS_ACCESO.includes(rutaActual) && (
        <FondoFacetas className="xn-facetas--fija" />
      )}
      <Navegacion key={rutaActual} />
      <main id="contenido" tabIndex={-1}>
        <ContenidoRuta />
      </main>
      <footer className="xn-sitio-pie">
        <div className="xn-pie-superior">
          <p>
            La tranquilidad de saber
            <br />
            <strong>quién está dentro.</strong>
          </p>
          <Enlace to="/contacto" className="xn-texto-enlace">
            Hablemos <FlechaDiagonal size={19} />
          </Enlace>
        </div>
        <Marca grande />
        <div className="xn-pie-inferior">
          <span>
            © {new Date().getFullYear()} Xentinel. Gestión y control de acceso.
          </span>
          <span>Un proyecto de talento ADSO · SENA</span>
          <Enlace to="/privacidad">Política de Privacidad</Enlace>
          <Enlace to="/terminos">Condiciones del Servicio</Enlace>
          <Enlace to="/servicios">
            Soluciones para organizaciones <FlechaDiagonal size={13} />
          </Enlace>
        </div>
      </footer>
    </div>
  );
}
export { EstructuraPublica };
