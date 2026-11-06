import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { requestId, errorHandler, HttpError, rateLimit } from './http.js';
import { apiRoutes, legacyRoutes } from './routes/api.js';
import { eventStream } from './services/events.js';
import { assertSchema } from './db.js';
import { fileURLToPath } from 'node:url';

export function createApp(pool, config, options = {}) {
  const app = express(),
    stream = eventStream(pool, options);
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY_HOPS);
  app.use(
    requestId,
    helmet({
      contentSecurityPolicy: {
        directives: { 'upgrade-insecure-requests': config.NODE_ENV === 'production' ? [] : null },
      },
    }),
  );
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.origins.includes(origin)) return callback(null, true);
        callback(new HttpError(403, 'CORS_DENIED', 'Origen no autorizado'));
      },
      credentials: false,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Last-Event-ID'],
      exposedHeaders: ['X-Request-ID', 'Retry-After'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '64kb' }));
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(
    '/recuperacion',
    express.static(fileURLToPath(new URL('../public', import.meta.url)), { index: false }),
  );
  app.get('/restablecer-contrasena', (_req, res) =>
    res.sendFile(fileURLToPath(new URL('../public/reset-password.html', import.meta.url))),
  );
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/ready', async (_req, res) => {
    await assertSchema(pool);
    res.json({ status: 'ready' });
  });
  app.use(rateLimit(pool, 'api', 600, 60));
  app.use('/api/v1', apiRoutes(pool, config, stream));
  app.use(legacyRoutes(pool, config));
  app.use((_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Ruta no encontrada')));
  app.use(errorHandler);
  return { app, closeStreams: stream.close };
}
