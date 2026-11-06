import { HttpError } from '../http.js';
import { userById } from '../models/users.js';
import { isAdmin, roleName } from '../auth.js';

const publicResources = new Set(['alertas_emergencia', 'ficha', 'programa', 'rol', 'jornada', 'horarios']);
export function visibleEvent(event, user) {
  if (isAdmin(user)) return true;
  if (publicResources.has(event.recurso)) return true;
  if (event.recurso === 'acceso' && roleName(user) === 'celador') return true;
  return event.propietario_id === user.id_usuarios;
}
export function eventStream(pool, { pollMs = 1000, heartbeatMs = 15000 } = {}) {
  const clients = new Set();
  const handler = async (req, res) => {
    const raw = req.get('Last-Event-ID') ?? req.query.after ?? '0';
    if (typeof raw !== 'string' || !/^\d{1,18}$/.test(raw))
      throw new HttpError(422, 'INVALID_CURSOR', 'Cursor de eventos inválido');
    const count = [...clients].filter((c) => c.userId === req.user.id_usuarios).length;
    if (count >= 5 || clients.size >= 500)
      throw new HttpError(429, 'STREAM_LIMIT', 'Límite de conexiones simultáneas');
    const {
      rows: [max],
    } = await pool.query('SELECT coalesce(max(id_evento),0)::text last FROM api_events');
    if (BigInt(raw) > BigInt(max.last))
      throw new HttpError(409, 'INVALID_CURSOR', 'Cursor posterior al último evento; vuelva a sincronizar');
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 2000\n\n');
    let cursor = raw,
      busy = false,
      closed = false,
      lastBeat = 0;
    const client = { userId: req.user.id_usuarios, close: () => res.end() };
    clients.add(client);
    const cleanup = () => {
      closed = true;
      clearInterval(timer);
      clients.delete(client);
    };
    const write = (event, data, eventId) => {
      if (res.writableLength > 128 * 1024) {
        res.end();
        return false;
      }
      res.write(`${eventId ? `id: ${eventId}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      return true;
    };
    const poll = async () => {
      if (busy || closed) return;
      busy = true;
      try {
        // Cada lote vuelve a comprobar caducidad, estado y revocación de la sesión.
        const user = await userById(pool, req.user.id_usuarios);
        if (
          !user ||
          user.estado?.toLowerCase() !== 'activo' ||
          user.auth_version !== req.claims.ver ||
          Date.now() >= req.claims.exp * 1000
        ) {
          write('auth-expired', {});
          res.end();
          return;
        }
        const { rows } = await pool.query(
          'SELECT id_evento::text,recurso,operacion,registro_id,propietario_id,creado_en FROM api_events WHERE id_evento>$1 ORDER BY id_evento LIMIT 200',
          [cursor],
        );
        if (closed) return;
        for (const event of rows) {
          if (visibleEvent(event, user)) {
            const { propietario_id, ...safe } = event;
            if (!write('change', safe, event.id_evento)) return;
          }
          cursor = event.id_evento;
        }
        if (rows.length || Date.now() - lastBeat >= heartbeatMs) {
          write('checkpoint', { cursor }, cursor);
          lastBeat = Date.now();
        }
      } catch {
        if (!closed) {
          write('retry', {});
          res.end();
        }
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(poll, pollMs);
    timer.unref();
    res.on('close', cleanup);
    await poll();
  };
  return {
    handler,
    close: () => {
      for (const client of clients) client.close();
    },
  };
}
