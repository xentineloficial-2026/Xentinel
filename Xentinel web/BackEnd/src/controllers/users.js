import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { HttpError, id, pagination, ok } from '../http.js';
import { registration } from './auth.js';
import { userColumns, userById, publicUser } from '../models/users.js';
import { ownOrAdmin, isAdmin } from '../auth.js';
import { transaction } from '../db.js';

export function usersController(pool) {
  return {
    list: async (req, res) => {
      const p = pagination
        .extend({
          id_rol: id.optional(),
          estado: z.enum(['Activo', 'Inactivo']).optional(),
        })
        .parse(req.query);
      const [listado, conteo] = await Promise.all([
        pool.query(
          `SELECT ${userColumns} FROM usuarios u JOIN rol r USING(id_rol)
          WHERE ($1::integer IS NULL OR u.id_rol=$1) AND ($4::text IS NULL OR lower(u.estado)=lower($4))
          ORDER BY u.id_usuarios LIMIT $2 OFFSET $3`,
          [p.id_rol || null, p.limit, p.offset, p.estado ?? null],
        ),
        p.estado
          ? pool.query(
              `SELECT count(*) FILTER (WHERE lower(estado)='activo')::int activos,
          count(*) FILTER (WHERE lower(estado)='inactivo')::int inactivos
          FROM usuarios WHERE ($1::integer IS NULL OR id_rol=$1)`,
              [p.id_rol || null],
            )
          : null,
      ]);
      ok(res, listado.rows.map(publicUser), 200, {
        ...p,
        ...(conteo && { totales: conteo.rows[0] }),
      });
    },
    get: async (req, res) => {
      const target = id.parse(req.params.id);
      ownOrAdmin(req, target);
      const user = await userById(pool, target);
      if (!user) throw new HttpError(404, 'NOT_FOUND', 'Usuario no encontrado');
      ok(res, publicUser(user));
    },
    create: async (req, res) => {
      const data = registration.extend({ id_rol: id }).parse(req.body);
      const hash = await bcrypt.hash(data.contrasena, 12);
      const {
        rows: [created],
      } = await pool.query(
        `INSERT INTO usuarios(nombres_completos,tipo_documento,numero_documento,correo,contrasena,telefono,fecha_nacimiento,id_rol)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id_usuarios`,
        [
          data.nombres_completos,
          data.tipo_documento,
          data.numero_documento,
          data.correo,
          hash,
          data.telefono || null,
          data.fecha_nacimiento || null,
          data.id_rol,
        ],
      );
      ok(res, publicUser(await userById(pool, created.id_usuarios)), 201);
    },
    update: async (req, res) => {
      const target = id.parse(req.params.id);
      ownOrAdmin(req, target);
      const base = registration
        .omit({ contrasena: true, correo: true, numero_documento: true, tipo_documento: true })
        .partial();
      // El correo de recuperación sólo lo cambia un administrador; evita secuestro de cuenta desde una sesión robada.
      const schema = isAdmin(req.user)
        ? registration
            .omit({ contrasena: true })
            .extend({ id_rol: id, estado: z.enum(['Activo', 'Inactivo']) })
            .partial()
        : base;
      const data = schema
        .strict()
        .refine((v) => Object.keys(v).length > 0, 'Debe enviar algún campo')
        .parse(req.body);
      const fields = Object.keys(data),
        values = Object.values(data);
      await transaction(pool, async (db) => {
        const { rows } = await db.query(
          `UPDATE usuarios SET ${fields.map((f, i) => `"${f}"=$${i + 1}`).join(',')} WHERE id_usuarios=$${values.length + 1} RETURNING id_usuarios`,
          [...values, target],
        );
        if (!rows.length) throw new HttpError(404, 'NOT_FOUND', 'Usuario no encontrado');
        if (data.correo !== undefined || data.estado !== undefined)
          await db.query(
            'UPDATE password_reset_tokens SET usado_en=now() WHERE id_usuarios=$1 AND usado_en IS NULL',
            [target],
          );
      });
      ok(res, publicUser(await userById(pool, target)));
    },
    deactivate: async (req, res) => {
      const target = id.parse(req.params.id);
      if (target === req.user.id_usuarios)
        throw new HttpError(409, 'SELF_DEACTIVATION', 'No puede desactivar su propia cuenta');
      const { rowCount } = await pool.query(
        "UPDATE usuarios SET estado='Inactivo',auth_version=auth_version+1 WHERE id_usuarios=$1",
        [target],
      );
      if (!rowCount) throw new HttpError(404, 'NOT_FOUND', 'Usuario no encontrado');
      res.status(204).end();
    },
  };
}
