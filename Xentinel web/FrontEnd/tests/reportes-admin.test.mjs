/** Verifica paginación completa, límites de fecha y formatos descargables reales. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import Excel from 'exceljs';
import {
  generarCsv,
  generarExcel,
} from '../src/modulos/admin/archivosReporte.js';
import {
  consultarReporte,
  fechaBogota,
  reporteAccesos,
  reporteAsistenciaGeneral,
  reporteAsistenciaPeriodo,
  reporteIngresos,
  reporteHorarios,
} from '../src/modulos/admin/reportes.js';

test('el día civil del reporte no cambia a medianoche UTC', () => {
  assert.equal(fechaBogota(new Date('2026-11-04T04:59:59Z')), '2026-11-03');
  assert.equal(fechaBogota(new Date('2026-11-04T05:00:00Z')), '2026-11-04');
  assert.throws(
    () =>
      reporteAccesos('2026-11-04', [
        { id_acceso: 1, fechahora: '2026-11-04T04:59:59Z' },
      ]),
    /otro día/
  );
});

test('los lotes de exportación comparten un límite y rechazan respuestas parciales', async (t) => {
  const filas = Array.from({ length: 101 }, (_, indice) => ({
    id_acceso: indice + 1,
  }));
  const peticiones = [];
  t.mock.method(globalThis, 'fetch', async (ruta) => {
    const consulta = new URL(ruta, 'https://xentinel.test').searchParams;
    peticiones.push(Object.fromEntries(consulta));
    const ultimo = Number(consulta.get('despues'));
    return Response.json({
      data: filas.slice(ultimo, ultimo + 100),
      meta: { hasta: 101, siguiente: ultimo ? null : 100 },
    });
  });
  assert.deepEqual(
    await consultarReporte('/reportes/accesos', 'id_acceso', {
      fecha: '2026-11-04',
    }),
    filas
  );
  assert.deepEqual(peticiones[1], {
    fecha: '2026-11-04',
    limit: '100',
    despues: '100',
    hasta: '101',
  });
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ data: filas.slice(0, 100) })
  );
  await assert.rejects(
    consultarReporte('/reportes/accesos', 'id_acceso'),
    /reporte completo/
  );
});

test('el CSV conserva todos los movimientos, incluido el último', async () => {
  const accesos = Array.from({ length: 101 }, (_, indice) => ({
    id_acceso: indice + 1,
    fechahora: '2026-11-04T05:00:00Z',
    id_usuarios: 90100 + indice,
    nombres_completos: `Persona ${90100 + indice}`,
    tipo: indice % 2 ? 'ENTRADA' : 'SALIDA',
    metodo: 'Manual',
    estado: 'Permitido',
  }));
  const archivo = generarCsv(reporteAccesos('2026-11-04', accesos));
  const contenido = await archivo.text();
  assert.equal(contenido.trim().split('\r\n').length, 102);
  assert.match(contenido, /Persona 90200/);
});

test('ingresos: fecha aparte, entrada y salida en la misma fila y contexto de la persona', () => {
  const persona = {
    id_usuarios: 7,
    nombres_completos: 'Ana Prueba',
    tipo_documento: 'TI',
    numero_documento: '1001',
    nombre_rol: 'Aprendiz',
    nombre_programa: 'ADSO',
    numero_ficha: '2675859',
    metodo: 'QR',
  };
  const reporte = reporteIngresos(
    { desde: '2026-11-03', hasta: '2026-11-04' },
    [
      {
        ...persona,
        id_acceso: 1,
        tipo: 'ENTRADA',
        estado: 'Permitido',
        fechahora: '2026-11-03T12:05:00Z',
      },
      {
        ...persona,
        id_acceso: 2,
        tipo: 'SALIDA',
        estado: 'Permitido',
        fechahora: '2026-11-03T22:10:00Z',
      },
      {
        ...persona,
        id_acceso: 3,
        tipo: 'ENTRADA',
        estado: 'Denegado',
        fechahora: '2026-11-04T12:00:00Z',
      },
    ]
  );
  assert.deepEqual(reporte.columnas, [
    'Fecha',
    'Nombre completo',
    'Tipo de documento',
    'Documento',
    'Rol',
    'Programa de formación',
    'Ficha',
    'Hora de entrada',
    'Hora de salida',
    'Método',
    'Resultado',
  ]);
  assert.deepEqual(reporte.filas, [
    [
      '03/11/2026',
      'Ana Prueba',
      'TI',
      '1001',
      'Aprendiz',
      'ADSO',
      '2675859',
      '07:05:00',
      '17:10:00',
      'QR',
      'Permitido',
    ],
    [
      '04/11/2026',
      'Ana Prueba',
      'TI',
      '1001',
      'Aprendiz',
      'ADSO',
      '2675859',
      '07:00:00',
      '',
      'QR',
      'Denegado',
    ],
  ]);
  assert.match(reporte.subtitulo, /03\/11\/2026 a 04\/11\/2026/);
});

test('asistencia general: una fila por persona y día con fecha legible', () => {
  const reporte = reporteAsistenciaGeneral(
    { desde: '2026-11-04', hasta: '2026-11-04' },
    [
      {
        id_asistencia: 1,
        fecha: '2026-11-04',
        hora_entrada: '07:20:00',
        hora_salida: null,
        estado: 'Retardo',
        nombres_completos: 'Beto',
        tipo_documento: 'CC',
        numero_documento: '9',
        nombre_rol: 'Instructor',
        nombre_programa: null,
        numero_ficha: null,
      },
    ]
  );
  assert.deepEqual(reporte.filas[0], [
    '04/11/2026',
    'Beto',
    'CC',
    '9',
    'Instructor',
    '',
    '',
    '07:20',
    '',
    'Retardo',
  ]);
});

test('la frecuencia por periodo exporta el resumen y el historial del aprendiz', () => {
  const persona = {
    id_usuarios: 7,
    nombres_completos: 'Ana Prueba',
    tipo_documento: 'TI',
    numero_documento: '1001',
    dias: 4,
    presentes: 2,
    retardos: 1,
    ausentes: 0,
    sin_registro: 1,
    asistencia: 75,
    puntualidad: 67,
  };
  const base = {
    rango: { desde: '2026-11-02', hasta: '2026-11-08' },
    nombre: 'semana',
    numeroFicha: '3',
    resumen: [persona],
  };
  const resumen = reporteAsistenciaPeriodo({ ...base, detalle: [] });
  assert.deepEqual(resumen.columnas.slice(0, 2), ['Desde', 'Hasta']);
  assert.deepEqual(resumen.columnas.slice(9, 13), [
    'Presente',
    'Retardo',
    'Ausente',
    'Sin registro',
  ]);
  assert.deepEqual(resumen.filas[0].slice(0, 2), ['02/11/2026', '08/11/2026']);
  assert.deepEqual(resumen.filas[0].slice(8, 15), [4, 2, 1, 0, 1, 75, 67]);
  const historial = reporteAsistenciaPeriodo({
    ...base,
    persona,
    detalle: [{ fecha: '2026-11-02', estado_asistencia: 'Retardo' }],
  });
  assert.deepEqual(historial.filas[0], [
    '02/11/2026',
    'Ana Prueba',
    'TI',
    '1001',
    'Aprendiz',
    '',
    '3',
    '',
    '',
    'Retardo',
  ]);
});

test('Excel abre como .xlsx y conserva valores con formato de texto', async () => {
  const reporte = reporteHorarios([
    {
      nombre_programa: 'Análisis',
      numero_ficha: '00123',
      nombre_clase: '=1+1',
      dia_semana: 'Miércoles',
      hora_inicio: '08:00:00',
      hora_fin: '10:00:00',
      ambiente: 'Aula 1',
      instructor: 'Docente',
    },
  ]);
  const archivo = await generarExcel(reporte);
  const libro = new Excel.Workbook();
  await libro.xlsx.load(await archivo.arrayBuffer());
  const hoja = libro.getWorksheet('Horarios');
  assert.equal(hoja.getCell('B2').value, '00123');
  assert.equal(hoja.getCell('C2').value, '=1+1');
  assert.equal(hoja.getCell('G2').value, 'Aula 1');
});

test('CSV abre en Excel en español y neutraliza fórmulas', async () => {
  const { generarCsv } =
    await import('../src/modulos/admin/archivosReporte.js');
  const archivo = generarCsv({
    columnas: ['Nombre', 'Nota'],
    filas: [
      ['Núñez; Ana', '=1+1'],
      ['Dice "hola"', null],
    ],
  });
  const crudo = new Uint8Array(await archivo.arrayBuffer());
  assert.deepEqual([...crudo.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(
    new TextDecoder().decode(crudo),
    'Nombre;Nota\r\n"Núñez; Ana";\'=1+1\r\n"Dice ""hola""";\r\n'
  );
});
