import { readConfig } from './config.js';
import { createPool, assertSchema } from './db.js';
import { createApp } from './app.js';
import { createMailer, startMailWorker } from './services/mail.js';

const config = readConfig(),
  pool = createPool(config.DATABASE_URL);
await assertSchema(pool);
const { app, closeStreams } = createApp(pool, config),
  mailer = createMailer(config);
if (mailer) await mailer.verify();
else console.warn('SMTP no configurado: recuperación de contraseña no disponible');
const stopMail = startMailWorker(pool, config, mailer);
const cleanup = setInterval(
  () =>
    pool
      .query('DELETE FROM api_rate_limits WHERE expires_at<now()')
      .catch(() => console.error('RATE_LIMIT_CLEANUP_ERROR')),
  60000,
);
cleanup.unref();
const server = app.listen(config.PORT, config.HOST, () =>
  console.log(`Xentinel API escuchando en ${config.HOST}:${config.PORT}`),
);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  stopMail();
  clearInterval(cleanup);
  closeStreams();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => {
    server.closeAllConnections();
    process.exit(1);
  }, 15000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
