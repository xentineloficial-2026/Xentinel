/** Reportes administrativos de ingresos o de asistencia para un periodo, en CSV, Excel o PDF. */
import { useEffect, useRef, useState } from 'react';
import { Download as Descargar } from 'lucide-react';
import { Dialogo } from '../../compartido/componentes/Dialogo.jsx';
import { MensajeEstado } from '../../compartido/componentes/MensajeEstado.jsx';
import { useRecurso } from '../../compartido/ganchos/useRecurso.js';
import { descargarReporte } from './archivosReporte.js';
import './administrador.css';
import {
  consultarReporte,
  fechaBogota,
  reporteAsistenciaGeneral,
  reporteIngresos,
} from './reportes.js';

const TIPOS = {
  ingresos: {
    etiqueta: 'Ingresos y salidas',
    descripcion:
      'Cada visita con su fecha, hora de entrada y hora de salida, y los intentos denegados.',
    ruta: '/reportes/accesos',
    clave: 'id_acceso',
    unidad: 'movimientos',
  },
  asistencia: {
    etiqueta: 'Asistencia',
    descripcion:
      'El estado de cada día: Presente, Retardo o Ausente, con la hora de entrada y de salida.',
    ruta: '/reportes/asistencia',
    clave: 'id_asistencia',
    unidad: 'registros',
  },
};
const FORMATOS = { csv: 'CSV', xlsx: 'Excel', pdf: 'PDF' };
const DIAS_MAXIMOS = 92;

function diasEntre(desde, hasta) {
  return Math.round((new Date(hasta) - new Date(desde)) / 86400000);
}

