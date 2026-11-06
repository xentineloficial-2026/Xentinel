import test from 'node:test';
import assert from 'node:assert/strict';
import { extraerEventos } from '../src/compartido/servicios/eventos.js';

test('un fragmento de red incompleto espera al siguiente sin perder el evento', () => {
  const primero = extraerEventos('retry: 2000\n\nid: 7\nevent: change\ndata: {"recu');
  assert.deepEqual(primero.eventos, []);
  const segundo = extraerEventos(`${primero.resto}rso":"acceso"}\n\n`);
  assert.deepEqual(segundo.eventos, [
    { tipo: 'change', id: '7', datos: { recurso: 'acceso' } },
  ]);
  assert.equal(segundo.resto, '');
});

test('acepta fin de línea CRLF e ignora un bloque con JSON dañado', () => {
  const { eventos } = extraerEventos(
    'event: change\r\ndata: {roto\r\n\r\nevent: checkpoint\r\nid: 9\r\ndata: {"cursor":"9"}\r\n\r\n'
  );
  assert.deepEqual(eventos, [
    { tipo: 'checkpoint', id: '9', datos: { cursor: '9' } },
  ]);
});
