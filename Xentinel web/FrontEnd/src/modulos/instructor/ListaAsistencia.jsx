/** Asistencia por día, semana o mes: lista en vivo, frecuencia por aprendiz, edición manual y descargas. */
import { useState as useEstado } from 'react';
import { useRecurso } from '../../compartido/ganchos/useRecurso.js';
import { useEventos } from '../../compartido/ganchos/useEventos.js';
import {
  EstadoConsulta,
  MensajeEstado,
} from '../../compartido/componentes/MensajeEstado.jsx';
import { TablaDatos } from '../../compartido/componentes/TablaDatos.jsx';
import { useAutenticacion } from '../../compartido/contextos/autenticacion.js';
import { solicitar } from '../../compartido/servicios/cliente.js';
import { rolParaUsuario } from '../../configuracion/navegacion.js';
import { EditorJornada } from '../admin/EditorJornada.jsx';
import { descargarReporte } from '../admin/archivosReporte.js';
import {
  fechaBogota,
  reporteAsistencia,
  reporteAsistenciaPeriodo,
} from '../admin/reportes.js';

/* Sin registro: día sin escaneo que nadie calificó todavía. Ausente: el instructor lo confirmó. */
const ESTADOS = ['Presente', 'Retardo', 'Ausente', 'Sin registro'];
const CLASE_ESTADO = {
  Presente: 'es-exito',
  Retardo: 'es-aviso',
  Ausente: 'es-peligro',
  'Sin registro': 'es-neutro',
};
const formatoDia = new Intl.DateTimeFormat('es-CO', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const formatoMes = new Intl.DateTimeFormat('es-CO', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
/** Fechas civiles sin zona horaria: se calculan en UTC para no correr un día. */
const aFecha = (texto) => new Date(`${texto}T00:00:00Z`);
const aTexto = (fecha) => fecha.toISOString().slice(0, 10);

/** Semana de lunes a domingo o mes completo que contiene la fecha de referencia. */
function rangoPeriodo(referencia, periodo) {
  const base = aFecha(referencia);
  if (periodo === 'semana') {
    const lunes = new Date(base);
    lunes.setUTCDate(base.getUTCDate() - ((base.getUTCDay() + 6) % 7));
    const domingo = new Date(lunes);
    domingo.setUTCDate(lunes.getUTCDate() + 6);
    return { desde: aTexto(lunes), hasta: aTexto(domingo) };
  }
  const inicio = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1)
  );
  const fin = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)
  );
  return { desde: aTexto(inicio), hasta: aTexto(fin) };
}

function nombreRango(periodo, rango) {
  return periodo === 'mes'
    ? formatoMes.format(aFecha(rango.desde))
    : `${formatoDia.format(aFecha(rango.desde))} al ${formatoDia.format(aFecha(rango.hasta))}`;
}

