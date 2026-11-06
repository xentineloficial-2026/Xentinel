import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
  assert.equal((await pool.query('SELECT count(*)::int n FROM schema_migrations')).rows[0].n, 3);
  const result = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='password_reset_tokens'",
  );
  assert.ok(result.rows.some((c) => c.column_name === 'token_expiracion'));
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

test('límite de intentos no depende del proceso ASGI', async () => {
  await pool.query('UPDATE api_rate_limits SET hits=1000 WHERE key IS NOT NULL');
  assert.equal(
    (await api('/auth/login', { method: 'POST', body: { documento: 'none', contrasena: 'wrong' } })).status,
    429,
  );
});
