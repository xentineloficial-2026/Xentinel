/** Carnet firmado de la web, lectura de archivos de carga masiva y mensajes del escáner. */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import {
  base32,
  pasoDe,
  prepararFirma,
} from '../src/compartido/utilidades/carnetFirmado.js';
import {
  interpretarFilas,
  leerCsv,
} from '../src/modulos/admin/academico/cargaMasiva.js';
import {
  resultadoError,
  resultadoRegistro,
} from '../src/modulos/celador/resultadoAcceso.js';
import { textoResumen } from '../src/modulos/admin/academico/utilidades.js';

test('el carnet de la web firma igual que el servidor y la app', async () => {
  const clave = Buffer.from('clave-de-prueba-de-32-bytes-1234');
  const firmar = await prepararFirma(clave.toString('base64url'));
  const paso = pasoDe(Date.UTC(2026, 10, 27, 12, 0, 0));
  const esperado = base32(
    createHmac('sha256', clave).update(`XN2:42:${paso}`).digest()
  ).slice(0, 20);
  assert.equal(await firmar(42, paso), `XN2:42:${paso}:${esperado}`);
  assert.match(await firmar(42, paso), /^XN2:42:\d+:[A-Z2-7]{20}$/);
});

test('CSV con punto y coma, comillas, BOM y encabezados en otro orden', () => {
  const matriz = leerCsv(
    '﻿Correo;Número de documento;"Nombre completo";Ficha\r\nana@x.co;123;"Ríos; Ana";2675859\r\n;;;\r\n'
  );
  const filas = interpretarFilas(matriz);
  assert.deepEqual(filas, [
    {
      correo: 'ana@x.co',
      numero_documento: '123',
      nombres_completos: 'Ríos; Ana',
      numero_ficha: '2675859',
    },
  ]);
  assert.deepEqual(
    interpretarFilas(leerCsv('Nombre,Documento,Email\nBeto,9,b@x.co\n'), {
      numeroFicha: 'F1',
    }),
    [
      {
        nombres_completos: 'Beto',
        numero_documento: '9',
        correo: 'b@x.co',
        numero_ficha: 'F1',
      },
    ]
  );
  assert.throws(
    () => interpretarFilas(leerCsv('Nombre;Correo\nAna;a@x.co')),
    /Número de documento/
  );
});

test('el escáner dice si la asistencia quedó registrada, si el usuario está inactivo o no existe', () => {
  const entrada = resultadoRegistro({
    estado: 'Permitido',
    tipo: 'ENTRADA',
    fechahora: '2026-11-27T12:02:00Z',
    asistencia: { estado: 'Presente' },
    persona: { nombres_completos: 'Ana' },
  });
  assert.equal(entrada.titulo, 'Asistencia registrada con éxito');
  assert.equal(entrada.tono, 'entrada');
  assert.match(entrada.detalle, /Presente/);
  const inactivo = resultadoRegistro({
    estado: 'Denegado',
    tipo: 'ENTRADA',
    motivo: { codigo: 'USUARIO_INACTIVO' },
    persona: {},
  });
  assert.equal(inactivo.titulo, 'Usuario inactivo');
  assert.equal(inactivo.tono, 'error');
  assert.equal(
    resultadoError({ code: 'NOT_FOUND', status: 404 }, 'ENTRADA').titulo,
    'Usuario no encontrado'
  );
  assert.equal(
    resultadoError({ code: 'ACCESS_SEQUENCE', status: 409 }, 'SALIDA').titulo,
    'No tiene una entrada registrada'
  );
  assert.equal(
    resultadoError({ status: 0, message: '' }, 'ENTRADA').titulo,
    'Sin conexión con el servidor'
  );
});

test('resumen de la carga masiva en palabras', () => {
  assert.equal(
    textoResumen({ creados: 12, fichas_actualizadas: 1, omitidos: 3 }, true),
    '12 aprendices creados, 1 ficha actualizada, 3 errores omitidos'
  );
});
