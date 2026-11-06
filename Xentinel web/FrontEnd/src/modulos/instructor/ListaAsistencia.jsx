/** Lista de asistencia por ficha y día, en vivo: presente, retraso o sin registro, con búsqueda y descargas. */
import { useState as useEstado } from 'react';
import { useRecurso } from '../../compartido/ganchos/useRecurso.js';
import { useEventos } from '../../compartido/ganchos/useEventos.js';
import {
  EstadoConsulta,
  MensajeEstado,
} from '../../compartido/componentes/MensajeEstado.jsx';
import { TablaDatos } from '../../compartido/componentes/TablaDatos.jsx';
import { useAutenticacion } from '../../compartido/contextos/autenticacion.js';
import { rolParaUsuario } from '../../configuracion/navegacion.js';
import { EditorJornada } from '../admin/EditorJornada.jsx';
import { descargarReporte } from '../admin/archivosReporte.js';
import { fechaBogota, reporteAsistencia } from '../admin/reportes.js';

const CLASE_ESTADO = {
  Presente: 'es-exito',
  Retraso: 'es-aviso',
  'Sin registro': 'es-neutro',
};
const COLUMNAS = [
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
    representar: (fila) => fila.hora_entrada?.slice(0, 5) || '—',
  },
  {
    clave: 'hora_salida',
    etiqueta: 'Salida',
    representar: (fila) => fila.hora_salida?.slice(0, 5) || '—',
  },
  {
    clave: 'estado_asistencia',
    etiqueta: 'Estado',
    representar: (fila) => (
      <span className={`xn-estado ${CLASE_ESTADO[fila.estado_asistencia]}`}>
        {fila.estado_asistencia}
      </span>
    ),
  },
];
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

export function ListaAsistencia() {
  const [ficha, cambiarFicha] = useEstado('');
  const [fecha, cambiarFecha] = useEstado(fechaBogota);
  const [busqueda, cambiarBusqueda] = useEstado('');
  const [descarga, cambiarDescarga] = useEstado({});
  const [editandoJornada, cambiarEditandoJornada] = useEstado(false);
  const { usuario } = useAutenticacion();
  const esAdmin = rolParaUsuario(usuario) === 'admin';
  const fichas = useRecurso('/asistencias/fichas');
  const parametros = new URLSearchParams({ fecha });
  if (ficha) parametros.set('id_ficha', ficha);
  const lista = useRecurso(`/asistencias/lista?${parametros}`);
  const canal = useEventos('asistencia', lista.refrescar);
  const filas = (lista.datos || []).filter((fila) =>
    coincideBusqueda(fila, busqueda)
  );
  const cuenta = (estado) =>
    filas.filter((fila) => fila.estado_asistencia === estado).length;
  const fichaElegida = fichas.datos?.find((f) => String(f.id_ficha) === ficha);

  const descargar = async (formato) => {
    cambiarDescarga({});
    try {
      await descargarReporte(
        reporteAsistencia(fecha, filas, fichaElegida?.numero_ficha),
        formato
      );
    } catch (error) {
      cambiarDescarga({ error });
    }
  };

  return (
    <>
      <div className="xn-panel-titulo">
        <div>
          <h1>Asistencia</h1>
          <p>
            A tiempo hasta la hora de inicio de la jornada; después, retraso.
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
            disabled={!filas.length}
            onClick={() => descargar('csv')}
          >
            Descargar CSV
          </button>
          <button
            className="xn-boton xn-boton--secundario"
            disabled={!filas.length}
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
        <div className="xn-lista-filtros">
          <div className="xn-campo">
            <label htmlFor="asistencia-ficha">Ficha</label>
            <select
              id="asistencia-ficha"
              value={ficha}
              onChange={(evento) => cambiarFicha(evento.target.value)}
            >
              <option value="">Todas las fichas</option>
              {(fichas.datos || []).map((opcion) => (
                <option key={opcion.id_ficha} value={opcion.id_ficha}>
                  {opcion.numero_ficha} · {opcion.nombre_programa}
                </option>
              ))}
            </select>
          </div>
          <div className="xn-campo">
            <label htmlFor="asistencia-fecha">Fecha</label>
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
          </div>
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
        <p className="xn-lista-resumen" role="status">
          <span className="xn-estado es-exito">
            Presentes: {cuenta('Presente')}
          </span>
          <span className="xn-estado es-aviso">
            Retrasos: {cuenta('Retraso')}
          </span>
          <span className="xn-estado es-neutro">
            Sin registro: {cuenta('Sin registro')}
          </span>
        </p>
        <MensajeEstado {...descarga} />
        <EstadoConsulta recurso={lista}>
          <TablaDatos
            filas={filas}
            claveFila="id_usuarios"
            columnas={COLUMNAS}
            vacio="No hay aprendices para esta búsqueda."
          />
        </EstadoConsulta>
      </section>
    </>
  );
}
