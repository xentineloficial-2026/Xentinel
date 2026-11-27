/** Composición de módulos por rol. El estado de sesión se comparte y la API autoriza cada operación. */
import {
  useEffect as useEfecto,
  useState as useEstado,
  useRef as useReferencia,
} from 'react';
import {
  Link as Enlace,
  useLocation as useUbicacion,
  useSearchParams as useParametrosBusqueda,
} from 'react-router-dom';
import {
  Download as Descarga,
  LogOut as Salida,
  Menu,
  X as Cerrar,
  LayoutDashboard as Panel,
  DoorOpen as Puerta,
  UsersRound as Personas,
  BookOpen as Libro,
  CalendarDays as Calendario,
  Bell as Campana,
  QrCode as Codigo,
  UserRound as Persona,
  ArrowUpRight as Flecha,
  Clock as Reloj,
  TriangleAlert as Triangulo,
} from 'lucide-react';
import { useAutenticacion } from '../compartido/contextos/autenticacion.js';
import { useRecurso } from '../compartido/ganchos/useRecurso.js';
import { useEventos } from '../compartido/ganchos/useEventos.js';
import { ConmutadorTema } from '../compartido/componentes/ConmutadorTema.jsx';
import { Marca } from '../compartido/identidad/Marca.jsx';
import { Resumen } from '../compartido/componentes/Resumen.jsx';
import { ControlAccesos } from '../modulos/celador/ControlAccesos.jsx';
import { GestionPersonas } from '../modulos/admin/GestionPersonas.jsx';
import { GestionProgramas } from '../modulos/admin/GestionProgramas.jsx';
import { GestionFichas } from '../modulos/admin/GestionFichas.jsx';
import { ExportarHorarios } from '../modulos/admin/ExportarHorarios.jsx';
import { InformacionAcademica } from '../modulos/instructor/InformacionAcademica.jsx';
import { ListaAsistencia } from '../modulos/instructor/ListaAsistencia.jsx';
import { MiPerfil } from '../compartido/componentes/MiPerfil.jsx';
import { PanelAlertas } from '../compartido/componentes/PanelAlertas.jsx';
import { InterrupcionEmergencia } from '../compartido/componentes/InterrupcionEmergencia.jsx';
import { useInterrupcion } from '../compartido/ganchos/useInterrupcion.js';
import { escucharAlertasEnPrimerPlano } from '../compartido/servicios/alertasPush.js';
import { MiCredencial } from '../modulos/visitante/MiCredencial.jsx';
import { FondoFacetas } from '../compartido/visual/FondoFacetas.jsx';
import '../compartido/estilos/panel.css';
const etiquetas = {
  resumen: 'Mi día',
  ingresos: 'Ingresos y salidas',
  usuarios: 'Personas',
  programas: 'Programas',
  fichas: 'Fichas',
  jornadas: 'Jornadas',
  horarios: 'Calendario',
  asistencias: 'Asistencia',
  alertas: 'Alarmas',
  qr: 'Mi código QR',
  perfil: 'Mi perfil',
};
const iconos = {
  resumen: Panel,
  ingresos: Puerta,
  usuarios: Personas,
  programas: Libro,
  fichas: Libro,
  jornadas: Reloj,
  horarios: Calendario,
  asistencias: Calendario,
  alertas: Campana,
  qr: Codigo,
  perfil: Persona,
};
const modulos = {
  admin: Object.keys(etiquetas),
  instructor: [
    'resumen',
    'fichas',
    'horarios',
    'asistencias',
    'alertas',
    'qr',
    'perfil',
  ],
  celador: ['resumen', 'ingresos', 'alertas', 'qr', 'perfil'],
  visitante: [
    'resumen',
    'fichas',
    'horarios',
    'asistencias',
    'alertas',
    'qr',
    'perfil',
  ],
};
/** Revisa avisos activos al volver a la pestaña y cada treinta segundos. */
function AlertasActivas({ base }) {
  const recurso = useRecurso('/alertas/activas');
  const actualizar = recurso.actualizar;
  useEfecto(() => {
    const revisar = () => {
      if (!document.hidden) actualizar();
    };
    const temporizador = setInterval(revisar, 30000);
    window.addEventListener('xentinel:alerts-changed', revisar);
    document.addEventListener('visibilitychange', revisar);
    return () => {
      clearInterval(temporizador);
      window.removeEventListener('xentinel:alerts-changed', revisar);
      document.removeEventListener('visibilitychange', revisar);
    };
  }, [actualizar]);
  /* Con push activado, un sismo recarga las alertas sin esperar al próximo ciclo. */
  useEfecto(() => {
    let cancelar = () => {};
    let vigente = true;
    escucharAlertasEnPrimerPlano()
      .then((desuscribir) => {
        if (vigente) cancelar = desuscribir;
        else desuscribir();
      })
      .catch(() => {});
    return () => {
      vigente = false;
      cancelar();
    };
  }, []);
  const { alerta: urgente, atender } = useInterrupcion(recurso.datos);
  if (recurso.estado === 'error' && !recurso.datos?.length)
    return (
      <div className="xn-alert-franja" role="status">
        No pudimos comprobar las alertas.
        <button className="xn-enlace-boton" onClick={actualizar}>
          Reintentar
        </button>
      </div>
    );
  return (
    <>
      {urgente && (
        <InterrupcionEmergencia
          key={urgente.id_alerta}
          alerta={urgente}
          alAtender={atender}
          base={base}
        />
      )}
      <div aria-live="assertive">
        {recurso.datos?.map((alerta) => (
          <div
            key={alerta.id_alerta}
            className={`xn-alert-franja severidad-${alerta.severidad}`}
          >
            <Triangulo size={20} strokeWidth={2.4} />
            <strong>{alerta.tipo_alerta}</strong>
            <span>{alerta.mensaje}</span>
            <Enlace to={`${base}?modulo=alertas`}>Ver instrucciones</Enlace>
          </div>
        ))}
      </div>
    </>
  );
}
/** Celador y administración: aviso de carnets QR por revisar, en vivo, fuera del módulo de alarmas. */
function AlarmasEscaneo({ base }) {
  const recurso = useRecurso('/alarmas');
  const refrescar = recurso.refrescar;
  useEventos('alarmas_qr', refrescar);
  useEfecto(() => {
    window.addEventListener('xentinel:alerts-changed', refrescar);
    return () => window.removeEventListener('xentinel:alerts-changed', refrescar);
  }, [refrescar]);
  const escaneos = (recurso.datos || []).filter((alarma) => alarma.origen === 'qr');
  if (!escaneos.length) return null;
  const rojas = escaneos.filter((alarma) => alarma.semaforo === 'rojo').length;
  return (
    /* Franja sobria: no es una evacuación. Solo el ícono lleva el color del semáforo. */
    <div className="xn-alert-franja xn-alert-franja--escaneo" role="status">
      <Codigo
        size={20}
        strokeWidth={2.4}
        className={`xn-franja-luz es-${rojas ? 'rojo' : 'amarillo'}`}
        aria-hidden="true"
      />
      <strong>
        {escaneos.length === 1
          ? '1 carnet QR por revisar'
          : `${escaneos.length} carnets QR por revisar`}
      </strong>
      <span>
        {rojas
          ? `${rojas === 1 ? 'Uno no es verídico' : `${rojas} no son verídicos`}: verifica el documento de identidad.`
          : 'Carnets vencidos: pide que los actualicen en la app.'}
      </span>
      <Enlace to={`${base}?modulo=alertas`}>Revisar alarmas</Enlace>
    </div>
  );
}
/** rolEsperado procede de una entrada protegida; la navegación nunca sustituye la autorización del servidor. */
export function PanelTrabajo({ rolEsperado: rol }) {
  const { usuario, cerrarSesion } = useAutenticacion();
  const [parametros] = useParametrosBusqueda();
  const { pathname: rutaActual } = useUbicacion();
  const [abierto, cambiarAbierto] = useEstado(false); // Estado del menú móvil.
  const [esMovil, cambiarEsMovil] = useEstado(
    () => matchMedia('(max-width:760px)').matches
  ); // Cambia sin recargar al redimensionar.
  const referenciaLateral = useReferencia(null);
  const referenciaBotonMenu = useReferencia(null); // Restauración y contención de foco.
  useEfecto(() => {
    const consulta = matchMedia('(max-width:760px)');
    const ajustar = (evento) => {
      cambiarEsMovil(evento.matches);
      cambiarAbierto(false);
    };
    consulta.addEventListener('change', ajustar);
    return () => consulta.removeEventListener('change', ajustar);
  }, []);
  useEfecto(() => {
    if (!abierto || !esMovil) return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    referenciaLateral.current?.querySelector('button')?.focus();
    return () => {
      document.body.style.overflow = anterior;
      referenciaBotonMenu.current?.focus();
    };
  }, [abierto, esMovil]);
  const controlarTeclado = (evento) => {
    if (!abierto || !esMovil) return;
    if (evento.key === 'Escape') {
      cambiarAbierto(false);
      return;
    }
    if (evento.key !== 'Tab') return;
    const opciones = [
      ...referenciaLateral.current.querySelectorAll('a,button:not(:disabled)'),
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
  const solicitado =
    parametros.get('modulo') || rutaActual.split('/')[2] || 'resumen';
  const modulo =
    {
      asistencia: 'asistencias',
      horario: 'horarios',
      dashboard: 'resumen',
      codigo: 'qr',
    }[solicitado] || solicitado;
  const permitido = modulos[rol].includes(modulo);
  useEfecto(() => {
    document.title = `${etiquetas[modulo] || 'Mi espacio'} · Xentinel`;
    window.scrollTo(0, 0);
  }, [modulo]);
  let contenido;
  if (!permitido)
    contenido = (
      <section className="xn-trabajo-tarjeta">
        <h1>Este módulo no está disponible para tu rol.</h1>
        <Enlace className="xn-boton" to={`/${rol}`}>
          Volver a mi día
        </Enlace>
      </section>
    );
  else if (modulo === 'resumen') contenido = <Resumen />;
  else if (modulo === 'ingresos') contenido = <ControlAccesos />;
  else if (modulo === 'asistencias' && ['admin', 'instructor'].includes(rol))
    contenido = <ListaAsistencia />;
  else if (modulo === 'usuarios') contenido = <GestionPersonas />;
  else if (modulo === 'programas' && rol === 'admin')
    contenido = <GestionProgramas />;
  else if (modulo === 'fichas' && rol === 'admin')
    contenido = <GestionFichas />;
  else if (modulo === 'perfil') contenido = <MiPerfil />;
  else if (modulo === 'alertas') contenido = <PanelAlertas />;
  else if (modulo === 'qr') contenido = <MiCredencial />;
  else
    contenido = (
      <InformacionAcademica
        tipo={modulo}
        acciones={
          rol === 'admin' && modulo === 'horarios' ? <ExportarHorarios /> : null
        }
      />
    );
  return (
    <div className="xn-espacio">
      <FondoFacetas estatico />
      <a href="#contenido-panel" className="xn-salto-enlace">
        Saltar al contenido
      </a>
      <aside
        ref={referenciaLateral}
        inert={esMovil && !abierto ? true : undefined}
        role={esMovil ? 'dialog' : undefined}
        aria-modal={esMovil && abierto ? true : undefined}
        aria-label="Navegación de tu espacio"
        onKeyDown={controlarTeclado}
        className={`xn-lateral ${abierto ? 'esta-abierto' : ''}`}
      >
        <div className="xn-lateral-marca">
          <Marca />
          <button
            className="xn-cerrar-navegacion"
            onClick={() => cambiarAbierto(false)}
            aria-label="Cerrar navegación"
          >
            <Cerrar size={19} />
          </button>
        </div>
        <div className="xn-lateral-persona">
          <span className="xn-avatar">
            {usuario.nombres_completos?.slice(0, 1)}
          </span>
          <div>
            <strong>{usuario.nombres_completos}</strong>
            <small>{usuario.nombre_rol || rol}</small>
          </div>
        </div>
        <nav id="navegacion-panel" aria-label="Módulos de mi espacio">
          {modulos[rol].map((elemento) => {
            const Icono = iconos[elemento];
            return (
              <Enlace
                key={elemento}
                to={`/${rol}?modulo=${elemento}`}
                aria-current={elemento === modulo ? 'page' : undefined}
                onClick={() => cambiarAbierto(false)}
              >
                <Icono size={18} />
                <span>{etiquetas[elemento]}</span>
                {elemento === modulo && <span className="xn-punto-activo" />}
              </Enlace>
            );
          })}
        </nav>
        <div className="xn-pie-lateral">
          <Enlace to="/" className="xn-lateral-inicio">
            Explorar Xentinel
            <Flecha size={14} />
          </Enlace>
          <button className="xn-salir" onClick={cerrarSesion}>
            <Salida size={17} />
            Cerrar sesión
          </button>
        </div>
      </aside>
      {abierto && esMovil && (
        <button
          className="xn-fondo-navegacion"
          aria-label="Cerrar menú lateral"
          onClick={() => cambiarAbierto(false)}
        />
      )}
      <div
        className="xn-zona-panel"
        inert={esMovil && abierto ? true : undefined}
      >
        <header className="xn-trabajo-cabecera">
          <div className="xn-ruta-panel">
            <button
              ref={referenciaBotonMenu}
              className="xn-menu-conmutador xn-trabajo-menu"
              aria-controls="navegacion-panel"
              aria-expanded={abierto}
              aria-label="Abrir navegación"
              onClick={() => cambiarAbierto(true)}
            >
              <Menu size={19} />
            </button>
            <span>Mi espacio</span>
            <span>/</span>
            <strong>{etiquetas[modulo] || 'Página'}</strong>
          </div>
          <div className="xn-cabecera-acciones">
            <Enlace to="/contacto">Contáctanos</Enlace>
            <ConmutadorTema />
            <a className="xn-boton xn-boton--descarga" href="/Descarga.html">
              <Descarga size={15} />
              <span>Descarga nuestra app</span>
            </a>
          </div>
        </header>
        <main
          id="contenido-panel"
          tabIndex={-1}
          className="xn-trabajo-contenido"
        >
          <AlertasActivas base={`/${rol}`} />
          {['admin', 'celador'].includes(rol) && modulo !== 'alertas' && (
            <AlarmasEscaneo base={`/${rol}`} />
          )}
          <div key={`${rol}:${modulo}`} className="xn-modulo-entra">
            {contenido}
          </div>
          <footer className="xn-trabajo-pie">
            <span>Xentinel</span>
            <p>Tu comunidad, en buenas manos.</p>
          </footer>
        </main>
      </div>
    </div>
  );
}
