/** El catálogo conserva las relaciones históricas; las escrituras anidadas son atómicas. */
import { z } from 'zod';
import { isAdmin, roleName } from '../auth.js';
import { transaction } from '../db.js';
import { HttpError, id, pagination, ok } from '../http.js';

const texto = (maximo) => z.string().trim().min(1).max(maximo);
const hora = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/, 'Hora inválida');
const dias = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const horario = z
  .object({
    id_horario: id.optional(),
    nombre_clase: texto(150),
    dia_semana: z.enum(dias),
    hora_inicio: hora,
    hora_fin: hora,
    ambiente: texto(50).nullable(),
    id_instructor: id,
  })
  .strict()
  .refine((dato) => dato.hora_fin.padEnd(8, ':00') > dato.hora_inicio.padEnd(8, ':00'), {
    path: ['hora_fin'],
    message: 'La hora de fin debe ser posterior a la de inicio',
  });
const ficha = z
  .object({
    id_ficha: id.optional(),
    numero_ficha: texto(15),
    horarios: z.array(horario).max(150),
  })
  .strict();
const programa = z
  .object({
    nombre_programa: texto(150),
    nivel_programa: texto(50).nullable(),
    fichas: z.array(ficha).max(100),
  })
  .strict();
const creacion = programa.refine(
  (dato) =>
    dato.fichas.length > 0 &&
    dato.fichas.every(
      (grupo) =>
        !grupo.id_ficha &&
        grupo.horarios.length > 0 &&
        grupo.horarios.every((clase) => !clase.id_horario && clase.ambiente),
    ),
  { path: ['fichas'], message: 'Agregue al menos una ficha nueva con horario y entorno' },
);
const actualizacion = z.union([programa, z.object({ activo: z.boolean() }).strict()]);
const filtroActivo = z
  .enum(['true', 'false'])
  .transform((valor) => valor === 'true')
  .optional();
const ausente = () => new HttpError(404, 'NOT_FOUND', 'Programa no encontrado');
const relacionInvalida = () =>
  new HttpError(409, 'REFERENCE_CONFLICT', 'La ficha o el horario no pertenece al programa');

async function detalle(db, identificador) {
  const {
    rows: [fila],
  } = await db.query(
    `SELECT p.*, COALESCE((
      SELECT jsonb_agg(to_jsonb(f) || jsonb_build_object('horarios', COALESCE((
        SELECT jsonb_agg(to_jsonb(h) || jsonb_build_object('instructor', u.nombres_completos)
          ORDER BY h.id_horario)
        FROM horarios h JOIN usuarios u ON u.id_usuarios=h.id_instructor
        WHERE h.id_ficha=f.id_ficha
      ), '[]'::jsonb)) ORDER BY f.id_ficha)
      FROM ficha f WHERE f.id_programa=p.id_programa
    ), '[]'::jsonb) AS fichas FROM programa p WHERE p.id_programa=$1`,
    [identificador],
  );
  if (!fila) throw ausente();
  return fila;
}

/** Nunca mueve ni borra fichas u horarios ya registrados. */
async function guardarFichas(db, identificador, fichas) {
  const vistos = new Set();
  const horariosVistos = new Set();
  const instructores = new Map();
  for (const ficha of fichas) {
    let identificadorFicha = ficha.id_ficha;
    if (identificadorFicha) {
      if (vistos.has(identificadorFicha)) throw relacionInvalida();
      vistos.add(identificadorFicha);
      const { rowCount } = await db.query(
        'UPDATE ficha SET numero_ficha=$3 WHERE id_ficha=$1 AND id_programa=$2',
        [identificadorFicha, identificador, ficha.numero_ficha],
      );
      if (!rowCount) throw relacionInvalida();
    } else {
      if (!ficha.horarios.length)
        throw new HttpError(422, 'INVALID_DATA', 'La ficha nueva requiere un horario');
      const {
        rows: [creada],
      } = await db.query('INSERT INTO ficha(numero_ficha,id_programa) VALUES($1,$2) RETURNING id_ficha', [
        ficha.numero_ficha,
        identificador,
      ]);
      identificadorFicha = creada.id_ficha;
    }
    for (const horario of ficha.horarios) {
      if (!horario.id_horario && !horario.ambiente) {
        throw new HttpError(422, 'INVALID_DATA', 'El horario nuevo requiere un entorno');
      }
      const parametros = [
        horario.nombre_clase,
        horario.dia_semana,
        horario.hora_inicio,
        horario.hora_fin,
        horario.ambiente,
        horario.id_instructor,
        identificadorFicha,
      ];
      if (horario.id_horario) {
        if (horariosVistos.has(horario.id_horario)) throw relacionInvalida();
        horariosVistos.add(horario.id_horario);
        const {
          rows: [anterior],
        } = await db.query(
          'SELECT id_instructor FROM horarios WHERE id_horario=$1 AND id_ficha=$2 FOR UPDATE',
          [horario.id_horario, identificadorFicha],
        );
        if (!anterior) throw relacionInvalida();
        if (anterior.id_instructor !== horario.id_instructor)
          await comprobarInstructor(db, horario.id_instructor, instructores);
        await db.query(
          `UPDATE horarios SET nombre_clase=$1,dia_semana=$2,hora_inicio=$3,hora_fin=$4,
          ambiente=$5,id_instructor=$6 WHERE id_ficha=$7 AND id_horario=$8`,
          [...parametros, horario.id_horario],
        );
      } else {
        await comprobarInstructor(db, horario.id_instructor, instructores);
        await db.query(
          `INSERT INTO horarios(nombre_clase,dia_semana,hora_inicio,hora_fin,ambiente,id_instructor,id_ficha)
          VALUES($1,$2,$3,$4,$5,$6,$7)`,
          parametros,
        );
      }
    }
  }
}

