/** Una ficha en una línea: número, nombre y programa, jornada, aprendices y periodo. */
import { ChevronRight as Abrir } from 'lucide-react';
import { JornadaRegla } from './JornadaRegla.jsx';
import { avancePeriodo, fechaCorta } from './utilidades.js';

export function Periodo({ inicio, fin }) {
  const avance = avancePeriodo(inicio, fin);
  if (avance === null)
    return <span className="xn-periodo es-vacio">Sin fechas de formación</span>;
  return (
    <span className="xn-periodo" style={{ '--avance': `${avance}%` }}>
      <span>
        {fechaCorta(inicio)} – {fechaCorta(fin)}
      </span>
      <span className="xn-periodo-barra" aria-hidden="true" />
      <span className="xn-solo-lectores">{avance}% del periodo cumplido</span>
    </span>
  );
}

export function FilaFicha({ ficha, alAbrir, mostrarPrograma = true }) {
  const aprendices = ficha.total_aprendices ?? 0;
  return (
    <li className="xn-fila-ficha">
      <button type="button" className="xn-fila-ficha-boton" onClick={alAbrir}>
        <span className="xn-fila-ficha-numero">{ficha.numero_ficha}</span>
        <span className="xn-fila-ficha-nombre">
          <strong>
            {ficha.nombre_ficha ||
              (mostrarPrograma
                ? ficha.nombre_programa
                : `Ficha ${ficha.numero_ficha}`)}
          </strong>
          {mostrarPrograma && ficha.nombre_ficha && (
            <span>{ficha.nombre_programa}</span>
          )}
          {!mostrarPrograma && ficha.modalidad && (
            <span>{ficha.modalidad}</span>
          )}
        </span>
        <JornadaRegla
          compacta
          nombre={ficha.jornada}
          inicio={ficha.hora_inicio}
          fin={ficha.hora_fin}
        />
        <span className="xn-fila-ficha-cifra">
          <strong>{aprendices}</strong>
          {aprendices === 1 ? 'aprendiz' : 'aprendices'}
        </span>
        <Abrir size={18} aria-hidden="true" className="xn-fila-ficha-flecha" />
      </button>
    </li>
  );
}
