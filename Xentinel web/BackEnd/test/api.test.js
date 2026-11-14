import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createPool } from '../src/db.js';
import { migrate } from '../scripts/migrate.js';
import { iniciarFastApi, migrarFastApi, recogerCorreoFastApi } from './servidor-fastapi.js';
import { readConfig } from '../src/config.js';
import { encryptMail } from '../src/services/mail.js';

// Sólo un cluster desechable explícitamente indicado. Nunca se usa DATABASE_URL.
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error('Falta TEST_DATABASE_URL apuntando a PostgreSQL de prueba');
const name = `xentinel_test_${process.pid}_${Date.now()}`;
let root,
  pool,
  servicio,
  base,
  config,
  adminToken,
  studentToken,
  guardToken,
  otherToken,
  studentId,
  otherId,
  adminId,
  alertId;
const password = 'Pruebas-Xentinel-2026!';
async function request(path, { method = 'GET', token, body, headers = {} } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.status === 204 ? null : await res.json();
  return { status: res.status, body: data, headers: res.headers };
}
const api = (path, opts) => request(`/api/v1${path}`, opts);
before(async () => {
  root = createPool(testUrl);
  await root.query(`CREATE DATABASE "${name}"`);
  const url = new URL(testUrl);
  url.pathname = `/${name}`;
  pool = createPool(url.toString());
  await migrarFastApi(url.toString());
  config = readConfig({
    NODE_ENV: 'test',
    DATABASE_URL: url.toString(),
    JWT_SECRET: randomBytes(32).toString('hex'),
    MAIL_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    WEB_ORIGINS: 'http://localhost:5173',
    RESET_PASSWORD_URL: 'http://localhost:8000/restablecer-contrasena',
  });
  const hash = await bcrypt.hash(password, 12);
  for (const [document, role, email, name] of [
    ['10001', 'Administrador', 'admin@test.example', 'María José Pérez'],
    ['10002', 'Aprendiz', 'student@test.example', 'Kevin Santiago Gómez'],
    ['10003', 'Celador', 'guard@test.example', 'Andrés García'],
    ['10004', 'Aprendiz', 'other@test.example', 'Laura Ríos'],
  ]) {
    await pool.query(
      `INSERT INTO usuarios(nombres_completos,tipo_documento,numero_documento,correo,contrasena,id_rol)
      SELECT $5,'CC',$1,$2,$3,id_rol FROM rol WHERE nombre_rol=$4`,
      [document, email, hash, role, name],
    );
  }
  servicio = await iniciarFastApi(config);
  base = servicio.base;
  const logins = [];
  for (const document of ['10001', '10002', '10003', '10004']) {
    const response = await api('/auth/login', {
      method: 'POST',
      body: { documento: document, contrasena: password },
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    logins.push(response.body.data);
  }
  [adminToken, studentToken, guardToken, otherToken] = logins.map((l) => l.access_token);
  [adminId, studentId, , otherId] = logins.map((l) => l.usuario.id_usuarios);
});
after(async () => {
  await servicio?.cerrar();
  await pool?.end();
  if (root) {
    await root.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await root.end();
  }
});

test('migraciones repetibles y esquema esperado', async () => {
  // El migrador anterior verifica que FastAPI conserva los checksums existentes.
  await migrate(pool);
  await migrarFastApi(config.DATABASE_URL);
  assert.equal((await pool.query('SELECT count(*)::int n FROM schema_migrations')).rows[0].n, 5);
  const result = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='password_reset_tokens'",
  );
  assert.ok(result.rows.some((c) => c.column_name === 'token_expiracion'));
  const usuarios = await pool.query(
    `SELECT column_name, is_nullable, column_default FROM information_schema.columns
    WHERE table_name='usuarios' AND column_name IN ('correo','id_rol') ORDER BY column_name`,
  );
  assert.deepEqual(usuarios.rows, [
    { column_name: 'correo', is_nullable: 'YES', column_default: null },
    { column_name: 'id_rol', is_nullable: 'NO', column_default: null },
  ]);
  const sinRls = await pool.query(
    "SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND NOT relrowsecurity",
  );
  assert.deepEqual(sinRls.rows, []);
});
test('Swagger, disponibilidad y login heredado mantienen sus contratos', async () => {
  assert.deepEqual((await request('/health')).body, { status: 'ok' });
  assert.deepEqual((await request('/ready')).body, { status: 'ready' });
  const esquema = (await request('/openapi.json')).body;
  assert.ok(esquema.paths['/api/v1/programas/{id}'].patch);
  assert.ok(esquema.components.securitySchemes.HTTPBearer);
  assert.equal((await fetch(`${base}/docs`)).status, 200);
  const anterior = await request('/login', {
    method: 'POST',
    body: { documento: '10001', contrasena: password },
  });
  assert.equal(anterior.status, 200);
  assert.equal(anterior.body.nombre_rol, 'Administrador');
  const { ver } = jwt.verify(anterior.body.access_token, config.JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: 'xentinel-api',
    audience: 'xentinel-clients',
  });
  const legado = jwt.sign({ ver }, config.JWT_SECRET, {
    subject: String(adminId),
    issuer: 'xentinel-api',
    audience: 'xentinel-clients',
    expiresIn: 60,
  });
  assert.equal((await api('/auth/me', { token: legado })).body.data.id_usuarios, adminId);
});
test('CORS autoriza Web y clientes nativos, bloquea otro origen y permite preflight', async () => {
  assert.equal((await request('/health', { headers: { Origin: 'https://evil.example' } })).status, 403);
  const native = await api('/auth/me', { token: studentToken });
  assert.equal(native.status, 200);
  const web = await api('/auth/me', { token: studentToken, headers: { Origin: 'http://localhost:5173' } });
  assert.equal(web.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  const preflight = await fetch(`${base}/api/v1/ingresos`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5173',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });
  assert.equal(preflight.status, 204);
});
test('JWT, permisos y datos sensibles', async () => {
  assert.equal((await api('/usuarios')).status, 401);
  assert.equal((await api('/usuarios', { token: 'bad' })).status, 401);
  assert.equal((await api('/usuarios', { token: studentToken })).status, 403);
  assert.equal((await api(`/usuarios/${otherId}`, { token: studentToken })).status, 403);
  const result = await api('/usuarios', { token: adminToken });
  assert.equal(result.status, 200);
  assert.ok(result.body.data.every((u) => !('contrasena' in u) && !('auth_version' in u)));
  const expired = jwt.sign({ ver: 0, exp: Math.floor(Date.now() / 1000) - 1 }, config.JWT_SECRET, {
    subject: String(studentId),
    issuer: 'xentinel-api',
    audience: 'xentinel-clients',
  });
  assert.equal((await api('/auth/me', { token: expired })).status, 401);
});
test('login y perfil entregan nombres reales para saludos Web y móvil y reflejan su actualización', async () => {
  const login = await api('/auth/login', {
    method: 'POST',
    body: { documento: '10002', contrasena: password },
  });
  assert.equal(login.body.data.usuario.nombres_completos, 'Kevin Santiago Gómez');
  assert.equal(login.body.data.usuario.nombre, 'Kevin Santiago Gómez');
  const legacy = await request('/login', {
    method: 'POST',
    body: { documento: '10002', contrasena: password },
  });
  assert.equal(legacy.body.nombres_completos, 'Kevin Santiago Gómez');
  const changed = await api(`/usuarios/${studentId}`, {
    method: 'PATCH',
    token: studentToken,
    body: { nombres_completos: 'Kevin Santiago Gómez Ruiz' },
  });
  assert.equal(changed.status, 200);
  const profile = await api('/auth/me', { token: studentToken });
  assert.equal(profile.status, 200);
  assert.equal(profile.body.data.nombre, 'Kevin Santiago Gómez Ruiz');
  assert.equal(profile.body.data.nombre_rol, 'Aprendiz');
  assert.ok(!('auth_version' in profile.body.data));
});
test('el registro público no permite escalada de rol y guarda hash', async () => {
  const body = {
    nombres_completos: 'Aprendiz Prueba',
    tipo_documento: 'CC',
    numero_documento: '20001',
    correo: 'new@test.example',
    contrasena: password,
  };
  assert.equal((await api('/auth/registro', { method: 'POST', body: { ...body, id_rol: 3 } })).status, 422);
  const created = await api('/auth/registro', { method: 'POST', body });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.nombre_rol, 'Aprendiz');
  const {
    rows: [user],
  } = await pool.query('SELECT contrasena FROM usuarios WHERE numero_documento=$1', [body.numero_documento]);
  assert.notEqual(user.contrasena, password);
  assert.ok(await bcrypt.compare(password, user.contrasena));
  assert.equal(
    (
      await api('/auth/registro', {
        method: 'POST',
        body: { ...body, numero_documento: '20002', correo: 'NEW@test.example' },
      })
    ).status,
    409,
  );
});
test('ingresos: secuencia, permisos, reintentos y concurrencia', async () => {
  const body = { id_usuarios: studentId, tipo: 'ENTRADA', metodo: 'Manual', request_id: randomUUID() };
  assert.equal((await api('/ingresos', { method: 'POST', token: studentToken, body })).status, 403);
  assert.equal(
    (await api('/ingresos', { method: 'POST', token: guardToken, body: { ...body, tipo: 'SALIDA' } })).status,
    409,
  );
  const results = await Promise.all(
    [1, 2].map(() => api('/ingresos', { method: 'POST', token: guardToken, body })),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 201]);
  assert.equal(results[0].body.data.id_acceso, results[1].body.data.id_acceso);
  assert.equal(
    (await api('/ingresos', { method: 'POST', token: guardToken, body: { ...body, tipo: 'SALIDA' } })).status,
    409,
  );
  assert.equal(
    (
      await api('/ingresos', {
        method: 'POST',
        token: guardToken,
        body: { ...body, request_id: randomUUID(), tipo: 'SALIDA' },
      })
    ).status,
    201,
  );
  assert.equal((await api('/ingresos', { token: otherToken })).body.data.length, 0);
});
test('alertas sísmicas y meteorológicas: autorización, historial y emisor real', async () => {
  const body = {
    tipo_alerta: 'Sismo',
    mensaje: 'Evacuar siguiendo el protocolo institucional',
    severidad: 'critica',
  };
  assert.equal((await api('/alertas', { method: 'POST', token: studentToken, body })).status, 403);
  assert.equal(
    (await api('/alertas', { method: 'POST', token: adminToken, body: { ...body, emisor_id: studentId } }))
      .status,
    422,
  );
  const result = await api('/alertas', { method: 'POST', token: adminToken, body });
  assert.equal(result.status, 201);
  alertId = result.body.data.id_alerta;
  assert.equal(result.body.data.emisor_id, adminId);
  assert.equal(
    (
      await api('/alertas', {
        method: 'POST',
        token: adminToken,
        body: { ...body, tipo_alerta: 'Meteorológica' },
      })
    ).status,
    201,
  );
  assert.equal((await api('/alertas/activas', { token: studentToken })).body.data.length, 2);
});
test('SOS: validación geográfica, identidad del JWT y acceso restringido', async () => {
  const body = { id_alerta: alertId, latitud: 4.6, longitud: -74.1 };
  assert.equal(
    (await api('/alertas/sos', { method: 'POST', token: studentToken, body: { ...body, latitud: 100 } }))
      .status,
    422,
  );
  assert.equal(
    (
      await api('/alertas/sos', {
        method: 'POST',
        token: studentToken,
        body: { ...body, id_aprendiz: otherId },
      })
    ).status,
    422,
  );
  const result = await api('/alertas/sos', { method: 'POST', token: studentToken, body });
  assert.equal(result.status, 201);
  assert.equal(result.body.data.id_aprendiz, studentId);
  assert.equal((await api(`/alertas/${alertId}/sos`, { token: otherToken })).status, 403);
});
test('pase de lista normalizado comprueba ficha, pertenencia y permisos', async () => {
  const {
    rows: [program],
  } = await pool.query("INSERT INTO programa(nombre_programa) VALUES('ADSO') RETURNING id_programa");
  const {
    rows: [ficha],
  } = await pool.query("INSERT INTO ficha(numero_ficha,id_programa) VALUES('F-TEST',$1) RETURNING id_ficha", [
    program.id_programa,
  ]);
  await pool.query("INSERT INTO aprendiz_ficha(id_usuarios,id_ficha,estado) VALUES($1,$2,'en formación')", [
    studentId,
    ficha.id_ficha,
  ]);
  const body = {
    id_alerta: alertId,
    id_ficha: ficha.id_ficha,
    estudiantes: [{ id_usuarios: studentId, presente: true }],
  };
  assert.equal((await api('/alertas/reportes', { method: 'POST', token: studentToken, body })).status, 403);
  assert.equal(
    (
      await api('/alertas/reportes', {
        method: 'POST',
        token: adminToken,
        body: { ...body, estudiantes: [{ id_usuarios: otherId, presente: true }] },
      })
    ).status,
    422,
  );
  const result = await api('/alertas/reportes', { method: 'POST', token: adminToken, body });
  assert.equal(result.status, 201);
  const { rows } = await pool.query('SELECT * FROM reporte_estudiantes WHERE id_reporte=$1', [
    result.body.data.id_reporte,
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id_usuarios, studentId);
});
test('eventos SSE reciben cambios SQL externos y respetan privacidad y reconexión', async () => {
  const {
    rows: [max],
  } = await pool.query('SELECT coalesce(max(id_evento),0)::text last FROM api_events');
  const abort = new AbortController();
  const response = await fetch(`${base}/api/v1/eventos`, {
    headers: { Authorization: `Bearer ${studentToken}`, 'Last-Event-ID': max.last },
    signal: abort.signal,
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader();
  let text = '';
  await pool.query('UPDATE usuarios SET telefono=$1 WHERE id_usuarios=$2', ['1234567', otherId]);
  await pool.query('UPDATE alertas_emergencia SET mensaje=$1 WHERE id_alerta=$2', [
    'Cambio confirmado desde SQL',
    alertId,
  ]);
  const timeout = setTimeout(() => abort.abort(), 5000);
  try {
    while (!text.includes('alertas_emergencia')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += new TextDecoder().decode(chunk.value);
    }
    assert.match(text, /event: change/);
    assert.match(text, /alertas_emergencia/);
    assert.ok(!text.includes('1234567'));
    assert.ok(!text.includes('"recurso":"usuarios"'));
  } finally {
    clearTimeout(timeout);
    abort.abort();
    await reader.cancel().catch(() => {});
  }
  assert.equal((await api('/eventos?after=999999999999999999', { token: studentToken })).status, 409);
});
test('rollback SQL no publica eventos', async () => {
  const db = await pool.connect();
  try {
    const before = (await db.query('SELECT count(*)::int n FROM api_events')).rows[0].n;
    await db.query('BEGIN');
    await db.query('UPDATE alertas_emergencia SET mensaje=$1 WHERE id_alerta=$2', ['No confirmado', alertId]);
    await db.query('ROLLBACK');
    assert.equal((await db.query('SELECT count(*)::int n FROM api_events')).rows[0].n, before);
  } finally {
    db.release();
  }
});
test('recuperación: respuesta genérica, correo cifrado, validación, vencimiento, uso único y revocación', async () => {
  const correo = 'student@test.example';
  const missing = await api('/auth/olvide-contrasena', {
    method: 'POST',
    body: { correo: 'missing@test.example' },
  });
  const known = await api('/auth/olvide-contrasena', { method: 'POST', body: { correo } });
  assert.equal(known.status, 202);
  assert.deepEqual(known.body, missing.body);
  const pending = (await pool.query('SELECT payload_encrypted FROM mail_outbox')).rows[0];
  assert.ok(!pending.payload_encrypted.includes(correo));
  const [iv, tag, encrypted] = pending.payload_encrypted
    .split('.')
    .map((parte) => Buffer.from(parte, 'base64'));
  const descifrador = createDecipheriv('aes-256-gcm', Buffer.from(config.MAIL_ENCRYPTION_KEY, 'hex'), iv);
  descifrador.setAuthTag(tag);
  const correoCompatible = JSON.parse(Buffer.concat([descifrador.update(encrypted), descifrador.final()]));
  assert.equal(correoCompatible.to, correo);
  await pool.query('UPDATE mail_outbox SET payload_encrypted=$1', [encryptMail(correoCompatible, config)]);
  const enviado = await recogerCorreoFastApi(config);
  assert.equal(enviado.to, correo);
  const link = new URL(enviado.link);
  const token = new URLSearchParams(link.hash.slice(1)).get('token');
  assert.equal(token.length, 64);
  const dbToken = (await pool.query('SELECT token_hash FROM password_reset_tokens')).rows[0];
  assert.notEqual(dbToken.token_hash, token);
  const body = { correo, token };
  assert.equal(
    (
      await api('/auth/validar-recuperacion', {
        method: 'POST',
        body: { ...body, correo: 'other@test.example' },
      })
    ).status,
    400,
  );
  assert.equal((await api('/auth/validar-recuperacion', { method: 'POST', body })).status, 200);
  assert.equal((await pool.query('SELECT usado_en FROM password_reset_tokens')).rows[0].usado_en, null);
  await pool.query(
    "UPDATE password_reset_tokens SET creado_en=now()-interval '2 hours',token_expiracion=now()-interval '1 hour'",
  );
  assert.equal(
    (
      await api('/auth/restablecer-contrasena', {
        method: 'POST',
        body: { ...body, contrasena: 'Nueva-Contrasena-2026!' },
      })
    ).status,
    400,
  );
  await pool.query("UPDATE password_reset_tokens SET token_expiracion=now()+interval '10 minutes'");
  const attempts = await Promise.all(
    [1, 2].map(() =>
      api('/auth/restablecer-contrasena', {
        method: 'POST',
        body: { ...body, contrasena: 'Nueva-Contrasena-2026!' },
      }),
    ),
  );
  assert.deepEqual(attempts.map((r) => r.status).sort(), [200, 400]);
  assert.equal((await api('/auth/me', { token: studentToken })).status, 401);
  const login = await api('/auth/login', {
    method: 'POST',
    body: { documento: '10002', contrasena: 'Nueva-Contrasena-2026!' },
  });
  assert.equal(login.status, 200);
  studentToken = login.body.data.access_token;
});
test('cierre conserva historial y bloquea reportes SOS posteriores', async () => {
  assert.equal(
    (await api(`/alertas/${alertId}/cerrar`, { method: 'PATCH', token: studentToken })).status,
    403,
  );
  assert.equal((await api(`/alertas/${alertId}/cerrar`, { method: 'PATCH', token: adminToken })).status, 200);
  assert.equal((await api(`/alertas/${alertId}/cerrar`, { method: 'PATCH', token: adminToken })).status, 200);
  assert.equal((await api(`/alertas/${alertId}`, { token: studentToken })).body.data.activa, false);
  assert.equal(
    (
      await api('/alertas/sos', {
        method: 'POST',
        token: studentToken,
        body: { id_alerta: alertId, latitud: 4, longitud: -74 },
      })
    ).status,
    409,
  );
});
test('cambios de credenciales desde SQL revocan JWT y tokens de recuperación', async () => {
  const {
    rows: [user],
  } = await pool.query('SELECT auth_version FROM usuarios WHERE id_usuarios=$1', [otherId]);
  await pool.query(
    "INSERT INTO password_reset_tokens(id_usuarios,token_hash,token_expiracion) VALUES($1,$2,now()+interval '20 minutes')",
    [otherId, 'a'.repeat(64)],
  );
  await pool.query('UPDATE usuarios SET correo=$1 WHERE id_usuarios=$2', ['changed@test.example', otherId]);
  const {
    rows: [updated],
  } = await pool.query('SELECT auth_version FROM usuarios WHERE id_usuarios=$1', [otherId]);
  assert.equal(updated.auth_version, user.auth_version + 1);
  assert.equal((await api('/auth/me', { token: otherToken })).status, 401);
  assert.ok(
    (await pool.query('SELECT usado_en FROM password_reset_tokens WHERE id_usuarios=$1', [otherId])).rows[0]
      .usado_en,
  );
});
test('recuperación incluida sirve HTML y JavaScript sin exponer archivos históricos', async () => {
  const page = await fetch(`${base}/restablecer-contrasena`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /reset-form/);
  const script = await fetch(`${base}/recuperacion/reset.js`);
  assert.equal(script.status, 200);
  assert.equal((await request('/static/fotos/usuario_51_1789581338.png')).status, 404);
});
test('SQL independiente instala una base nueva y coincide con las migraciones', async () => {
  const exported = await readFile(new URL('../sql/Xentinel_completo.sql', import.meta.url), 'utf8');
  const exportDb = `${name}_export`;
  await root.query(`CREATE DATABASE "${exportDb}"`);
  const url = new URL(testUrl);
  url.pathname = `/${exportDb}`;
  const fresh = createPool(url.toString());
  try {
    await fresh.query(exported);
    await migrate(fresh);
    assert.equal((await fresh.query('SELECT count(*)::int n FROM rol')).rows[0].n, 6);
  } finally {
    await fresh.end();
    await root.query(`DROP DATABASE "${exportDb}" WITH (FORCE)`);
  }
});
test('errores JSON y rutas usan formato uniforme', async () => {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'INVALID_JSON');
  const missing = await request('/missing');
  assert.equal(missing.status, 404);
  assert.ok(missing.body.error.request_id);
});
test('administración crea, edita y desactiva programas sin borrar fichas ni horarios', async () => {
  const {
    rows: [instructor],
  } = await pool.query(
    `INSERT INTO usuarios(nombres_completos,tipo_documento,numero_documento,contrasena,id_rol)
     SELECT 'Instructor de pruebas','CC','90501','!reset-required!',id_rol
     FROM rol WHERE lower(nombre_rol)='instructor' RETURNING id_usuarios`,
  );
  const horario = {
    nombre_clase: 'Bases de datos',
    dia_semana: 'Miércoles',
    hora_inicio: '08:00',
    hora_fin: '10:00',
    ambiente: 'Laboratorio 5',
    id_instructor: instructor.id_usuarios,
  };
  const body = {
    nombre_programa: 'Programa de prueba',
    nivel_programa: 'Técnico',
    fichas: [{ numero_ficha: 'ADM-TEST', horarios: [horario] }],
  };
  assert.equal((await api('/programas', { method: 'POST', token: studentToken, body })).status, 403);
  const creado = await api('/programas', { method: 'POST', token: adminToken, body });
  assert.equal(creado.status, 201, JSON.stringify(creado.body));
  const programa = creado.body.data;
  const ficha = programa.fichas[0];
  const clase = ficha.horarios[0];
  assert.equal(clase.instructor, 'Instructor de pruebas');
  assert.equal(clase.ambiente, 'Laboratorio 5');
  const ruta = `/programas/${programa.id_programa}`;
  const edicion = {
    ...body,
    nombre_programa: 'Programa actualizado',
    fichas: [
      {
        ...body.fichas[0],
        id_ficha: ficha.id_ficha,
        horarios: [{ ...horario, id_horario: clase.id_horario, ambiente: 'Aula 2' }],
      },
    ],
  };
  const editado = await api(ruta, { method: 'PATCH', token: adminToken, body: edicion });
  assert.equal(editado.status, 200, JSON.stringify(editado.body));
  assert.equal(editado.body.data.fichas[0].horarios[0].ambiente, 'Aula 2');
  const rechazado = await api(ruta, {
    method: 'PATCH',
    token: adminToken,
    body: {
      ...edicion,
      nombre_programa: 'No guardar',
      fichas: [{ ...edicion.fichas[0], id_ficha: 2147483647 }],
    },
  });
  assert.equal(rechazado.status, 409);
  assert.equal((await api(ruta, { token: adminToken })).body.data.nombre_programa, 'Programa actualizado');
  assert.equal(
    (await api(ruta, { method: 'PATCH', token: adminToken, body: { activo: false } })).status,
    200,
  );
  const desactivados = await api('/programas?activo=false', { token: adminToken });
  assert.ok(desactivados.body.data.some((fila) => fila.id_programa === programa.id_programa));
  assert.equal(
    (await api(ruta, { token: adminToken })).body.data.fichas[0].horarios[0].id_horario,
    clase.id_horario,
  );
  const exportado = await api('/reportes/horarios?limit=100', { token: adminToken });
  assert.ok(
    exportado.body.data.some(
      (fila) => fila.id_horario === clase.id_horario && fila.numero_ficha === 'ADM-TEST',
    ),
  );
  assert.equal((await api('/reportes/horarios', { token: guardToken })).status, 403);
});

test('totales de personas no dependen del límite ni del estado elegido', async () => {
  const {
    rows: [esperados],
  } = await pool.query(
    `SELECT count(*) FILTER (WHERE lower(estado)='activo')::int activos,
    count(*) FILTER (WHERE lower(estado)='inactivo')::int inactivos FROM usuarios`,
  );
  for (const estado of ['Activo', 'Inactivo']) {
    const respuesta = await api(`/usuarios?estado=${estado}&limit=1`, { token: adminToken });
    assert.equal(respuesta.status, 200);
    assert.deepEqual(respuesta.body.meta.totales, esperados);
    assert.ok(respuesta.body.data.length <= 1);
    assert.ok(respuesta.body.data.every((fila) => fila.estado.toLowerCase() === estado.toLowerCase()));
  }
});

test('reporte diario respeta medianoche en Bogotá, cursor y permiso de administrador', async () => {
  await pool.query(
    `INSERT INTO acceso(id_usuarios,tipo,fechahora,metodo,estado)
    SELECT $1,tipo,fecha::timestamptz,'Manual','Permitido' FROM (VALUES
      ('ENTRADA','2025-04-06T04:59:59Z'),('ENTRADA','2025-04-06T05:00:00Z'),
      ('SALIDA','2025-04-07T04:59:59Z'),('SALIDA','2025-04-07T05:00:00Z')
    ) filas(tipo,fecha)`,
    [studentId],
  );
  const ruta = '/reportes/accesos?fecha=2025-04-06&limit=1';
  assert.equal((await api(ruta, { token: guardToken })).status, 403);
  const primero = await api(ruta, { token: adminToken });
  assert.equal(primero.status, 200, JSON.stringify(primero.body));
  assert.equal(primero.body.data[0].fechahora, '2025-04-06T05:00:00.000Z');
  assert.ok(primero.body.meta.siguiente > 0);
  const segundo = await api(
    `${ruta}&despues=${primero.body.meta.siguiente}&hasta=${primero.body.meta.hasta}`,
    { token: adminToken },
  );
  assert.equal(segundo.body.data[0].fechahora, '2025-04-07T04:59:59.000Z');
  assert.equal(segundo.body.meta.siguiente, null);
});

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(bytes) {
  let bits = 0,
    valor = 0,
    salida = '';
  for (const byte of bytes) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      salida += BASE32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) salida += BASE32[(valor << (5 - bits)) & 31];
  return salida;
}
// Mismo algoritmo que la app Flutter: si esto cambia, el carnet deja de validar.
function codigoXn2(clave, id, paso) {
  const firma = base32(createHmac('sha256', clave).update(`XN2:${id}:${paso}`).digest()).slice(0, 20);
  return `XN2:${id}:${paso}:${firma}`;
}
const pasoActual = (ms = Date.now()) => Math.floor(ms / 15000);
function abrirCanal(token, cursor, opciones) {
  const ws = new WebSocket(`${base.replace('http', 'ws')}/api/v1/tiempo-real`, opciones);
  const mensajes = [];
  const esperas = [];
  ws.addEventListener('message', (evento) => {
    const datos = JSON.parse(evento.data);
    mensajes.push(datos);
    for (const espera of [...esperas]) {
      if (espera.condicion(datos)) {
        esperas.splice(esperas.indexOf(espera), 1);
        espera.resolver(datos);
      }
    }
  });
  const cierre = new Promise((resolver) => ws.addEventListener('close', (evento) => resolver(evento.code)));
  const abierto = new Promise((resolver, rechazar) => {
    ws.addEventListener('open', resolver);
    ws.addEventListener('error', rechazar);
  });
  // Un rechazo del handshake se observa en `cierre`; no es un error sin manejar.
  abierto.catch(() => {});
  return {
    ws,
    mensajes,
    cierre,
    async autenticar() {
      await abierto;
      ws.send(JSON.stringify({ tipo: 'auth', token, cursor }));
    },
    esperar(condicion, ms = 5000) {
      const previo = mensajes.find(condicion);
      if (previo) return Promise.resolve(previo);
      return new Promise((resolver, rechazar) => {
        const reloj = setTimeout(() => rechazar(new Error(`Sin mensaje: ${JSON.stringify(mensajes)}`)), ms);
        esperas.push({ condicion, resolver: (d) => (clearTimeout(reloj), resolver(d)) });
      });
    },
  };
}
test('carnet QR firmado XN2: emisión, verificación, vigencia, sincronización sin conexión y revocación', async () => {
  // Sesión propia: otra prueba revoca los tokens iniciales de esta persona.
  const ingreso = await api('/auth/login', {
    method: 'POST',
    body: { documento: '10004', contrasena: password },
  });
  const tokenTitular = ingreso.body.data.access_token;
  const credencial = await api('/auth/credencial-qr', { token: tokenTitular });
  assert.equal(credencial.status, 200, JSON.stringify(credencial.body));
  const { clave, paso_segundos, id_usuarios, formato } = credencial.body.data;
  assert.equal(formato, 'XN2');
  assert.equal(paso_segundos, 15);
  assert.equal(id_usuarios, otherId);
  const claveBytes = Buffer.from(clave, 'base64url');
  // La clave se deriva del secreto del servidor y de auth_version (revocable).
  const {
    rows: [{ auth_version: version }],
  } = await pool.query('SELECT auth_version FROM usuarios WHERE id_usuarios=$1', [otherId]);
  const secreto = createHmac('sha256', config.JWT_SECRET).update('xentinel-qr-v2').digest();
  assert.deepEqual(claveBytes, createHmac('sha256', secreto).update(`XN2|${otherId}|${version}`).digest());
  const registrar = (body, token = guardToken) =>
    api('/ingresos', {
      method: 'POST',
      token,
      body: { tipo: 'ENTRADA', metodo: 'QR', request_id: randomUUID(), ...body },
    });
  const codigo = codigoXn2(claveBytes, otherId, pasoActual());
  assert.match(codigo, /^[0-9A-Z:]+$/);
  // Un aprendiz no registra accesos aunque tenga un código válido.
  assert.equal((await registrar({ codigo_qr: codigo }, tokenTitular)).status, 403);
  const alterado = codigo.slice(0, -1) + (codigo.endsWith('A') ? 'B' : 'A');
  assert.equal((await registrar({ codigo_qr: alterado })).body.error.code, 'INVALID_QR');
  assert.equal((await registrar({ codigo_qr: 'XENTINEL:1:2' })).body.error.code, 'INVALID_QR');
  assert.equal((await registrar({ codigo_qr: codigo, metodo: 'Manual' })).status, 422);
  assert.equal(
    (await registrar({ codigo_qr: codigo, id_usuarios: studentId })).body.error.code,
    'INVALID_QR',
  );
  const vencido = await registrar({ codigo_qr: codigoXn2(claveBytes, otherId, pasoActual() - 10) });
  assert.equal(vencido.body.error.code, 'QR_EXPIRED');
  // Escaneo hecho sin conexión hace 10 minutos: se valida contra la hora del escaneo.
  const hace10 = Date.now() - 10 * 60 * 1000;
  const offline = {
    codigo_qr: codigoXn2(claveBytes, otherId, pasoActual(hace10)),
    escaneado_en: new Date(hace10).toISOString(),
    request_id: randomUUID(),
  };
  const sincronizado = await registrar(offline);
  assert.equal(sincronizado.status, 201, JSON.stringify(sincronizado.body));
  assert.equal(sincronizado.body.data.id_usuarios, otherId);
  assert.equal(sincronizado.body.data.metodo, 'QR');
  assert.equal(sincronizado.body.data.fechahora, new Date(hace10).toISOString());
  assert.equal(sincronizado.body.data.persona.nombres_completos, 'Laura Ríos');
  // Reenviar la cola tras perder la respuesta no duplica el movimiento.
  const repetido = await registrar(offline);
  assert.equal(repetido.status, 200);
  assert.equal(repetido.body.data.id_acceso, sincronizado.body.data.id_acceso);
  const salida = await registrar({ codigo_qr: codigoXn2(claveBytes, otherId, pasoActual()), tipo: 'SALIDA' });
  assert.equal(salida.status, 201, JSON.stringify(salida.body));
  assert.equal(
    (
      await registrar({
        codigo_qr: codigoXn2(claveBytes, otherId, pasoActual()),
        escaneado_en: new Date(Date.now() - 4 * 86400000).toISOString(),
      })
    ).body.error.code,
    'INVALID_SCAN_TIME',
  );
  // Cerrar sesión revoca también los carnets guardados para usar sin conexión.
  assert.equal((await api('/auth/logout', { method: 'POST', token: tokenTitular })).status, 204);
  const revocado = await registrar({
    codigo_qr: codigoXn2(claveBytes, otherId, pasoActual()),
    tipo: 'ENTRADA',
  });
  assert.equal(revocado.body.error.code, 'INVALID_QR');
});
test('renovación de sesión conserva el ingreso original y respeta la duración máxima', async () => {
  const renovada = await api('/auth/renovar', { method: 'POST', token: guardToken });
  assert.equal(renovada.status, 200, JSON.stringify(renovada.body));
  const original = jwt.decode(guardToken);
  const nueva = jwt.decode(renovada.body.data.access_token);
  assert.equal(nueva.auth_time, original.auth_time);
  assert.ok(nueva.exp >= original.exp);
  assert.equal(renovada.body.data.usuario.nombre_rol, 'Celador');
  assert.equal((await api('/auth/me', { token: renovada.body.data.access_token })).status, 200);
  const antigua = jwt.sign(
    { ver: original.ver, auth_time: Math.floor(Date.now() / 1000) - 13 * 3600 },
    config.JWT_SECRET,
    { subject: original.sub, issuer: 'xentinel-api', audience: 'xentinel-clients', expiresIn: 60 },
  );
  const vencida = await api('/auth/renovar', { method: 'POST', token: antigua });
  assert.equal(vencida.status, 401);
  assert.equal(vencida.body.error.code, 'SESSION_MAX_AGE');
  assert.equal((await api('/auth/renovar', { method: 'POST' })).status, 401);
});
test('canal WebSocket: autenticación por mensaje, cambios filtrados, ping y rechazos', async () => {
  const {
    rows: [max],
  } = await pool.query('SELECT coalesce(max(id_evento),0)::text last FROM api_events');
  const abiertos = [];
  const abrir = (...args) => {
    const nuevo = abrirCanal(...args);
    abiertos.push(nuevo.ws);
    return nuevo;
  };
  // Un canal abierto impediría detener el servidor de pruebas si una aserción falla.
  try {
    const canal = abrir(studentToken, max.last);
    await canal.autenticar();
    const listo = await canal.esperar((m) => m.tipo === 'listo');
    assert.equal(listo.cursor, max.last);
    assert.ok(Math.abs(listo.servidor_ms - Date.now()) < 5000);
    await pool.query('UPDATE usuarios SET telefono=$1 WHERE id_usuarios=$2', ['7654321', otherId]);
    await pool.query(
      `INSERT INTO alertas_emergencia(tipo_alerta,mensaje,severidad,emisor_id)
    VALUES('Simulacro','Cambio por WebSocket','informativa',$1)`,
      [adminId],
    );
    const cambio = await canal.esperar((m) => m.tipo === 'change' && m.data.recurso === 'alertas_emergencia');
    assert.ok(Number(cambio.id) > Number(max.last));
    assert.ok(!canal.mensajes.some((m) => m.data?.recurso === 'usuarios'), JSON.stringify(canal.mensajes));
    canal.ws.send(JSON.stringify({ tipo: 'ping' }));
    assert.ok((await canal.esperar((m) => m.tipo === 'pong')).servidor_ms > 0);
    // Renovar el token no corta el canal.
    canal.ws.send(JSON.stringify({ tipo: 'auth', token: studentToken }));
    await canal.esperar((m) => m.tipo === 'auth-ok');
    canal.ws.close(1000);
    await canal.cierre;

    const invalido = abrir('no-es-un-token', '0');
    await invalido.autenticar();
    assert.equal(await invalido.cierre, 4401);
    const cursor = abrir(studentToken, '999999999999999999');
    await cursor.autenticar();
    assert.equal(await cursor.cierre, 4409);
    // Un navegador de otro origen no puede abrir el canal con la sesión de la persona.
    const rechazo = await new Promise((resolver, rechazar) => {
      const solicitud = httpRequest(`${base}/api/v1/tiempo-real`, {
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          Origin: 'https://evil.example',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
        },
      });
      solicitud.on('response', (respuesta) => {
        respuesta.resume();
        resolver(respuesta.statusCode);
      });
      solicitud.on('upgrade', (respuesta, socket) => {
        socket.destroy();
        resolver(respuesta.statusCode);
      });
      solicitud.on('error', rechazar);
      solicitud.end();
    });
    assert.equal(rechazo, 403);
  } finally {
    for (const ws of abiertos) ws.close();
  }
});
test('límites por persona autenticada (sedes detrás de NAT) y por cuenta en el login', async () => {
  const clave = (grupo, sujeto) => createHash('sha256').update(`${grupo}:${sujeto}`).digest('hex');
  const saturar = (key) =>
    pool.query(
      `INSERT INTO api_rate_limits(key,hits,expires_at) VALUES($1,100000,now()+interval '5 minutes')
      ON CONFLICT (key) DO UPDATE SET hits=100000,expires_at=now()+interval '5 minutes'`,
      [key],
    );
  await pool.query('DELETE FROM api_rate_limits');
  const ingreso = await api('/auth/login', {
    method: 'POST',
    body: { documento: '10001', contrasena: password },
  });
  const token = ingreso.body.data.access_token;
  // Toda la sede comparte la IP pública: saturarla no bloquea a quien ya inició sesión.
  await saturar(clave('api', '127.0.0.1'));
  assert.equal((await api('/auth/me', { token })).status, 200);
  assert.equal((await api('/auth/me')).status, 429);
  // Un token con firma falsa no usa el cupo de otra persona.
  const falso = jwt.sign({ ver: 0 }, 'otro-secreto'.repeat(6), {
    subject: jwt.decode(token).sub,
    issuer: 'xentinel-api',
    audience: 'xentinel-clients',
  });
  assert.equal((await api('/auth/me', { token: falso })).status, 429);
  await saturar(clave('api', `usuario:${jwt.decode(token).sub}`));
  assert.equal((await api('/auth/me', { token })).status, 429);
  await pool.query('DELETE FROM api_rate_limits');
  // Fuerza bruta contra una cuenta: se frena aunque cambie la IP.
  await saturar(clave('login', 'documento:10002'));
  const bloqueada = await api('/auth/login', {
    method: 'POST',
    body: { documento: '10002', contrasena: password },
  });
  assert.equal(bloqueada.status, 429);
  assert.equal(
    (await api('/auth/login', { method: 'POST', body: { documento: '10001', contrasena: password } })).status,
    200,
  );
  // Los contadores siguen existiendo (con cupo libre) para la prueba siguiente.
  await pool.query('UPDATE api_rate_limits SET hits=0');
});
test('límite de intentos no depende del proceso ASGI', async () => {
  await pool.query('UPDATE api_rate_limits SET hits=1000 WHERE key IS NOT NULL');
  assert.equal(
    (await api('/auth/login', { method: 'POST', body: { documento: 'none', contrasena: 'wrong' } })).status,
    429,
  );
});
