/** Prepara reportes completos por cursor y conserva la fecha civil de Bogotá. */
import { solicitar } from '../../compartido/servicios/cliente.js';

const formatoFecha = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const formatoHora = new Intl.DateTimeFormat('es-CO', {
  timeZone: 'America/Bogota',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function fechaBogota(instante = new Date()) {
  const partes = Object.fromEntries(
    formatoFecha.formatToParts(instante).map(({ type, value }) => [type, value])
  );
  return `${partes.year}-${partes.month}-${partes.day}`;
}

/** Verifica el cursor antes de aceptar cada lote; nunca descarga un reporte parcial. */
export async function consultarReporte(ruta, clave, parametros = {}, senal) {
  const filas = [];
  let despues = 0;
  let hasta;
  do {
    const consulta = new URLSearchParams({
      ...parametros,
      limit: '100',
      despues,
    });
    if (hasta != null) consulta.set('hasta', hasta);
    const { data, meta } = await solicitar(`${ruta}?${consulta}`, {
      signal: senal,
    });
    if (
      !Array.isArray(data) ||
      !meta ||
      !Number.isSafeInteger(meta.hasta) ||
      meta.hasta < despues ||
      (hasta != null && meta.hasta !== hasta) ||
      !Object.hasOwn(meta, 'siguiente')
    ) {
      throw new Error(
        'El servidor no devolvió un reporte completo. Verifica que la API esté actualizada.'
      );
    }
    hasta = meta.hasta;
    let anterior = despues;
    for (const fila of data) {
      if (
        !Number.isSafeInteger(fila[clave]) ||
        fila[clave] <= anterior ||
        fila[clave] > hasta
      ) {
        throw new Error(
          'El orden de los registros cambió durante la consulta. Intenta nuevamente.'
        );
      }
      anterior = fila[clave];
    }
    if (
      meta.siguiente !== null &&
      (meta.siguiente !== anterior || anterior <= despues)
    ) {
      throw new Error('No se pudo continuar la descarga del reporte.');
    }
    filas.push(...data);
    despues = meta.siguiente;
  } while (despues !== null);
  return filas;
}

/** Fecha legible para Colombia: 2026-11-04 → 04/11/2026. */
export function fechaLegible(iso) {
  if (!iso) return '';
  const [anio, mes, dia] = String(iso).slice(0, 10).split('-');
  return `${dia}/${mes}/${anio}`;
}

function horaCorta(hora) {
  return hora ? String(hora).slice(0, 5) : '';
}

function periodoLegible({ desde, hasta }) {
  return desde === hasta
    ? fechaLegible(desde)
    : `${fechaLegible(desde)} a ${fechaLegible(hasta)}`;
}

/** Columnas de contexto de cada persona, iguales en todos los reportes. */
const COLUMNAS_PERSONA = [
  'Nombre completo',
  'Tipo de documento',
  'Documento',
  'Rol',
  'Programa de formación',
  'Ficha',
];
const datosPersona = (fila, contexto = {}) => [
  fila.nombres_completos ?? '',
  fila.tipo_documento ?? '',
  fila.numero_documento ?? '',
  fila.nombre_rol ?? contexto.rol ?? '',
  fila.nombre_programa ?? contexto.programa ?? '',
  fila.numero_ficha ?? contexto.ficha ?? '',
];

/**
 * Ingresos y salidas de uno o varios días. Cada fila es una visita: la entrada y la salida
 * de la misma persona el mismo día quedan juntas, con la fecha aparte de las horas.
 * Los intentos denegados se listan solos.
 */
export function reporteIngresos(rango, accesos) {
  const ordenados = [...accesos].sort(
    (a, b) =>
      new Date(a.fechahora) - new Date(b.fechahora) || a.id_acceso - b.id_acceso
  );
  const fuera = ordenados.some((acceso) => {
    const dia = fechaBogota(new Date(acceso.fechahora));
    return dia < rango.desde || dia > rango.hasta;
  });
  if (fuera)
    throw new Error(
      'El servidor devolvió movimientos de otro día. No se descargó el reporte.'
    );
  const visitas = [];
  const abiertas = new Map();
  for (const acceso of ordenados) {
    const fecha = fechaBogota(new Date(acceso.fechahora));
    const hora = formatoHora.format(new Date(acceso.fechahora));
    const clave = `${acceso.id_usuarios}|${fecha}`;
    const permitido = acceso.estado === 'Permitido';
    if (permitido && acceso.tipo === 'SALIDA' && abiertas.has(clave)) {
      abiertas.get(clave).salida = hora;
      abiertas.delete(clave);
      continue;
    }
    const visita = {
      acceso,
      fecha,
      entrada: acceso.tipo === 'ENTRADA' ? hora : '',
      salida: acceso.tipo === 'SALIDA' ? hora : '',
    };
    visitas.push(visita);
    if (permitido && acceso.tipo === 'ENTRADA') abiertas.set(clave, visita);
  }
  return {
    titulo: 'Reporte de ingresos y salidas',
    hoja: 'Ingresos',
    subtitulo: `${periodoLegible(rango)} · Hora de Bogotá · ${ordenados.length} movimientos`,
    archivo:
      rango.desde === rango.hasta
        ? `xentinel-ingresos-${rango.desde}`
        : `xentinel-ingresos-${rango.desde}-a-${rango.hasta}`,
    columnas: [
      'Fecha',
      ...COLUMNAS_PERSONA,
      'Hora de entrada',
      'Hora de salida',
      'Método',
      'Resultado',
    ],
    filas: visitas.map(({ acceso, fecha, entrada, salida }) => [
      fechaLegible(fecha),
      ...datosPersona(acceso),
      entrada,
      salida,
      acceso.metodo,
      acceso.estado,
    ]),
  };
}

/** Compatibilidad: historial de un solo día. */
export function reporteAccesos(fecha, accesos) {
  return reporteIngresos({ desde: fecha, hasta: fecha }, accesos);
}

/** Asistencia de toda la sede (o de una ficha) en un periodo, desde /reportes/asistencia. */
export function reporteAsistenciaGeneral(rango, filas, numeroFicha) {
  return {
    titulo: 'Reporte de asistencia',
    hoja: 'Asistencia',
    subtitulo: `${periodoLegible(rango)} · ${numeroFicha ? `Ficha ${numeroFicha}` : 'Toda la sede'} · ${filas.length} registros`,
    archivo: `xentinel-asistencia-${numeroFicha ?? 'sede'}-${rango.desde}${rango.hasta !== rango.desde ? `-a-${rango.hasta}` : ''}`,
    columnas: [
      'Fecha',
      ...COLUMNAS_PERSONA,
      'Hora de entrada',
      'Hora de salida',
      'Estado',
    ],
    filas: [...filas]
      .sort(
        (a, b) =>
          a.fecha.localeCompare(b.fecha) ||
          (a.nombres_completos ?? '').localeCompare(b.nombres_completos ?? '')
      )
      .map((fila) => [
        fechaLegible(fila.fecha),
        ...datosPersona(fila),
        horaCorta(fila.hora_entrada),
        horaCorta(fila.hora_salida),
        fila.estado,
      ]),
  };
}

/** Lista de asistencia de un día, por ficha (vista del instructor). */
export function reporteAsistencia(fecha, filas, numeroFicha, programa) {
  return {
    titulo: 'Lista de asistencia',
    hoja: 'Asistencia',
    subtitulo: `${fechaLegible(fecha)} · ${numeroFicha ? `Ficha ${numeroFicha}` : 'Todas las fichas'} · ${filas.length} aprendices`,
    archivo: `xentinel-asistencia-${numeroFicha ?? 'fichas'}-${fecha}`,
    columnas: [
      'Fecha',
      ...COLUMNAS_PERSONA,
      'Ambiente',
      'Hora de entrada',
      'Hora de salida',
      'Estado',
    ],
    filas: filas.map((fila) => [
      fechaLegible(fila.fecha ?? fecha),
      ...datosPersona(fila, { rol: 'Aprendiz', programa }),
      fila.ambiente ?? '',
      horaCorta(fila.hora_entrada),
      horaCorta(fila.hora_salida),
      fila.estado_asistencia,
    ]),
  };
}

/** Frecuencia de llegadas de una semana o un mes; con aprendiz elegido, su historial día a día. */
export function reporteAsistenciaPeriodo({
  rango,
  nombre,
  numeroFicha,
  programa,
  resumen,
  detalle,
  persona,
}) {
  const contexto = { rol: 'Aprendiz', programa, ficha: numeroFicha };
  const base = {
    subtitulo: `${nombre} · ${periodoLegible(rango)} · Ficha ${numeroFicha ?? ''}`,
    hoja: 'Asistencia',
  };
  if (persona && detalle.length)
    return {
      ...base,
      titulo: `Asistencia de ${persona.nombres_completos}`,
      archivo: `xentinel-asistencia-${persona.numero_documento}-${rango.desde}-${rango.hasta}`,
      columnas: [
        'Fecha',
        ...COLUMNAS_PERSONA,
        'Hora de entrada',
        'Hora de salida',
        'Estado',
      ],
      filas: detalle.map((fila) => [
        fechaLegible(fila.fecha),
        ...datosPersona({ ...persona, ...fila }, contexto),
        horaCorta(fila.hora_entrada),
        horaCorta(fila.hora_salida),
        fila.estado_asistencia,
      ]),
    };
  return {
    ...base,
    titulo: 'Frecuencia de asistencia',
    archivo: `xentinel-frecuencia-${numeroFicha ?? 'ficha'}-${rango.desde}-${rango.hasta}`,
    columnas: [
      'Desde',
      'Hasta',
      ...COLUMNAS_PERSONA,
      'Días de clase',
      'Presente',
      'Retardo',
      'Ausente',
      'Sin registro',
      'Asistencia %',
      'Puntualidad %',
    ],
    filas: resumen.map((fila) => [
      fechaLegible(rango.desde),
      fechaLegible(rango.hasta),
      ...datosPersona(fila, contexto),
      fila.dias,
      fila.presentes,
      fila.retardos,
      fila.ausentes,
      fila.sin_registro,
      fila.asistencia,
      fila.puntualidad,
    ]),
  };
}

export function reporteHorarios(horarios, programa) {
  return {
    titulo: 'Horarios de formación',
    hoja: 'Horarios',
    subtitulo: programa ? programa.nombre_programa : 'Todos los programas',
    archivo: programa
      ? `xentinel-horarios-programa-${programa.id_programa}`
      : 'xentinel-horarios',
    columnas: [
      'Programa',
      'Ficha',
      'Clase',
      'Día',
      'Inicio',
      'Fin',
      'Entorno',
      'Instructor',
    ],
    filas: horarios.map((horario) => [
      programa?.nombre_programa ?? horario.nombre_programa ?? '',
      horario.numero_ficha ?? horario.id_ficha,
      horario.nombre_clase,
      horario.dia_semana,
      horario.hora_inicio?.slice(0, 5),
      horario.hora_fin?.slice(0, 5),
      horario.ambiente ?? '',
      horario.instructor ?? horario.id_instructor,
    ]),
  };
}
