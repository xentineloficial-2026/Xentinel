/** Arranca la API Python para las pruebas de contrato y aísla el correo de prueba. */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const ejecutar = promisify(execFile);
const python = () => process.env.XENTINEL_PYTHON || 'python';

export async function migrarFastApi(databaseUrl) {
  await ejecutar(python(), ['-m', 'xentinel', 'migrar'], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    timeout: 20000,
  });
}

export async function iniciarFastApi(config) {
  const proceso = spawn(
    python(),
    [
      '-m',
      'uvicorn',
      'xentinel.main:crear_aplicacion',
      '--factory',
      '--host',
      '127.0.0.1',
      '--port',
      '0',
      '--no-proxy-headers',
      '--no-access-log',
      '--no-use-colors',
    ],
    { env: { ...process.env, ...config }, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let salida = '';
  const fin = new Promise((resolver) => proceso.once('close', resolver));
  try {
    const base = await new Promise((resolver, rechazar) => {
      const reloj = setTimeout(() => rechazar(new Error(`FastAPI no arrancó: ${salida}`)), 15000);
      proceso.once('error', (error) => {
        clearTimeout(reloj);
        rechazar(error);
      });
      proceso.once('close', (codigo) => {
        clearTimeout(reloj);
        rechazar(new Error(`FastAPI terminó (${codigo}): ${salida}`));
      });
      proceso.stderr.on('data', (fragmento) => {
        salida = (salida + fragmento).slice(-12000);
        const url = salida.match(/Uvicorn running on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
        if (url) {
          clearTimeout(reloj);
          resolver(url);
        }
      });
    });
    return {
      base,
      cerrar: async () => {
        proceso.kill();
        await fin;
      },
      diagnostico: () => salida,
    };
  } catch (error) {
    proceso.kill();
    await fin;
    throw error;
  }
}

export async function recogerCorreoFastApi(config) {
  const programa = `
import json
from xentinel.base_datos import BaseDatos
from xentinel.configuracion import cargar_configuracion
from xentinel.correo import procesar_correo

config = cargar_configuracion()
base = BaseDatos(config.DATABASE_URL)
with base.pool:
    procesar_correo(base, config, lambda datos, _: print(json.dumps(datos)))
`;
  const { stdout } = await ejecutar(python(), ['-c', programa], {
    env: { ...process.env, ...config },
    timeout: 15000,
  });
  return stdout.trim() ? JSON.parse(stdout) : null;
}
