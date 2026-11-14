/** Exporta todos los horarios o los asociados al programa desplegado. */
import { useEffect, useRef, useState } from 'react';
import { MensajeEstado } from '../../compartido/componentes/MensajeEstado.jsx';
import { descargarReporte } from './archivosReporte.js';
import { consultarReporte, reporteHorarios } from './reportes.js';

export function ExportarHorarios({ programa }) {
  const [formato, cambiarFormato] = useState('');
  const [estado, cambiarEstado] = useState({});
  const operacion = useRef(null);
  useEffect(() => () => operacion.current?.abort(), []);

  async function exportar(tipo) {
    if (operacion.current) return;
    const controlador = new AbortController();
    operacion.current = controlador;
    cambiarFormato(tipo);
    cambiarEstado({});
    try {
      const horarios = programa
        ? programa.fichas.flatMap((ficha) =>
            ficha.horarios.map((horario) => ({
              ...horario,
              numero_ficha: ficha.numero_ficha,
            }))
          )
        : await consultarReporte(
            '/reportes/horarios',
            'id_horario',
            {},
            controlador.signal
          );
      if (controlador.signal.aborted) return;
      if (!horarios.length) {
        cambiarEstado({ mensaje: 'No hay horarios para exportar.' });
        return;
      }
      await descargarReporte(reporteHorarios(horarios, programa), tipo);
    } catch (error) {
      if (!controlador.signal.aborted) cambiarEstado({ error });
    } finally {
      operacion.current = null;
      cambiarFormato('');
    }
  }

  return (
    <div>
      <div
        className="xn-admin-acciones"
        role="group"
        aria-label="Exportar horarios"
      >
        <button
          type="button"
          className="xn-boton xn-boton--secundario"
          disabled={!!formato}
          onClick={() => exportar('xlsx')}
        >
          {formato === 'xlsx' ? 'Preparando Excel…' : 'Exportar horarios Excel'}
        </button>
        <button
          type="button"
          className="xn-boton xn-boton--secundario"
          disabled={!!formato}
          onClick={() => exportar('csv')}
        >
          {formato === 'csv' ? 'Preparando CSV…' : 'Exportar horarios CSV'}
        </button>
      </div>
      <MensajeEstado {...estado} />
    </div>
  );
}