async function comprobarInstructor(db, identificador, instructores) {
  if (instructores.has(identificador)) return;
  const {
    rows: [persona],
  } = await db.query(
    `SELECT u.estado,r.nombre_rol FROM usuarios u JOIN rol r USING(id_rol)
    WHERE u.id_usuarios=$1 FOR SHARE OF u`,
    [identificador],
  );
  if (!persona || roleName(persona) !== 'instructor' || persona.estado?.toLowerCase() !== 'activo') {
    throw new HttpError(422, 'INVALID_INSTRUCTOR', 'El horario requiere un instructor activo');
  }
  instructores.set(identificador, true);
}

export function controladorProgramas(pool) {
  return {
    instructores: async (_req, res) => {
      const { rows } = await pool.query(
        `SELECT u.id_usuarios, u.nombres_completos FROM usuarios u JOIN rol r USING(id_rol)
        WHERE lower(u.estado)='activo' AND lower(r.nombre_rol)='instructor'
        ORDER BY u.nombres_completos, u.id_usuarios`,
      );
      ok(res, rows);
    },
    listar: async (req, res) => {
      const p = pagination.extend({ activo: filtroActivo }).parse(req.query);
      const activo = isAdmin(req.user) ? (p.activo ?? null) : true;
      const { rows } = await pool.query(
        'SELECT * FROM programa WHERE ($1::boolean IS NULL OR activo=$1) ORDER BY id_programa LIMIT $2 OFFSET $3',
        [activo, p.limit, p.offset],
      );
      ok(res, rows, 200, p);
    },
    detalle: async (req, res) => ok(res, await detalle(pool, id.parse(req.params.id))),
    crear: async (req, res) => {
      const datos = creacion.parse(req.body);
      const resultado = await transaction(pool, async (db) => {
        const {
          rows: [creado],
        } = await db.query(
          'INSERT INTO programa(nombre_programa,nivel_programa) VALUES($1,$2) RETURNING id_programa',
          [datos.nombre_programa, datos.nivel_programa],
        );
        await guardarFichas(db, creado.id_programa, datos.fichas);
        return detalle(db, creado.id_programa);
      });
      ok(res, resultado, 201);
    },
    actualizar: async (req, res) => {
      const identificador = id.parse(req.params.id);
      const datos = actualizacion.parse(req.body);
      const resultado = await transaction(pool, async (db) => {
        if ('activo' in datos) {
          const {
            rows: [fila],
          } = await db.query('UPDATE programa SET activo=$2 WHERE id_programa=$1 RETURNING *', [
            identificador,
            datos.activo,
          ]);
          if (!fila) throw ausente();
          return fila;
        }
        const { rowCount } = await db.query(
          'UPDATE programa SET nombre_programa=$2,nivel_programa=$3 WHERE id_programa=$1',
          [identificador, datos.nombre_programa, datos.nivel_programa],
        );
        if (!rowCount) throw ausente();
        await guardarFichas(db, identificador, datos.fichas);
        return detalle(db, identificador);
      });
      ok(res, resultado);
    },
  };
}
