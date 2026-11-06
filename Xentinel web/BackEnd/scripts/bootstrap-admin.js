import bcrypt from 'bcryptjs';
import { createPool, transaction, assertSchema } from '../src/db.js';
import { registration } from '../src/controllers/auth.js';

// Credenciales por entorno, nunca argumentos ni valores fijos incluidos en el repositorio.
const data = registration.parse({
  nombres_completos: process.env.ADMIN_NAME,
  tipo_documento: 'CC',
  numero_documento: process.env.ADMIN_DOCUMENT,
  correo: process.env.ADMIN_EMAIL,
  contrasena: process.env.ADMIN_PASSWORD,
});
const pool = createPool(process.env.DATABASE_URL);
try {
  await assertSchema(pool);
  const hash = await bcrypt.hash(data.contrasena, 12);
  await transaction(pool, async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(91734202)');
    const { rows } = await db.query(
      "SELECT 1 FROM usuarios u JOIN rol r USING(id_rol) WHERE lower(r.nombre_rol)='administrador' AND lower(u.estado)='activo' AND NOT requiere_restablecimiento",
    );
    if (rows.length)
      throw new Error('Ya existe un administrador activo con contraseña válida; use la API autenticada');
    const {
      rows: [role],
    } = await db.query("SELECT id_rol FROM rol WHERE lower(nombre_rol)='administrador'");
    await db.query(
      `INSERT INTO usuarios(nombres_completos,tipo_documento,numero_documento,correo,contrasena,id_rol)
      VALUES($1,$2,$3,$4,$5,$6)`,
      [data.nombres_completos, data.tipo_documento, data.numero_documento, data.correo, hash, role.id_rol],
    );
  });
  console.log('Administrador inicial creado');
} finally {
  await pool.end();
}