/** Sin tildes ni mayúsculas: «maria» encuentra a «María». */
const normalizar = (texto) =>
  String(texto ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

function coincideBusqueda(fila, busqueda) {
  const terminos = normalizar(busqueda).split(/\s+/).filter(Boolean);
  const contenido = normalizar(
    `${fila.nombres_completos} ${fila.tipo_documento} ${fila.numero_documento}`
  );
  return terminos.every((termino) => contenido.includes(termino));
}

/** Estado editable: el instructor corrige a sus aprendices; el administrador, a todos. */
function EstadoAsistencia({ fila, idFicha, fecha, editable, alGuardar }) {
  const [guardando, cambiarGuardando] = useEstado(false);
  const estado = fila.estado_asistencia;
  const editado = fila.modificado_en
    ? `Editado${fila.modificado_por_nombre ? ` por ${fila.modificado_por_nombre}` : ''}`
    : '';
  if (!editable)
    return (
      <span className={`xn-estado ${CLASE_ESTADO[estado]}`} title={editado}>
        {estado}
      </span>
    );
  const cambiar = async (evento) => {
    const nuevo = evento.target.value;
    cambiarGuardando(true);
    try {
      await solicitar('/asistencias/estado', {
        method: 'PUT',
        body: {
          id_usuarios: fila.id_usuarios,
          id_ficha: Number(idFicha),
          fecha,
          estado: nuevo,
        },
      });
      alGuardar({
        mensaje: `${fila.nombres_completos}: ${nuevo.toLowerCase()} el ${fecha}.`,
      });
    } catch (error) {
      alGuardar({ error });
    } finally {
      cambiarGuardando(false);
    }
  };
  return (
    <span className="xn-estado-editable">
      <select
        className={`xn-estado ${CLASE_ESTADO[estado]}`}
        value={estado}
        disabled={guardando}
        onChange={cambiar}
        aria-label={`Estado de ${fila.nombres_completos} el ${fecha}`}
      >
        {ESTADOS.map((opcion) => (
          <option key={opcion}>{opcion}</option>
        ))}
      </select>
      {editado && (
        <small className="xn-estado-editado" title={editado}>
          {editado}
        </small>
      )}
    </span>
  );
}

const hora = (valor) => valor?.slice(0, 5) || '—';

export function ListaAsistencia() {
  const [ficha, cambiarFicha] = useEstado('');
  const [periodo, cambiarPeriodo] = useEstado('dia');
  const [fecha, cambiarFecha] = useEstado(fechaBogota);
  const [aprendiz, cambiarAprendiz] = useEstado('');
  const [busqueda, cambiarBusqueda] = useEstado('');
  const [aviso, cambiarAviso] = useEstado({});
  const [editandoJornada, cambiarEditandoJornada] = useEstado(false);
  const { usuario } = useAutenticacion();
  const esAdmin = rolParaUsuario(usuario) === 'admin';
  const fichas = useRecurso('/asistencias/fichas');
  const porDia = periodo === 'dia';
  const rango = porDia ? null : rangoPeriodo(fecha, periodo);

  const parametrosDia = new URLSearchParams({ fecha });
  if (ficha) parametrosDia.set('id_ficha', ficha);
  const lista = useRecurso(
    porDia ? `/asistencias/lista?${parametrosDia}` : null
  );
  const parametrosPeriodo = new URLSearchParams({
    id_ficha: ficha,
    ...(rango || {}),
  });
  if (aprendiz) parametrosPeriodo.set('id_usuarios', aprendiz);
  const resumen = useRecurso(
    !porDia && ficha ? `/asistencias/periodo?${parametrosPeriodo}` : null
  );
  const recurso = porDia ? lista : resumen;
  const canal = useEventos('asistencia', recurso.refrescar);

  const filasDia = (lista.datos || []).filter((fila) =>
    coincideBusqueda(fila, busqueda)
  );
  const filasResumen = (resumen.datos?.resumen || []).filter((fila) =>
    coincideBusqueda(fila, busqueda)
  );
  const detalle = resumen.datos?.detalle || [];
  const fichaElegida = fichas.datos?.find((f) => String(f.id_ficha) === ficha);
  const personaElegida = resumen.datos?.resumen?.find(
    (fila) => String(fila.id_usuarios) === aprendiz
  );
  const cuenta = (estado) =>
    filasDia.filter((fila) => fila.estado_asistencia === estado).length;
  const guardado = (resultado) => {
    cambiarAviso(resultado);
    if (!resultado.error) recurso.refrescar();
  };

  const descargar = async (formato) => {
    cambiarAviso({});
    try {
      await descargarReporte(
        porDia
          ? reporteAsistencia(
              fecha,
              filasDia,
              fichaElegida?.numero_ficha,
              fichaElegida?.nombre_programa
            )
          : reporteAsistenciaPeriodo({
              rango,
              nombre: nombreRango(periodo, rango),
              numeroFicha: fichaElegida?.numero_ficha,
              programa: fichaElegida?.nombre_programa,
              resumen: filasResumen,
              detalle: aprendiz ? detalle : [],
              persona: personaElegida,
            }),
        formato
      );
    } catch (error) {
      cambiarAviso({ error });
    }
  };
  const hayFilas = porDia ? filasDia.length : filasResumen.length;

  const columnasDia = [
    { clave: 'nombres_completos', etiqueta: 'Aprendiz' },
    {
      clave: 'numero_documento',
      etiqueta: 'Documento',
      representar: (fila) => `${fila.tipo_documento} ${fila.numero_documento}`,
    },
    { clave: 'numero_ficha', etiqueta: 'Ficha' },
    { clave: 'ambiente', etiqueta: 'Aula' },
    {
      clave: 'hora_entrada',
      etiqueta: 'Entrada',
      representar: (fila) => hora(fila.hora_entrada),
    },
    {
      clave: 'hora_salida',
      etiqueta: 'Salida',
      representar: (fila) => hora(fila.hora_salida),
    },
    {
      clave: 'estado_asistencia',
      etiqueta: 'Estado',
      representar: (fila) => (
        <EstadoAsistencia
          fila={fila}
          idFicha={fila.id_ficha}
          fecha={fecha}
          editable
          alGuardar={guardado}
        />
      ),
    },
  ];
  const columnasResumen = [
    { clave: 'nombres_completos', etiqueta: 'Aprendiz' },
    {
      clave: 'numero_documento',
      etiqueta: 'Documento',
      representar: (fila) => `${fila.tipo_documento} ${fila.numero_documento}`,
    },
    { clave: 'dias', etiqueta: 'Días de clase' },
    { clave: 'presentes', etiqueta: 'Presente' },
    { clave: 'retardos', etiqueta: 'Retardo' },
    { clave: 'ausentes', etiqueta: 'Ausente' },
    { clave: 'sin_registro', etiqueta: 'Sin registro' },
    {
      clave: 'asistencia',
      etiqueta: 'Asistencia',
      representar: (fila) => `${fila.asistencia} %`,
    },
    {
      clave: 'puntualidad',
      etiqueta: 'Puntualidad',
      representar: (fila) => `${fila.puntualidad} %`,
    },
    {
      clave: 'ver',
      etiqueta: 'Historial',
      representar: (fila) => (
        <button
          type="button"
          className="xn-enlace-boton"
          onClick={() => cambiarAprendiz(String(fila.id_usuarios))}
        >
          Ver días
        </button>
      ),
    },
  ];
  const columnasDetalle = [
    {
      clave: 'fecha',
      etiqueta: 'Día',
      representar: (fila) => formatoDia.format(aFecha(fila.fecha)),
    },
    {
      clave: 'hora_entrada',
      etiqueta: 'Entrada',
      representar: (fila) => hora(fila.hora_entrada),
    },
    {
      clave: 'hora_salida',
      etiqueta: 'Salida',
      representar: (fila) => hora(fila.hora_salida),
    },
    {
      clave: 'estado_asistencia',
      etiqueta: 'Estado',
      representar: (fila) => (
        <EstadoAsistencia
          fila={fila}
          idFicha={ficha}
          fecha={fila.fecha}
          editable
          alGuardar={guardado}
        />
      ),
    },
  ];

  return (
    <>
      <div className="xn-panel-titulo">
        <div>
          <h1>Asistencia</h1>
          <p>
            A tiempo hasta la hora de inicio de la jornada; después, retardo.
            Puedes corregir el estado de cada aprendiz o marcarlo ausente.
          </p>
        </div>
        <div className="xn-admin-acciones">
          <span
            className={`xn-estado ${canal === 'conectado' ? 'es-exito' : 'es-peligro'}`}
            role="status"
          >
            {canal === 'conectado' ? 'En vivo' : 'Reconectando…'}
          </span>
          <button
            className="xn-boton xn-boton--secundario"
            disabled={!hayFilas}
            onClick={() => descargar('csv')}
          >
            Descargar CSV
          </button>
          <button
            className="xn-boton xn-boton--secundario"
            disabled={!hayFilas}
            onClick={() => descargar('xlsx')}
          >
            Descargar Excel
          </button>
          <button
            className="xn-boton xn-boton--secundario"
            disabled={!hayFilas}
            onClick={() => descargar('pdf')}
          >
            Descargar PDF
          </button>
        </div>
      </div>
      {editandoJornada && fichaElegida && (
        <EditorJornada
          ficha={fichaElegida}
          alCerrar={() => cambiarEditandoJornada(false)}
          alGuardar={() => {
            cambiarEditandoJornada(false);
            fichas.refrescar();
          }}
        />
      )}
      <section className="xn-trabajo-tarjeta">
        {fichaElegida && (
          <p className="xn-lista-jornada" role="status">
            <strong>Jornada: </strong>
            {fichaElegida.hora_inicio
              ? `${fichaElegida.jornada ?? 'Vigente'} · ${fichaElegida.hora_inicio.slice(0, 5)} a ${fichaElegida.hora_fin.slice(0, 5)}`
              : 'sin definir; los escaneos de esta ficha no generan asistencia.'}
            {esAdmin && (
              <button
                type="button"
                className="xn-enlace-boton xn-texto-enlace"
                onClick={() => cambiarEditandoJornada(true)}
              >
                Cambiar jornada
              </button>
            )}
          </p>
        )}
        <div
          className="xn-admin-filtros"
          role="group"
          aria-label="Periodo de asistencia"
        >
          {[
            ['dia', 'Día'],
            ['semana', 'Semana'],
            ['mes', 'Mes'],
          ].map(([valor, etiqueta]) => (
            <button
              key={valor}
              type="button"
              className="xn-boton xn-boton--secundario"
              aria-pressed={periodo === valor}
              onClick={() => {
                cambiarPeriodo(valor);
                cambiarAprendiz('');
                cambiarAviso({});
              }}
            >
              {etiqueta}
            </button>
          ))}
        </div>
        <div className="xn-lista-filtros">
          <div className="xn-campo">
            <label htmlFor="asistencia-ficha">Ficha</label>
            <select
              id="asistencia-ficha"
              value={ficha}
              onChange={(evento) => {
                cambiarFicha(evento.target.value);
                cambiarAprendiz('');
              }}
            >
              <option value="">
                {porDia ? 'Todas las fichas' : 'Elige una ficha'}
              </option>
              {(fichas.datos || []).map((opcion) => (
                <option key={opcion.id_ficha} value={opcion.id_ficha}>
                  {opcion.numero_ficha} · {opcion.nombre_programa}
                </option>
              ))}
            </select>
          </div>
          <div className="xn-campo">
            <label htmlFor="asistencia-fecha">
              {porDia
                ? 'Fecha'
                : periodo === 'semana'
                  ? 'Un día de la semana'
                  : 'Un día del mes'}
            </label>
            <input
              id="asistencia-fecha"
              type="date"
              required
              max={fechaBogota()}
              value={fecha}
              onChange={(evento) =>
                evento.target.value && cambiarFecha(evento.target.value)
              }
            />
            {rango && (
              <small className="xn-ayuda">{nombreRango(periodo, rango)}</small>
            )}
          </div>
          {!porDia && (
            <div className="xn-campo">
              <label htmlFor="asistencia-aprendiz">Aprendiz</label>
              <select
                id="asistencia-aprendiz"
                value={aprendiz}
                disabled={!ficha}
                onChange={(evento) => cambiarAprendiz(evento.target.value)}
              >
                <option value="">Todos los aprendices</option>
                {(resumen.datos?.resumen || []).map((fila) => (
                  <option key={fila.id_usuarios} value={fila.id_usuarios}>
                    {fila.nombres_completos}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="xn-campo">
            <label htmlFor="asistencia-busqueda">Buscar</label>
            <input
              id="asistencia-busqueda"
              type="search"
              value={busqueda}
              onChange={(evento) => cambiarBusqueda(evento.target.value)}
              placeholder="Nombre, TI, CC o documento"
            />
          </div>
        </div>
        {porDia && (
          <p className="xn-lista-resumen" role="status">
            <span className="xn-estado es-exito">
              Presentes: {cuenta('Presente')}
            </span>
            <span className="xn-estado es-aviso">
              Retardos: {cuenta('Retardo')}
            </span>
            <span className="xn-estado es-peligro">
              Ausentes: {cuenta('Ausente')}
            </span>
            <span className="xn-estado es-neutro">
              Sin registro: {cuenta('Sin registro')}
            </span>
          </p>
        )}
        <MensajeEstado {...aviso} />
        {porDia ? (
          <EstadoConsulta recurso={lista}>
            <TablaDatos
              filas={filasDia}
              claveFila="id_usuarios"
              columnas={columnasDia}
              vacio="No hay aprendices para esta búsqueda."
            />
          </EstadoConsulta>
        ) : !ficha ? (
          <p className="xn-consulta-estado">
            Elige una ficha para ver la frecuencia de llegadas de la{' '}
            {periodo === 'semana' ? 'semana' : 'mes'}.
          </p>
        ) : (
          <EstadoConsulta recurso={resumen}>
            {personaElegida && (
              <div className="xn-frecuencia" role="status">
                <h2>{personaElegida.nombres_completos}</h2>
                <dl>
                  {[
                    ['Días de clase', personaElegida.dias],
                    ['Presente', personaElegida.presentes],
                    ['Retardo', personaElegida.retardos],
                    ['Ausente', personaElegida.ausentes],
                    ['Sin registro', personaElegida.sin_registro],
                    ['Asistencia', `${personaElegida.asistencia} %`],
                    ['Puntualidad', `${personaElegida.puntualidad} %`],
                  ].map(([nombre, valor]) => (
                    <div key={nombre}>
                      <dt>{nombre}</dt>
                      <dd>{valor}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            {aprendiz ? (
              <TablaDatos
                filas={detalle}
                claveFila="fecha"
                columnas={columnasDetalle}
                vacio="No hubo días de clase en este periodo."
              />
            ) : (
              <TablaDatos
                filas={filasResumen}
                claveFila="id_usuarios"
                columnas={columnasResumen}
                vacio="No hay aprendices o días de clase en este periodo."
              />
            )}
          </EstadoConsulta>
        )}
      </section>
    </>
  );
}
