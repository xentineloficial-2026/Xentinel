// Starts the real Backend against a disposable localhost-only test database.
// Never reads .env or connects to the application's production database.
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';

const backend = resolve(process.argv[2]);
const databaseUrl = new URL(process.argv[3]);
if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.port !== '55439' || databaseUrl.pathname !== '/postgres') {
  throw new Error('Use the disposable local cluster on 127.0.0.1:55439/postgres.');
}
const load = file => import(pathToFileURL(join(backend, file)).href);
const {createPool} = await load('src/db.js');
const {migrate} = await load('scripts/migrate.js');
const {createApp} = await load('src/app.js');
const {readConfig} = await load('src/config.js');
const require = createRequire(join(backend, 'package.json'));
const bcrypt = require('bcryptjs');
const name = `xentinel_mobile_smoke_${process.pid}_${Date.now()}`;
const root = createPool(databaseUrl.href);
let pool, server, closeStreams, created = false, closing = false;

async function close() {
  if (closing) return;
  closing = true;
  closeStreams?.();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await pool?.end();
  if (created) await root.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await root.end();
  process.exit(0);
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
process.stdin.once('data', close);
setTimeout(close, 15 * 60 * 1000).unref();
try {
  await root.query(`CREATE DATABASE "${name}"`);
  created = true;
  databaseUrl.pathname = `/${name}`;
  pool = createPool(databaseUrl.href);
  await migrate(pool);
  const hash = await bcrypt.hash('Mobile-Prueba-2026!', 12);
  for (const [document, role, name] of [
    ['90001','Administrador','María Prueba'], ['90002','Aprendiz','Andrés Prueba'],
  ]) {
    await pool.query(`INSERT INTO usuarios(nombres_completos,tipo_documento,numero_documento,correo,contrasena,id_rol)
      SELECT $1,'CC',$2,$3,$4,id_rol FROM rol WHERE nombre_rol=$5`,
      [name,document,`${document}@mobile-test.example`,hash,role]);
  }
  const config = readConfig({NODE_ENV:'test',DATABASE_URL:databaseUrl.href,
    JWT_SECRET:randomBytes(32).toString('hex'),MAIL_ENCRYPTION_KEY:randomBytes(32).toString('hex'),
    WEB_ORIGINS:'http://localhost:5173',RESET_PASSWORD_URL:'http://localhost:8000/restablecer-contrasena'});
  const built = createApp(pool,config,{pollMs:50,heartbeatMs:100});
  closeStreams = built.closeStreams;
  server = await new Promise((resolve,reject) => {
    const listening = built.app.listen(18923,'127.0.0.1',()=>resolve(listening));
    listening.once('error',reject);
  });
  console.log('SMOKE_READY http://127.0.0.1:18923/api/v1 (write stop to stdin to clean up)');
} catch (error) {
  console.error(error.message);
  await close();
}
