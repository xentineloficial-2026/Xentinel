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
  reporteAsistenciaPeriodo,
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
    tipo: indice % 2 ? 'ENTRADA' : 'SALIDA',
    metodo: 'Manual',
    estado: 'Permitido',
  }));
  const archivo = generarCsv(reporteAccesos('2026-11-04', accesos));
  const contenido = await archivo.text();
  assert.equal(contenido.trim().split('\r\n').length, 102);
  assert.match(contenido, /90200/);
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
  assert.deepEqual(resumen.columnas.slice(4, 8), [
    'Presente',
    'Retardo',
    'Ausente',
    'Sin registro',
  ]);
  assert.deepEqual(resumen.filas[0].slice(4, 10), [2, 1, 0, 1, 75, 67]);
  const historial = reporteAsistenciaPeriodo({
    ...base,
    persona,
    detalle: [{ fecha: '2026-11-02', estado_asistencia: 'Retardo' }],
  });
  assert.deepEqual(historial.filas[0], ['2026-11-02', '', '', 'Retardo']);
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
