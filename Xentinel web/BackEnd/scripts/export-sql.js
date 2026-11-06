import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

let output = `-- XENTINEL: esquema completo y catálogos, sin datos personales ni credenciales.\n-- PostgreSQL 17+. Ejecutar una vez en una base vacía o sobre el dump original restaurado.\n-- Después usar npm run migrate para actualizaciones versionadas.\n-- Las horas históricas sin zona se interpretan como America/Bogota.\n-- Contraseñas antiguas sin hash quedan bloqueadas y requieren recuperación por correo.\n-- NO contiene TRUNCATE ni eliminación de ingresos/asistencias.\nBEGIN;\nSELECT pg_advisory_xact_lock(91734200);\nCREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());\n`;
for (const version of ['001_base', '002_security_realtime', '003_programas_admin']) {
  const sql = await readFile(new URL(`../sql/${version}.sql`, import.meta.url), 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  output += `\n-- ${version}\n${sql}\nINSERT INTO schema_migrations(version,checksum) VALUES('${version}','${checksum}');\n`;
}
output += '\nCOMMIT;\n';
const target = process.argv[2]
  ? path.resolve(process.argv[2])
  : new URL('../sql/Xentinel_completo.sql', import.meta.url);
await writeFile(target, output, 'utf8');
console.log('SQL independiente generado');
