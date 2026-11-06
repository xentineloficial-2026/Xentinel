/** Exportación administrativa: el día elegido es independiente de la página visible. */
import { useEffect, useRef, useState } from 'react';
import { Dialogo } from '../../compartido/componentes/Dialogo.jsx';
import { MensajeEstado } from '../../compartido/componentes/MensajeEstado.jsx';
import { descargarReporte } from './archivosReporte.js';
import { consultarReporte, fechaBogota, reporteAccesos } from './reportes.js';

export function ExportarAccesos() {
  const [abierto, cambiarAbierto] = useState(false);
  const [fecha, cambiarFecha] = useState(fechaBogota);
  const [estado, cambiarEstado] = useState({});
  const [ocupado, cambiarOcupado] = useState(false);
  const [formato, cambiarFormato] = useState('pdf');
  const operacion = useRef(null);
  useEffect(() => () => operacion.current?.abort(), []);

  async function exportar(evento) {
    evento.preventDefault();
    if (operacion.current) return;
    const elegido =
      evento.nativeEvent.submitter?.value === 'csv' ? 'csv' : 'pdf';
    cambiarFormato(elegido);
    const controlador = new AbortController();
    operacion.current = controlador;
    cambiarOcupado(true);
    cambiarEstado({});
    try {
      const accesos = await consultarReporte(
        '/reportes/accesos',
        'id_acceso',
        { fecha },
        controlador.signal
      );
      if (controlador.signal.aborted) return;
      if (!accesos.length) {
        cambiarEstado({
          mensaje: 'No se registraron ingresos ni salidas en esta fecha.',
        });
        return;
      }
      await descargarReporte(reporteAccesos(fecha, accesos), elegido);
      cambiarEstado({
        mensaje: `${elegido.toUpperCase()} descargado con ${accesos.length} movimientos.`,
      });
    } catch (error) {
      if (!controlador.signal.aborted) cambiarEstado({ error });
    } finally {
      operacion.current = null;
      cambiarOcupado(false);
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
        Descargar historial
      </button>
      {abierto && (
        <Dialogo
          titulo="Descargar historial del día"
          alCerrar={() => cambiarAbierto(false)}
          ocupado={ocupado}
        >
          <form onSubmit={exportar}>
            <p>
              El archivo incluye todos los ingresos y salidas del día elegido,
              en hora de Bogotá.
            </p>
            <div className="xn-campo">
              <label htmlFor="fecha-reporte-accesos">Fecha</label>
              <input
                id="fecha-reporte-accesos"
                data-initial-focus
                type="date"
                required
                max={fechaBogota()}
                value={fecha}
                disabled={ocupado}
                onChange={(evento) => {
                  cambiarFecha(evento.target.value);
                  cambiarEstado({});
                }}
              />
            </div>
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
              <button
                className="xn-boton xn-boton--secundario"
                value="csv"
                disabled={ocupado}
              >
                {ocupado && formato === 'csv'
                  ? 'Preparando CSV…'
                  : 'Descargar CSV'}
              </button>
              <button className="xn-boton" value="pdf" disabled={ocupado}>
                {ocupado && formato === 'pdf'
                  ? 'Preparando PDF…'
                  : 'Descargar PDF'}
              </button>
            </div>
          </form>
        </Dialogo>
      )}
    </>
  );
}
