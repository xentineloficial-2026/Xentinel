import { randomUUID, createHash } from 'node:crypto';
import { ZodError, z } from 'zod';
export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const id = z.coerce.number().int().positive().max(2147483647);
export const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
export const ok = (res, data, status = 200, meta) =>
  res.status(status).json({ data, ...(meta ? { meta } : {}) });
export function requestId(req, res, next) {
  req.requestId = randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
}
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  let status = error.status || 500,
    code = error.code || 'INTERNAL_ERROR',
    message = error.message;
  if (error instanceof ZodError) {
    status = 422;
    code = 'VALIDATION_ERROR';
    message = 'Datos inválidos';
  }
  if (error.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'JSON inválido';
  }
  if (error.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Solicitud demasiado grande';
  }
  if (error.code === '23505') {
    status = 409;
    code = 'CONFLICT';
    message = 'El registro ya existe';
  }
  if (error.code === '23503') {
    status = 409;
    code = 'REFERENCE_CONFLICT';
    message = 'Referencia inexistente o registro en uso';
  }
  if (['23514', '23502', '22007', '22008', '22P02'].includes(error.code)) {
    status = 422;
    code = 'INVALID_DATA';
    message = 'Datos incompatibles con las restricciones';
  }
  if (['40001', '40P01'].includes(error.code)) {
    status = 409;
    code = 'RETRY_TRANSACTION';
    message = 'Conflicto concurrente, reintente la operación';
  }
  if (status >= 500) {
    console.error(JSON.stringify({ requestId: req.requestId, code: error.code || 'INTERNAL_ERROR' }));
    code = 'INTERNAL_ERROR';
    message = 'No se pudo completar la solicitud';
  }
  res.status(status).json({
    error: {
      code,
      message,
      request_id: req.requestId,
      ...(error instanceof ZodError
        ? { fields: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }
        : {}),
    },
    detail: message,
  });
}
// Contador compartido entre procesos; no depende de memoria local ni confía en cabeceras arbitrarias.
export function rateLimit(pool, name, maximum, seconds) {
  return async (req, res, next) => {
    const key = createHash('sha256').update(`${name}:${req.ip}`).digest('hex');
    const {
      rows: [row],
    } = await pool.query(
      `INSERT INTO api_rate_limits (key, hits, expires_at)
      VALUES ($1,1,now()+make_interval(secs=>$2)) ON CONFLICT (key) DO UPDATE SET
      hits=CASE WHEN api_rate_limits.expires_at<=now() THEN 1 ELSE api_rate_limits.hits+1 END,
      expires_at=CASE WHEN api_rate_limits.expires_at<=now() THEN now()+make_interval(secs=>$2) ELSE api_rate_limits.expires_at END
      RETURNING hits`,
      [key, seconds],
    );
    if (row.hits > maximum) {
      res.setHeader('Retry-After', seconds);
      throw new HttpError(429, 'RATE_LIMIT', 'Demasiadas solicitudes; intente más tarde');
    }
    next();
  };
}
