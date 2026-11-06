import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createPool } from '../src/db.js';
import { migrarFastApi } from './servidor-fastapi.js';

test(
  'el dump original migra conservando usuarios, ingresos y relaciones',
  { skip: !process.env.ORIGINAL_DUMP_PATH },
  async () => {
    if (!process.env.TEST_DATABASE_URL) throw new Error('Falta TEST_DATABASE_URL');
    const root = createPool(process.env.TEST_DATABASE_URL),
      name = `xentinel_dump_test_${process.pid}_${Date.now()}`;
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.pathname = `/${name}`;
    let pool;
    try {
      await root.query(`CREATE DATABASE "${name}"`);
      pool = createPool(url.toString());
      // Se omite únicamente la propiedad de objetos de otro cluster. Los datos y DDL se importan intactos.
      const dump = (await readFile(process.env.ORIGINAL_DUMP_PATH, 'utf8')).replace(
        /^ALTER (?:TABLE|SEQUENCE).* OWNER TO postgres;\r?\n/gm,
        '',
      );
      const imported = spawnSync(
        process.env.PSQL_PATH || 'psql',
        ['-X', '-v', 'ON_ERROR_STOP=1', '-d', url.toString(), '-f', '-'],
        { input: dump, encoding: 'utf8', windowsHide: true },
      );
      assert.equal(imported.status, 0, `Falló la restauración: ${imported.stderr}`);
      const counts = async () => {
        const { rows } = await pool.query(
          'SELECT (SELECT count(*) FROM usuarios) usuarios,(SELECT count(*) FROM acceso) accesos,(SELECT count(*) FROM aprendiz_ficha) relaciones',
        );
        return rows[0];
      };
      const previous = await counts();
      await migrarFastApi(url.toString());
      assert.deepEqual(await counts(), previous);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int n FROM usuarios WHERE contrasena !~ '^\\$2[aby]\\$' AND NOT requiere_restablecimiento",
          )
        ).rows[0].n,
        0,
      );
      const constraints = await pool.query(
        "SELECT count(*)::int n FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace",
      );
      assert.ok(constraints.rows[0].n >= 30);
    } finally {
      await pool?.end();
      await root.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await root.end();
    }
  },
);
