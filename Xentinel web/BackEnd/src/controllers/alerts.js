import { z } from 'zod';
import { HttpError, id, pagination, ok } from '../http.js';
import { isAdmin } from '../auth.js';
import { transaction } from '../db.js';

const alertSchema = z
  .object({
    tipo_alerta: z.enum(['Sismo', 'Meteorológica', 'Evacuación', 'Incendio', 'Simulacro', 'Otra']),
    mensaje: z.string().trim().min(5).max(5000),
    severidad: z.enum(['informativa', 'moderada', 'alta', 'critica']).default('alta'),
    fuente: z.string().trim().min(1).max(120).default('Operador SENA'),
    referencia_externa: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
async function activeAlert(db, target) {
  const {
    rows: [alert],
  } = await db.query('SELECT * FROM alertas_emergencia WHERE id_alerta=$1 FOR SHARE', [target]);
  if (!alert) throw new HttpError(404, 'NOT_FOUND', 'Alerta no encontrada');
  if (!alert.activa) throw new HttpError(409, 'ALERT_CLOSED', 'La alerta está cerrada');
  return alert;
}
export function alertsController(pool) {
  return {
    list: async (req, res) => {
      const p = pagination.extend({ activa: z.enum(['true', 'false']).optional() }).parse(req.query);
      const { rows } = await pool.query(
        'SELECT * FROM alertas_emergencia WHERE ($1::boolean IS NULL OR activa=$1) ORDER BY id_alerta DESC LIMIT $2 OFFSET $3',
        [p.activa ?? null, p.limit, p.offset],
      );
      ok(res, rows, 200, p);
    },
    get: async (req, res) => {
      const {
        rows: [row],
      } = await pool.query('SELECT * FROM alertas_emergencia WHERE id_alerta=$1', [id.parse(req.params.id)]);
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Alerta no encontrada');
      ok(res, row);
    },
    current: async (req, res) => {
      const { rows } = await pool.query(
        'SELECT * FROM alertas_emergencia WHERE activa ORDER BY id_alerta DESC',
      );
      if (req.legacy) return res.json(rows[0] || { activa: false });
      ok(res, rows);
    },
    create: async (req, res) => {
      const data = alertSchema.parse(req.body);
      const {
        rows: [row],
      } = await pool.query(
        `INSERT INTO alertas_emergencia(tipo_alerta,mensaje,severidad,fuente,referencia_externa,emisor_id)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
        [
          data.tipo_alerta,
          data.mensaje,
          data.severidad,
          data.fuente,
          data.referencia_externa || null,
          req.user.id_usuarios,
        ],
      );
      ok(res, row, 201);
    },
    close: async (req, res) => {
      const target = id.parse(req.params.id);
      const row = await transaction(pool, async (db) => {
        const {
          rows: [existing],
        } = await db.query('SELECT * FROM alertas_emergencia WHERE id_alerta=$1 FOR UPDATE', [target]);
        if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Alerta no encontrada');
        if (!existing.activa) return existing;
        const {
          rows: [updated],
        } = await db.query(
          'UPDATE alertas_emergencia SET activa=false,fecha_fin=now(),cerrada_por=$2 WHERE id_alerta=$1 RETURNING *',
          [target, req.user.id_usuarios],
        );
        return updated;
      });
      ok(res, row);
    },
    sos: async (req, res) => {
      const data = z
        .object({
          id_alerta: id,
          latitud: z.number().min(-90).max(90),
          longitud: z.number().min(-180).max(180),
        })
        .strict()
        .parse(req.body);
      const row = await transaction(pool, async (db) => {
        await activeAlert(db, data.id_alerta);
        const {
          rows: [created],
        } = await db.query(
          'INSERT INTO ubicaciones_sos(id_alerta,id_aprendiz,latitud,longitud) VALUES($1,$2,$3,$4) RETURNING *',
          [data.id_alerta, req.user.id_usuarios, data.latitud, data.longitud],
        );
        return created;
      });
      ok(res, row, 201);
    },
    listSos: async (req, res) => {
      const p = pagination.parse(req.query);
      const { rows } = await pool.query(
        'SELECT * FROM ubicaciones_sos WHERE id_alerta=$1 ORDER BY id_sos DESC LIMIT $2 OFFSET $3',
        [id.parse(req.params.id), p.limit, p.offset],
      );
      ok(res, rows, 200, p);
    },
    report: async (req, res) => {
      const data = z
        .object({
          id_alerta: id,
          id_ficha: id,
          observaciones: z.string().max(5000).optional(),
          estudiantes: z
            .array(z.object({ id_usuarios: id, presente: z.boolean() }).strict())
            .min(1)
            .max(500)
            .refine((v) => new Set(v.map((s) => s.id_usuarios)).size === v.length, 'Estudiantes repetidos'),
        })
        .strict()
        .parse(req.body);
      const row = await transaction(pool, async (db) => {
        await activeAlert(db, data.id_alerta);
        if (!isAdmin(req.user)) {
          const { rows } = await db.query(
            "SELECT 1 FROM instructor_ficha WHERE id_usuarios=$1 AND id_ficha=$2 AND lower(estado)='activo'",
            [req.user.id_usuarios, data.id_ficha],
          );
          if (!rows.length) throw new HttpError(403, 'FORBIDDEN', 'No está asignado a esta ficha');
        }
        const ids = data.estudiantes.map((s) => s.id_usuarios);
        const { rows: members } = await db.query(
          `SELECT DISTINCT id_usuarios FROM aprendiz_ficha WHERE id_ficha=$1 AND id_usuarios=ANY($2::integer[])
          AND lower(estado) NOT IN ('inactivo','retirado','finalizado','cancelado','desertado') AND fechasalida IS NULL`,
          [data.id_ficha, ids],
        );
        if (members.length !== ids.length)
          throw new HttpError(422, 'INVALID_MEMBERSHIP', 'Hay estudiantes que no pertenecen a la ficha');
        const {
          rows: [report],
        } = await db.query(
          `INSERT INTO reportes_pase_lista(id_alerta,id_instructor,id_ficha,observaciones,estudiantes_presentes)
          VALUES($1,$2,$3,$4,'[]') RETURNING id_reporte,id_alerta,id_instructor,id_ficha,observaciones,fecha_envio`,
          [data.id_alerta, req.user.id_usuarios, data.id_ficha, data.observaciones || null],
        );
        await db.query(
          'INSERT INTO reporte_estudiantes(id_reporte,id_usuarios,presente) SELECT $1,* FROM unnest($2::integer[],$3::boolean[])',
          [report.id_reporte, ids, data.estudiantes.map((s) => s.presente)],
        );
        return { ...report, estudiantes: data.estudiantes };
      });
      ok(res, row, 201);
    },
    reports: async (req, res) => {
      const p = pagination.parse(req.query);
      const { rows } = await pool.query(
        `SELECT r.id_reporte,r.id_alerta,r.id_instructor,r.id_ficha,r.observaciones,r.fecha_envio,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id_usuarios',e.id_usuarios,'presente',e.presente)) FROM reporte_estudiantes e WHERE e.id_reporte=r.id_reporte),'[]'::jsonb) estudiantes
        FROM reportes_pase_lista r WHERE id_alerta=$1 AND ($2::integer IS NULL OR id_instructor=$2) ORDER BY id_reporte DESC LIMIT $3 OFFSET $4`,
        [id.parse(req.params.id), isAdmin(req.user) ? null : req.user.id_usuarios, p.limit, p.offset],
      );
      ok(res, rows, 200, p);
    },
  };
}
