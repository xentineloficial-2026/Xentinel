/** Consultas administrativas completas, con cursor y un límite superior fijo durante la descarga. */
import { z } from 'zod';
import { HttpError, pagination, ok } from '../http.js';

const cursor = z.coerce.number().int().min(0).max(2147483647);
const esquema = pagination.pick({ limit: true }).extend({
  despues: cursor.default(0),
  hasta: cursor.optional(),
});
const diario = esquema.extend({ fecha: z.iso.date() });

async function pagina(pool, res, parametros, sqlMaximo, sqlFilas, valores, clave) {
  const hasta = parametros.hasta ?? (await pool.query(sqlMaximo, valores)).rows[0].hasta;
  if (parametros.despues > hasta) throw new HttpError(422, 'INVALID_CURSOR', 'Cursor inválido');
  const { rows } = await pool.query(sqlFilas, [...valores, parametros.despues, hasta, parametros.limit + 1]);
  const datos = rows.slice(0, parametros.limit);
  ok(res, datos, 200, { hasta, siguiente: rows.length > datos.length ? datos.at(-1)[clave] : null });
}

export function controladorReportes(pool) {
  const rango = `fechahora >= ($1::date::timestamp AT TIME ZONE 'America/Bogota')
    AND fechahora < (($1::date + 1)::timestamp AT TIME ZONE 'America/Bogota')`;
  return {
    accesos: async (req, res) =>
      pagina(
        pool,
        res,
        diario.parse(req.query),
        `SELECT COALESCE(max(id_acceso),0) hasta FROM acceso WHERE ${rango}`,
        `SELECT id_acceso,id_usuarios,tipo,fechahora,metodo,estado FROM acceso WHERE ${rango}
      AND id_acceso>$2 AND id_acceso<=$3 ORDER BY id_acceso LIMIT $4`,
        [req.query.fecha],
        'id_acceso',
      ),
    horarios: async (req, res) =>
      pagina(
        pool,
        res,
        esquema.parse(req.query),
        'SELECT COALESCE(max(id_horario),0) hasta FROM horarios',
        `SELECT h.*, f.numero_ficha, p.nombre_programa, u.nombres_completos AS instructor
      FROM horarios h JOIN ficha f USING(id_ficha) JOIN programa p USING(id_programa)
      JOIN usuarios u ON u.id_usuarios=h.id_instructor
      WHERE h.id_horario>$1 AND h.id_horario<=$2 ORDER BY h.id_horario LIMIT $3`,
        [],
        'id_horario',
      ),
  };
}
