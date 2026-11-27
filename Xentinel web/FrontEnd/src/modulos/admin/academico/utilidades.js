/** Funciones y valores compartidos por los componentes de programas y fichas. */
import { useEffect, useState } from 'react';
import { useRecurso } from '../../../compartido/ganchos/useRecurso.js';

export function useRetardo(valor, milisegundos = 300) {
  const [retrasado, cambiarRetrasado] = useState(valor);
  useEffect(() => {
    const reloj = setTimeout(() => cambiarRetrasado(valor), milisegundos);
    return () => clearTimeout(reloj);
  }, [valor, milisegundos]);
  return retrasado;
}

/** El id del rol Aprendiz, para filtrar el directorio. */
export function useRolAprendiz() {
  const roles = useRecurso('/roles?limit=100');
  return {
    roles,
    id: roles.datos?.find((rol) => rol.nombre_rol?.toLowerCase() === 'aprendiz')
      ?.id_rol,
  };
}

export function plural(cantidad, singular, varios) {
  return `${cantidad} ${cantidad === 1 ? singular : varios}`;
}

/** «X aprendices creados, Y fichas actualizadas, Z errores omitidos». */
export function textoResumen(resumen, soloAprendices) {
  return [
    soloAprendices
      ? plural(resumen.creados, 'aprendiz creado', 'aprendices creados')
      : plural(resumen.creados, 'persona creada', 'personas creadas'),
    plural(
      resumen.fichas_actualizadas,
      'ficha actualizada',
      'fichas actualizadas'
    ),
    plural(resumen.omitidos, 'error omitido', 'errores omitidos'),
  ].join(', ');
}

/* Horario habitual de cada jornada; se propone al elegirla y se puede ajustar. */
export const JORNADAS = {
  Mañana: ['06:00', '12:00'],
  Tarde: ['12:00', '18:00'],
  Noche: ['18:00', '22:00'],
  Mixta: ['07:00', '17:00'],
};

const formatoFecha = new Intl.DateTimeFormat('es-CO', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export function fechaCorta(iso) {
  return iso
    ? formatoFecha.format(new Date(`${String(iso).slice(0, 10)}T00:00:00Z`))
    : '';
}

/** Avance del periodo de formación entre 0 y 100, o null sin fechas. */
export function avancePeriodo(inicio, fin, hoy = new Date()) {
  if (!inicio || !fin) return null;
  const desde = new Date(`${String(inicio).slice(0, 10)}T00:00:00Z`);
  const hasta = new Date(`${String(fin).slice(0, 10)}T00:00:00Z`);
  if (!(hasta > desde)) return null;
  return Math.round(
    Math.min(1, Math.max(0, (hoy - desde) / (hasta - desde))) * 100
  );
}

export function minutosDe(hora) {
  if (!hora) return null;
  const [h, m] = String(hora).split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
}

export function horaCorta(hora) {
  if (!hora) return '';
  const [h, m] = String(hora).split(':');
  return `${Number(h)}:${m}`;
}
