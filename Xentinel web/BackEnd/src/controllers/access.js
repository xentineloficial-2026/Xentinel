import { z } from 'zod';
import { HttpError, id, pagination, ok } from '../http.js';
import { isAdmin, roleName } from '../auth.js';
import { transaction } from '../db.js';

export function accessController(pool) {
  return {
    list: async (req, res) => {
      const p = pagination.extend({ id_usuarios: id.optional() }).parse(req.query);
      const privileged = isAdmin(req.user) || roleName(req.user) === 'celador';
      const target = privileged ? p.id_usuarios || null : req.user.id_usuarios;
      const { rows } = await pool.query(
        'SELECT * FROM acceso WHERE ($1::integer IS NULL OR id_usuarios=$1) ORDER BY fechahora DESC,id_acceso DESC LIMIT $2 OFFSET $3',
        [target, p.limit, p.offset],
      );
      ok(res, rows, 200, { limit: p.limit, offset: p.offset });
    },
    create: async (req, res) => {
      const data = z
        .object({
          id_usuarios: id,
          tipo: z.enum(['ENTRADA', 'SALIDA']),
          metodo: z.enum(['Manual', 'QR']),
          request_id: z.uuid(),
        })
        .strict()
        .parse(req.body);
      const result = await transaction(pool, async (db) => {
        const {
          rows: [user],
        } = await db.query('SELECT estado FROM usuarios WHERE id_usuarios=$1 FOR UPDATE', [data.id_usuarios]);
        if (!user) throw new HttpError(404, 'NOT_FOUND', 'Usuario no encontrado');
        const {
          rows: [previous],
        } = await db.query('SELECT * FROM acceso WHERE request_id=$1', [data.request_id]);
        if (previous) {
          if (
            previous.id_usuarios !== data.id_usuarios ||
            previous.tipo !== data.tipo ||
            previous.metodo !== data.metodo ||
            previous.registrado_por !== req.user.id_usuarios
          )
            throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'request_id ya usado para otra operación');
          return { row: previous, created: false };
        }
        const state = user.estado?.toLowerCase() === 'activo' ? 'Permitido' : 'Denegado';
        if (state === 'Permitido') {
          const {
            rows: [last],
          } = await db.query(
            "SELECT tipo FROM acceso WHERE id_usuarios=$1 AND estado='Permitido' ORDER BY fechahora DESC,id_acceso DESC LIMIT 1",
            [data.id_usuarios],
          );
          if (last?.tipo === data.tipo || (!last && data.tipo === 'SALIDA'))
            throw new HttpError(
              409,
              'ACCESS_SEQUENCE',
              'Debe alternar ENTRADA y SALIDA; registre primero la entrada',
            );
        }
        const {
          rows: [row],
        } = await db.query(
          `INSERT INTO acceso(id_usuarios,tipo,metodo,estado,registrado_por,request_id)
          VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
          [data.id_usuarios, data.tipo, data.metodo, state, req.user.id_usuarios, data.request_id],
        );
        return { row, created: true };
      });
      ok(res, result.row, result.created ? 201 : 200);
    },
  };
}
