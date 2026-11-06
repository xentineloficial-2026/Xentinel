/** Estadísticas compartidas por administración e instructores: mismas tarjetas, gráfica y tabla; datos según permisos. */
import { useEffect as useEfecto, useState as useEstado } from 'react';
import {
  CalendarDays as Calendario,
  DoorOpen as Puerta,
  UsersRound as Personas,
  Bell as Campana,
  ArrowUpRight as FlechaDiagonal,
} from 'lucide-react';
import { Link as Enlace } from 'react-router-dom';
import { useAutenticacion } from '../contextos/autenticacion.js';
import { useRecurso } from '../ganchos/useRecurso.js';
import { rolParaUsuario } from '../../configuracion/navegacion.js';
import { EstadoConsulta } from './MensajeEstado.jsx';
import { TablaDatos } from './TablaDatos.jsx';
import { formatearFecha } from '../utilidades/tablas.js';
/** Cuenta hasta el valor al aparecer; con movimiento reducido lo muestra de inmediato. */
function Cifra({ valor }) {
  const [mostrado, cambiarMostrado] = useEstado(0);
  useEfecto(() => {
    const inicio = performance.now();
    const reducido = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cuadro = requestAnimationFrame(function avanzar(ahora) {
      const t = reducido ? 1 : Math.min(1, (ahora - inicio) / 800);
      cambiarMostrado(Math.round(valor * (1 - (1 - t) ** 3)));
      if (t < 1) cuadro = requestAnimationFrame(avanzar);
    });
    return () => cancelAnimationFrame(cuadro);
  }, [valor]);
  return mostrado;
}
function Indicador({
  titulo,
  recurso,
  icono: Icono,
  descripcion,
  limitado = false,
}) {
  return (
    <article className="xn-indicador">
      <div>
        <span>{titulo}</span>
        <Icono size={20} />
      </div>
      <strong>
        {recurso.estado === 'listo' ? (
          <>
            <Cifra valor={recurso.datos.length} />
            {limitado && recurso.datos.length === 100 ? '+' : ''}
          </>
        ) : (
          '—'
        )}
      </strong>
      <p>
        {recurso.estado === 'error'
          ? 'No pudimos cargar este dato.'
          : recurso.estado === 'cargando'
            ? 'Consultando…'
            : descripcion}
      </p>
      {recurso.estado === 'error' && (
        <button
          className="xn-texto-enlace xn-enlace-boton"
          onClick={recurso.actualizar}
        >
          Reintentar
        </button>
      )}
    </article>
  );
}
function Resumen() {
  /* usuario: valor de trabajo utilizado en esta operación. */
  const { usuario } = useAutenticacion();
  /* esAdministrador: valor de trabajo utilizado en esta operación. */
  const esAdministrador = rolParaUsuario(usuario) === 'admin';
  /* integrantes: consulta cancelable al servidor, con datos, estado y reintento. */
  const integrantes = useRecurso(
    esAdministrador
      ? '/usuarios?limit=100'
      : `/usuarios/${usuario.id_usuarios}/fichas`
  );
  /* destinoAccesos: el módulo de ingresos solo existe para administrador y celador. */
  const destinoAccesos = ['admin', 'celador'].includes(rolParaUsuario(usuario))
    ? '?modulo=ingresos'
    : '?modulo=asistencias';
  /* accesos: consulta cancelable al servidor, con datos, estado y reintento. */
  const accesos = useRecurso('/ingresos?limit=100');
  /* alertas: consulta cancelable al servidor, con datos, estado y reintento. */
  const alertas = useRecurso('/alertas/activas');
  /* academico: consulta cancelable al servidor, con datos, estado y reintento. */
  const academico = useRecurso(
    esAdministrador ? '/fichas?limit=100' : '/asistencias?limit=100'
  );
  /* claveFecha: operación local que atiende el evento o transforma la información. */
  const claveFecha = (valor) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Bogota',
    }).format(new Date(valor));
  /* dias: valor de trabajo utilizado en esta operación. */
  const dias = Array.from(
    {
      length: 7,
    },
    (_, indice) => {
      /* fecha: instancia que se mantiene durante la operación y se libera cuando corresponde. */
      const fecha = new Date();
      fecha.setDate(fecha.getDate() - (6 - indice));
      return {
        clave: claveFecha(fecha),
        etiqueta: new Intl.DateTimeFormat('es-CO', {
          weekday: 'short',
          timeZone: 'America/Bogota',
        }).format(fecha),
        cantidad: (accesos.datos || []).filter(
          (elemento) =>
            claveFecha(elemento.fechahora) === claveFecha(fecha) &&
            elemento.tipo === 'ENTRADA' &&
            elemento.estado === 'Permitido'
        ).length,
      };
    }
  );
  /* maximo: valor de trabajo utilizado en esta operación. */
  const maximo = Math.max(1, ...dias.map((dia) => dia.cantidad));
  /* permitidos: parte de los accesos consultados que el sistema autorizó. */
  const totalAccesos = accesos.datos?.length || 0;
  const permitidos = totalAccesos
    ? Math.round(
        ((accesos.datos || []).filter(
          (elemento) => elemento.estado === 'Permitido'
        ).length /
          totalAccesos) *
          100
      )
    : 0;
  return (
    <>
      <div className="xn-panel-titulo">
        <div>
          <h1>
            Hola, {usuario.nombres_completos?.split(' ')[0] || 'de nuevo'}
          </h1>
          <p>
            {esAdministrador
              ? 'Qué bueno verte. Aquí tienes una mirada a tu comunidad.'
              : 'Qué bueno tenerte aquí. Vamos a organizar tu día.'}
          </p>
        </div>
        <span className="xn-fecha-etiqueta">
          <Calendario size={15} />
          {new Intl.DateTimeFormat('es-CO', {
            dateStyle: 'long',
            timeZone: 'America/Bogota',
          }).format(new Date())}
        </span>
      </div>
      {!esAdministrador && (
        <section className="xn-franja-resumen">
          <div>
            <h2>Tu carnet, listo para entrar.</h2>
            <p>Muéstralo en el punto de control y sigue tu camino.</p>
          </div>
          <Enlace className="xn-boton" to="?modulo=qr">
            Ver mi código QR <FlechaDiagonal size={16} />
          </Enlace>
        </section>
      )}
      <div className="xn-indicadores">
        <Indicador
          titulo={esAdministrador ? 'Personas registradas' : 'Mis fichas'}
          recurso={integrantes}
          icono={Personas}
          descripcion={
            esAdministrador
              ? 'Personas consultadas en el directorio'
              : 'Fichas asignadas a tu perfil'
          }
          limitado={esAdministrador}
        />
        <Indicador
          titulo="Accesos recientes"
          recurso={accesos}
          icono={Puerta}
          descripcion={
            esAdministrador
              ? 'Hasta los últimos 100 movimientos'
              : 'Hasta tus últimos 100 movimientos'
          }
          limitado
        />
        <Indicador
          titulo={esAdministrador ? 'Fichas disponibles' : 'Mis asistencias'}
          recurso={academico}
          icono={Calendario}
          descripcion={
            esAdministrador
              ? 'Fichas consultadas'
              : 'Registros personales consultados'
          }
          limitado
        />
        <Indicador
          titulo="Alertas activas"
          recurso={alertas}
          icono={Campana}
          descripcion="Reportadas por la institución"
        />
      </div>
      <div className="xn-resumen-cuadricula">
        <section className="xn-trabajo-tarjeta">
          <div className="xn-tarjeta-titulo">
            <h2>
              {esAdministrador
                ? 'Ingresos de la comunidad'
                : 'Tus ingresos esta semana'}
            </h2>
            <span className="xn-ayuda">Últimos 7 días</span>
          </div>
          <EstadoConsulta recurso={accesos}>
            <div
              className="xn-barra-grafica"
              role="img"
              aria-label={dias
                .map((dia) => `${dia.etiqueta}: ${dia.cantidad} entradas`)
                .join(', ')}
            >
              {dias.map((dia) => (
                <div key={dia.clave} className="xn-barra-elemento">
                  <span>{dia.cantidad}</span>
                  <div className="xn-barra-pista">
                    <div
                      style={{
                        height: `${(dia.cantidad / maximo) * 100}%`,
                      }}
                    />
                  </div>
                  <small>{dia.etiqueta}</small>
                </div>
              ))}
            </div>
            <p className="xn-ayuda">
              Entradas permitidas dentro de los últimos 100 registros
              consultados. Los valores no representan un total histórico.
            </p>
          </EstadoConsulta>
        </section>
        <section className="xn-trabajo-tarjeta">
          <h2>Resultado de los accesos</h2>
          <EstadoConsulta recurso={accesos}>
            {totalAccesos ? (
              <>
                <div
                  className="xn-dona"
                  role="img"
                  aria-label={`${permitidos} % de accesos permitidos`}
                >
                  <svg viewBox="0 0 42 42">
                    <circle cx="21" cy="21" r="15.9" />
                    <circle
                      cx="21"
                      cy="21"
                      r="15.9"
                      pathLength="100"
                      strokeDasharray={`${permitidos} 100`}
                    />
                  </svg>
                  <strong>{permitidos} %</strong>
                </div>
                <p className="xn-ayuda">
                  Permitidos entre los últimos {totalAccesos} movimientos.
                </p>
              </>
            ) : (
              <p className="xn-ayuda">Todavía no hay movimientos.</p>
            )}
          </EstadoConsulta>
        </section>
        <section className="xn-trabajo-tarjeta xn-rapido-acciones">
          <h2>¿Por dónde empezamos?</h2>
          <p>Lo que necesitas, a un paso.</p>
          <Enlace to={destinoAccesos}>
            Consultar accesos <FlechaDiagonal size={18} />
          </Enlace>
          <Enlace
            to={
              esAdministrador
                ? '?modulo=usuarios'
                : rolParaUsuario(usuario) === 'celador'
                  ? '?modulo=ingresos'
                  : '?modulo=fichas'
            }
          >
            {esAdministrador
              ? 'Gestionar personas'
              : rolParaUsuario(usuario) === 'celador'
                ? 'Registrar un movimiento'
                : 'Consultar mis fichas'}{' '}
            <FlechaDiagonal size={18} />
          </Enlace>
          <Enlace
            to={
              rolParaUsuario(usuario) === 'celador'
                ? '?modulo=qr'
                : '?modulo=horarios'
            }
          >
            {rolParaUsuario(usuario) === 'celador'
              ? 'Mi código QR'
              : 'Revisar horarios'}{' '}
            <FlechaDiagonal size={18} />
          </Enlace>
          <Enlace to="?modulo=alertas">
            Ver alertas <FlechaDiagonal size={18} />
          </Enlace>
        </section>
      </div>
      <section className="xn-trabajo-tarjeta">
        <div className="xn-tarjeta-titulo">
          <h2>Últimos movimientos</h2>
          <Enlace className="xn-texto-enlace" to={destinoAccesos}>
            Ver historial <FlechaDiagonal size={15} />
          </Enlace>
        </div>
        <EstadoConsulta recurso={accesos}>
          <TablaDatos
            claveFila="id_acceso"
            filas={accesos.datos?.slice(0, 5) || []}
            columnas={[
              {
                clave: 'id_usuarios',
                etiqueta: 'Usuario',
              },
              {
                clave: 'tipo',
                etiqueta: 'Movimiento',
              },
              {
                clave: 'fechahora',
                etiqueta: 'Fecha y hora',
                representar: (fila) => formatearFecha(fila.fechahora),
              },
              {
                clave: 'estado',
                etiqueta: 'Resultado',
                representar: (fila) => (
                  <span
                    className={`xn-estado ${fila.estado === 'Permitido' ? 'es-exito' : 'es-peligro'}`}
                  >
                    {fila.estado}
                  </span>
                ),
              },
            ]}
            vacio="Todavía no hay movimientos. Aparecerán aquí cuando se registren."
          />
        </EstadoConsulta>
      </section>
    </>
  );
}
export { Resumen };
