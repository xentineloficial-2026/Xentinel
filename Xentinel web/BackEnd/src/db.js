import pg from 'pg';
export function createPool(connectionString) {
  const pool = new pg.Pool({
    connectionString,
    max: 15,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    options: '-c timezone=UTC -c statement_timeout=10000',
  });
  pool.on('error', () => console.error('DATABASE_POOL_ERROR'));
  return pool;
}
export async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
export async function assertSchema(pool) {
  const { rows } = await pool.query(
    "SELECT version FROM schema_migrations WHERE version IN ('002_security_realtime', '003_programas_admin')",
  );
  if (rows.length !== 2) throw new Error('Ejecute npm run migrate antes de iniciar');
  await pool.query('SELECT auth_version, requiere_restablecimiento FROM usuarios LIMIT 0');
  await pool.query('SELECT token_expiracion FROM password_reset_tokens LIMIT 0');
  // Contrato explícito: los cambios DDL incompatibles fallan antes de aceptar tráfico.
  const expected = {
    usuarios: [
      'id_usuarios',
      'nombres_completos',
      'tipo_documento',
      'numero_documento',
      'contrasena',
      'correo',
      'telefono',
      'fecha_nacimiento',
      'id_rol',
      'estado',
      'foto_url',
      'foto_pos',
      'auth_version',
      'requiere_restablecimiento',
    ],
    acceso: [
      'id_acceso',
      'id_usuarios',
      'tipo',
      'fechahora',
      'metodo',
      'estado',
      'registrado_por',
      'request_id',
    ],
    alertas_emergencia: [
      'id_alerta',
      'tipo_alerta',
      'mensaje',
      'activa',
      'fecha_inicio',
      'fecha_fin',
      'emisor_id',
      'severidad',
      'fuente',
      'referencia_externa',
      'cerrada_por',
    ],
    api_events: ['id_evento', 'recurso', 'operacion', 'registro_id', 'propietario_id', 'creado_en'],
    reporte_estudiantes: ['id_reporte', 'id_usuarios', 'presente'],
    mail_outbox: [
      'id_mail',
      'id_token',
      'payload_encrypted',
      'intentos',
      'siguiente_intento',
      'enviado_en',
      'error_codigo',
    ],
  };
  for (const [table, columns] of Object.entries(expected))
    await pool.query(`SELECT ${columns.join(',')} FROM ${table} LIMIT 0`);
}
