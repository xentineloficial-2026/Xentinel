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

export function reporteAccesos(fecha, accesos) {
  const ordenados = [...accesos].sort(
    (a, b) =>
      new Date(a.fechahora) - new Date(b.fechahora) || a.id_acceso - b.id_acceso
  );
  if (
    ordenados.some(
      (acceso) => fechaBogota(new Date(acceso.fechahora)) !== fecha
    )
  ) {
    throw new Error(
      'El servidor devolvió movimientos de otro día. No se descargó el reporte.'
    );
  }
  return {
    titulo: 'Historial diario de accesos',
    subtitulo: `${fecha} · Hora de Bogotá · ${ordenados.length} movimientos`,
    archivo: `xentinel-accesos-${fecha}`,
    columnas: ['Hora', 'ID de usuario', 'Movimiento', 'Método', 'Resultado'],
    filas: ordenados.map((acceso) => [
      formatoHora.format(new Date(acceso.fechahora)),
      acceso.id_usuarios,
      acceso.tipo === 'ENTRADA' ? 'Entrada' : 'Salida',
      acceso.metodo,
      acceso.estado,
    ]),
  };
}

export function reporteAsistencia(fecha, filas, numeroFicha) {
  return {
    titulo: 'Lista de asistencia',
    subtitulo: `${fecha} · ${numeroFicha ? `Ficha ${numeroFicha}` : 'Todas las fichas'} · ${filas.length} aprendices`,
    archivo: `xentinel-asistencia-${numeroFicha ?? 'fichas'}-${fecha}`,
    columnas: [
      'Aprendiz',
      'Tipo',
      'Documento',
      'Ficha',
      'Aula',
      'Entrada',
      'Salida',
      'Estado',
    ],
    filas: filas.map((fila) => [
      fila.nombres_completos,
      fila.tipo_documento,
      fila.numero_documento,
      fila.numero_ficha,
      fila.ambiente ?? '',
      fila.hora_entrada?.slice(0, 5) ?? '',
      fila.hora_salida?.slice(0, 5) ?? '',
      fila.estado_asistencia,
    ]),
  };
}

export function reporteHorarios(horarios, programa) {
  return {
    titulo: 'Horarios de formación',
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
