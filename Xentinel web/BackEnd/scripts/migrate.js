import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createPool, transaction } from '../src/db.js';

export async function migrate(pool) {
  await transaction(pool, async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(91734200)');
    await db.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    for (const version of ['001_base', '002_security_realtime', '003_programas_admin', '004_perfil_asistencia', '005_rls_correo_opcional', '006_codigos_sismos', '007_alarmas_asistencia_correo', '008_asistencia_general_fichas']) {
      const sql = await readFile(new URL(`../sql/${version}.sql`, import.meta.url), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const {
        rows: [previous],
      } = await db.query('SELECT checksum FROM schema_migrations WHERE version=$1', [version]);
      if (previous) {
        if (previous.checksum !== checksum)
          throw new Error(`La migración ${version} cambió después de aplicarse`);
        continue;
      }
      await db.query(sql);
      await db.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)', [version, checksum]);
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL');
  const pool = createPool(process.env.DATABASE_URL);
  try {
    await migrate(pool);
    console.log('Migraciones verificadas y aplicadas');
  } finally {
    await pool.end();
  }
}
