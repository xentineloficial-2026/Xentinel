/** Información académica visual: fichas y catálogos en tarjetas, clases en semana y asistencia en mes. */
import { useState as useEstado } from 'react';
import {
  BookOpen as Libro,
  Clock as Reloj,
  MapPin as Ubicacion,
  ChevronLeft as Anterior,
  ChevronRight as Siguiente,
  CalendarDays as Calendario,
} from 'lucide-react';
import { useRecurso } from '../../compartido/ganchos/useRecurso.js';
import { useEventos } from '../../compartido/ganchos/useEventos.js';
import { useAutenticacion } from '../../compartido/contextos/autenticacion.js';
import { rolParaUsuario } from '../../configuracion/navegacion.js';
import { EstadoConsulta } from '../../compartido/componentes/MensajeEstado.jsx';
import { Paginacion } from '../../compartido/componentes/TablaDatos.jsx';
import { usePaginacion } from '../../compartido/utilidades/tablas.js';
import {
  DIAS_SEMANA,
  normalizarDia,
  claveFechaLocal,
  construirMes,
  progresoFicha,
} from './calendario.js';
/* titulos: valor de trabajo utilizado en esta operación. */
const titulos = {
  programas: 'Programas de formación',
  fichas: 'Tus fichas, más cerca.',
  jornadas: 'Jornadas',
  horarios: 'Tu semana, de un vistazo.',
  asistencias: 'Tu asistencia',
};
/** Cada ficha muestra datos reales, fechas y avance temporal; abrirla revela información adicional. */
function TarjetaFicha({ ficha }) {
  /* progreso: valor de trabajo utilizado en esta operación. */
  const progreso = progresoFicha(ficha.fecha_inicio, ficha.fecha_fin);
  return (
    <article className="xn-tarjeta-academica">
      <div className="xn-tarjeta-academica-cabecera">
        <span className="xn-icono-academico">
          <Libro size={22} />
        </span>
        <span className="xn-estado es-neutro">
          {ficha.modalidad || 'Ficha'}
        </span>
      </div>
      <p className="xn-antetitulo">FICHA {ficha.numero_ficha}</p>
      <h2>{ficha.nombre_programa || `Programa ${ficha.id_programa}`}</h2>
      <p>
        <Reloj size={14} />
        {ficha.jornada || 'Jornada por confirmar'}
      </p>
      {progreso !== null && (
        <div className="xn-avance-ficha">
          <div>
            <span>Periodo de formación</span>
            <strong>{progreso}%</strong>
          </div>
          <progress
            max="100"
            value={progreso}
            aria-label={`Avance temporal de la ficha ${ficha.numero_ficha}`}
          />
        </div>
      )}
      <details>
        <summary>Ver información de la ficha</summary>
        <dl>
          <div>
            <dt>Inicio</dt>
            <dd>{ficha.fecha_inicio?.slice(0, 10) || 'Por confirmar'}</dd>
          </div>
          <div>
            <dt>Finalización</dt>
            <dd>{ficha.fecha_fin?.slice(0, 10) || 'Por confirmar'}</dd>
          </div>
          <div>
            <dt>Identificador</dt>
            <dd>{ficha.id_ficha}</dd>
          </div>
        </dl>
      </details>
    </article>
  );
}
/** La agenda semanal agrupa el día real y conserva eventos sin día reconocido en una sección aparte. */
function AgendaSemanal({ registros }) {
  /* busqueda, cambiarBusqueda: estado de la vista y función para actualizarlo. */
  const [busqueda, cambiarBusqueda] = useEstado('');
  /* visibles: valor de trabajo utilizado en esta operación. */
  const visibles = registros.filter((registro) =>
    `${registro.nombre_clase} ${registro.ambiente} ${registro.id_ficha}`
      .toLowerCase()
      .includes(busqueda.toLowerCase())
  );
  /* sinDia: valor de trabajo utilizado en esta operación. */
  const sinDia = visibles.filter(
    (registro) => normalizarDia(registro.dia_semana) < 0
  );
  return (
    <>
      <div className="xn-agenda-herramientas">
        <div>
          <h2>Calendario semanal</h2>
          <p className="xn-ayuda">Clases recurrentes · hora de Colombia</p>
        </div>
        <div className="xn-campo">
          <label htmlFor="buscar-clase">Encuentra tu clase</label>
          <input
            id="buscar-clase"
            value={busqueda}
            onChange={(evento) => cambiarBusqueda(evento.target.value)}
            placeholder="Clase, ficha o ambiente"
          />
        </div>
      </div>
      <div
        className="xn-calendario-semanal"
        tabIndex={0}
        aria-label="Calendario semanal de clases"
      >
        <div className="xn-semana-columnas">
          {DIAS_SEMANA.map((dia, indice) => (
            <section key={dia} className="xn-columna-dia">
              <h3>{dia}</h3>
              <div>
                {visibles
                  .filter(
                    (registro) => normalizarDia(registro.dia_semana) === indice
                  )
                  .sort((primero, segundo) =>
                    String(primero.hora_inicio).localeCompare(
                      String(segundo.hora_inicio)
                    )
                  )
                  .map((registro) => (
                    <article key={registro.id_horario} className="xn-clase">
                      <p>
                        {registro.hora_inicio?.slice(0, 5)} —{' '}
                        {registro.hora_fin?.slice(0, 5)}
                      </p>
                      <h4>{registro.nombre_clase || 'Sesión de formación'}</h4>
                      <span>
                        <Ubicacion size={12} />
                        {registro.ambiente || 'Por confirmar'}
                      </span>
                      <small>Ficha {registro.id_ficha}</small>
                    </article>
                  ))}
                {!visibles.some(
                  (registro) => normalizarDia(registro.dia_semana) === indice
                ) && <p className="xn-dia-libre">Sin clases registradas</p>}
              </div>
            </section>
          ))}
        </div>
      </div>
      {sinDia.length > 0 && (
        <section className="xn-trabajo-tarjeta">
          <h2>Por ubicar en tu semana</h2>
          {sinDia.map((registro) => (
            <p key={registro.id_horario}>
              {registro.nombre_clase} ·{' '}
              {registro.dia_semana || 'Día por confirmar'}
            </p>
          ))}
        </section>
      )}
      {!visibles.length && (
        <p role="status" className="xn-ayuda-vacia">
          No encontramos clases para esta búsqueda en los registros consultados.
        </p>
      )}
    </>
  );
}
/** Mes navegable con detalle por día. Solo marca asistencia existente en la respuesta del servidor. */
function CalendarioAsistencia({ registros }) {
  /* mes, cambiarMes: estado de la vista y función para actualizarlo. */
  const [mes, cambiarMes] = useEstado(() => new Date());
  /* seleccionado, cambiarSeleccionado: estado de la vista y función para actualizarlo. */
  const [seleccionado, cambiarSeleccionado] = useEstado(() =>
    claveFechaLocal(new Date())
  );
  /* dias: valor de trabajo utilizado en esta operación. */
  const dias = construirMes(mes);
  /* registrosDia: valor de trabajo utilizado en esta operación. */
  const registrosDia = registros.filter(
    (registro) => String(registro.fecha).slice(0, 10) === seleccionado
  );
  /* moverMes: operación local que atiende el evento o transforma la información. */
  const moverMes = (desplazamiento) => {
    /* nuevaFecha: instancia que se mantiene durante la operación y se libera cuando corresponde. */
    const nuevaFecha = new Date(
      mes.getFullYear(),
      mes.getMonth() + desplazamiento,
      1
    );
    cambiarMes(nuevaFecha);
    cambiarSeleccionado(claveFechaLocal(nuevaFecha));
  };
  return (
    <div className="xn-mes-distribucion">
      <section className="xn-trabajo-tarjeta">
        <div className="xn-mes-cabecera">
          <h2>
            {new Intl.DateTimeFormat('es-CO', {
              month: 'long',
              year: 'numeric',
            }).format(mes)}
          </h2>
          <div>
            <button
              className="xn-icono-boton"
              aria-label="Mes anterior"
              onClick={() => moverMes(-1)}
            >
              <Anterior size={18} />
            </button>
            <button
              className="xn-enlace-boton"
              onClick={() => {
                cambiarMes(new Date());
                cambiarSeleccionado(claveFechaLocal(new Date()));
              }}
            >
              Hoy
            </button>
            <button
              className="xn-icono-boton"
              aria-label="Mes siguiente"
              onClick={() => moverMes(1)}
            >
              <Siguiente size={18} />
            </button>
          </div>
        </div>
        <div className="xn-cuadricula-mes">
          {DIAS_SEMANA.map((dia) => (
            <span className="xn-dia-semana" key={dia}>
              {dia.slice(0, 3)}
            </span>
          ))}
          {dias.map((fecha) => {
            /* clave: valor de trabajo utilizado en esta operación. */
            const clave = claveFechaLocal(fecha);
            /* cantidad: valor de trabajo utilizado en esta operación. */
            const cantidad = registros.filter(
              (registro) => String(registro.fecha).slice(0, 10) === clave
            ).length;
            return (
              <button
                key={clave}
                className={`xn-dia-mes ${fecha.getMonth() !== mes.getMonth() ? 'de-otro-mes' : ''} ${seleccionado === clave ? 'seleccionado' : ''}`}
                aria-pressed={seleccionado === clave}
                aria-label={`${clave}, ${cantidad} registros`}
                onClick={() => cambiarSeleccionado(clave)}
              >
                <span>{fecha.getDate()}</span>
                {cantidad > 0 && <i aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </section>
      <section className="xn-trabajo-tarjeta xn-detalle-dia">
        <Calendario size={24} />
        <h2>{seleccionado}</h2>
        {registrosDia.length ? (
          registrosDia.map((registro) => (
            <article key={registro.id_asistencia}>
              <strong>{registro.estado}</strong>
              {registro.nombres_completos && (
                <p>{registro.nombres_completos}</p>
              )}
              <p>Jornada {registro.id_jornada}</p>
              <small>
                Entrada {registro.hora_entrada?.slice(0, 5) || '—'} · Salida{' '}
                {registro.hora_salida?.slice(0, 5) || '—'}
              </small>
            </article>
          ))
        ) : (
          <p>
            No hay asistencia registrada para este día dentro de la página
            consultada.
          </p>
        )}
      </section>
    </div>
  );
}
/** tipo selecciona el recurso; las fichas personales usan el ID de la sesión y no una lista global. */
export function InformacionAcademica({ tipo, acciones }) {
  /* usuario: valor de trabajo utilizado en esta operación. */
  const { usuario } = useAutenticacion();
  /* paginacion: valor de trabajo utilizado en esta operación. */
  const paginacion = usePaginacion();
  /* fichasPersonales: valor de trabajo utilizado en esta operación. */
  const fichasPersonales =
    tipo === 'fichas' && rolParaUsuario(usuario) !== 'admin';
  /* recurso: consulta cancelable al servidor, con datos, estado y reintento. */
  const recurso = useRecurso(
    fichasPersonales
      ? `/usuarios/${usuario.id_usuarios}/fichas`
      : tipo === 'asistencias'
        ? '/asistencias?limit=100' // El calendario no pagina: pide el máximo, con lo más reciente primero.
        : `/${tipo}?${paginacion.consulta}`
  );
  /* canal: estado de la conexión en vivo; cada escaneo actualiza el calendario sin recargar. */
  const canal = useEventos(
    tipo === 'asistencias' ? 'asistencia' : null,
    recurso.refrescar
  );
  /* registros: valor de trabajo utilizado en esta operación. */
  const registros = recurso.datos || [];
  return (
    <>
      <div className="xn-panel-titulo">
        <div>
          <h1>{titulos[tipo]}</h1>
          <p>Un poco de orden para que te concentres en lo que sigue.</p>
        </div>
        <div className="xn-admin-acciones">
          {tipo === 'asistencias' && (
            <span
              className={`xn-estado ${canal === 'conectado' ? 'es-exito' : 'es-peligro'}`}
              role="status"
            >
              {canal === 'conectado' ? 'En vivo' : 'Reconectando…'}
            </span>
          )}
          <button
            className="xn-boton xn-boton--secundario"
            onClick={recurso.actualizar}
          >
            Actualizar
          </button>
          {acciones}
        </div>
      </div>
      <EstadoConsulta recurso={recurso}>
        {tipo === 'horarios' ? (
          <AgendaSemanal registros={registros} />
        ) : tipo === 'asistencias' ? (
          <CalendarioAsistencia registros={registros} />
        ) : (
          <div className="xn-tarjetas-academicas">
            {registros.map((registro) =>
              tipo === 'fichas' ? (
                <TarjetaFicha key={registro.id_ficha} ficha={registro} />
              ) : (
                <article
                  className="xn-tarjeta-academica"
                  key={registro.id_programa || registro.id_jornada}
                >
                  <span className="xn-icono-academico">
                    {tipo === 'programas' ? (
                      <Libro size={22} />
                    ) : (
                      <Reloj size={22} />
                    )}
                  </span>
                  <p className="xn-antetitulo">
                    {tipo === 'programas' ? 'FORMACIÓN' : 'JORNADA'}
                  </p>
                  <h2>{registro.nombre_programa || registro.nombre}</h2>
                  <p>
                    {registro.nivel_programa ||
                      `${registro.hora_inicio?.slice(0, 5)} — ${registro.hora_fin?.slice(0, 5)}`}
                  </p>
                  {registro.id_ficha && (
                    <small>Ficha {registro.id_ficha}</small>
                  )}
                </article>
              )
            )}
          </div>
        )}
        {!registros.length && !['asistencias', 'horarios'].includes(tipo) && (
          <section className="xn-trabajo-tarjeta xn-ayuda-vacia">
            <Libro size={28} />
            <h2>Aún no hay información por aquí.</h2>
            <p>Cuando se asigne a tu perfil, la encontrarás en este espacio.</p>
          </section>
        )}
        {!fichasPersonales && (
          <Paginacion paginacion={paginacion} cantidad={registros.length} />
        )}
        <p className="xn-ayuda">
          Consulta de información institucional. Para solicitar cambios, habla
          con tu coordinación.
        </p>
      </EstadoConsulta>
    </>
  );
}