export function ExportarReportes({ tipoInicial = 'ingresos' }) {
  const [abierto, cambiarAbierto] = useState(false);
  const [tipo, cambiarTipo] = useState(tipoInicial);
  const [desde, cambiarDesde] = useState(fechaBogota);
  const [hasta, cambiarHasta] = useState(fechaBogota);
  const [ficha, cambiarFicha] = useState('');
  const [estado, cambiarEstado] = useState({});
  const [formato, cambiarFormato] = useState(null);
  const operacion = useRef(null);
  const fichas = useRecurso(abierto ? '/fichas?limit=100' : null);
  useEffect(() => () => operacion.current?.abort(), []);
  const ocupado = formato !== null;

  async function exportar(evento) {
    evento.preventDefault();
    if (operacion.current) return;
    const elegido = evento.nativeEvent.submitter?.value ?? 'xlsx';
    if (hasta < desde) {
      cambiarEstado({
        error: 'La fecha final debe ser igual o posterior a la inicial.',
      });
      return;
    }
    if (diasEntre(desde, hasta) > DIAS_MAXIMOS) {
      cambiarEstado({ error: 'Elige un periodo de máximo tres meses.' });
      return;
    }
    const controlador = new AbortController();
    operacion.current = controlador;
    cambiarFormato(elegido);
    cambiarEstado({});
    const definicion = TIPOS[tipo];
    const rango = { desde, hasta };
    try {
      const filas = await consultarReporte(
        definicion.ruta,
        definicion.clave,
        {
          fecha: desde,
          hasta_fecha: hasta,
          ...(tipo === 'asistencia' && ficha && { id_ficha: ficha }),
        },
        controlador.signal
      );
      if (controlador.signal.aborted) return;
      if (!filas.length) {
        cambiarEstado({
          mensaje: `No hay ${definicion.unidad} en ese periodo.`,
        });
        return;
      }
      const numeroFicha = fichas.datos?.find(
        (opcion) => String(opcion.id_ficha) === ficha
      )?.numero_ficha;
      const reporte =
        tipo === 'ingresos'
          ? reporteIngresos(rango, filas)
          : reporteAsistenciaGeneral(rango, filas, numeroFicha);
      await descargarReporte(reporte, elegido);
      cambiarEstado({
        mensaje: `${FORMATOS[elegido]} descargado con ${filas.length} ${definicion.unidad}.`,
      });
    } catch (error) {
      if (!controlador.signal.aborted) cambiarEstado({ error });
    } finally {
      operacion.current = null;
      cambiarFormato(null);
    }
  }

  return (
    <>
      <button
        className="xn-boton"
        onClick={() => {
          cambiarEstado({});
          cambiarAbierto(true);
        }}
      >
        <Descargar size={17} aria-hidden="true" />
        Descargar reporte
      </button>
      {abierto && (
        <Dialogo
          titulo="Descargar reporte"
          alCerrar={() => cambiarAbierto(false)}
          ocupado={ocupado}
        >
          <form onSubmit={exportar} className="xn-reporte-formulario">
            <fieldset className="xn-reporte-tipos" disabled={ocupado}>
              <legend>Qué quieres descargar</legend>
              {Object.entries(TIPOS).map(([clave, definicion]) => (
                <label
                  key={clave}
                  className="xn-reporte-tipo"
                  data-elegido={tipo === clave}
                >
                  <input
                    type="radio"
                    name="tipo-reporte"
                    value={clave}
                    checked={tipo === clave}
                    onChange={() => {
                      cambiarTipo(clave);
                      cambiarEstado({});
                    }}
                  />
                  <span>
                    <strong>{definicion.etiqueta}</strong>
                    {definicion.descripcion}
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="xn-formulario-cuadricula">
              <div className="xn-campo">
                <label htmlFor="reporte-desde">Desde</label>
                <input
                  id="reporte-desde"
                  data-initial-focus
                  type="date"
                  required
                  max={fechaBogota()}
                  value={desde}
                  disabled={ocupado}
                  onChange={(evento) => {
                    cambiarDesde(evento.target.value);
                    if (evento.target.value > hasta)
                      cambiarHasta(evento.target.value);
                    cambiarEstado({});
                  }}
                />
              </div>
              <div className="xn-campo">
                <label htmlFor="reporte-hasta">Hasta</label>
                <input
                  id="reporte-hasta"
                  type="date"
                  required
                  min={desde}
                  max={fechaBogota()}
                  value={hasta}
                  disabled={ocupado}
                  onChange={(evento) => {
                    cambiarHasta(evento.target.value);
                    cambiarEstado({});
                  }}
                />
              </div>
              {tipo === 'asistencia' && (
                <div className="xn-campo">
                  <label htmlFor="reporte-ficha">Ficha</label>
                  <select
                    id="reporte-ficha"
                    value={ficha}
                    disabled={ocupado}
                    onChange={(evento) => cambiarFicha(evento.target.value)}
                  >
                    <option value="">Toda la sede</option>
                    {fichas.datos?.map((opcion) => (
                      <option key={opcion.id_ficha} value={opcion.id_ficha}>
                        {opcion.numero_ficha}
                        {opcion.nombre_programa &&
                          ` · ${opcion.nombre_programa}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <p className="xn-ayuda">
              Incluye fecha (DD/MM/AAAA), nombre, documento, rol, programa y
              ficha de cada persona. Hora de Bogotá; máximo tres meses.
            </p>
            <MensajeEstado {...estado} />
            <div className="xn-dialogo-acciones">
              <button
                type="button"
                className="xn-boton xn-boton--secundario"
                disabled={ocupado}
                onClick={() => cambiarAbierto(false)}
              >
                Cerrar
              </button>
              {Object.entries(FORMATOS).map(([clave, nombre]) => (
                <button
                  key={clave}
                  className={`xn-boton ${clave === 'xlsx' ? '' : 'xn-boton--secundario'}`}
                  value={clave}
                  disabled={ocupado}
                >
                  {formato === clave ? `Preparando ${nombre}…` : nombre}
                </button>
              ))}
            </div>
          </form>
        </Dialogo>
      )}
    </>
  );
}
