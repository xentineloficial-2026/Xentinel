import { Router } from 'express';
import { authenticate, authorize, isAdmin, ownOrAdmin } from '../auth.js';
import { authController } from '../controllers/auth.js';
import { usersController } from '../controllers/users.js';
import { accessController } from '../controllers/access.js';
import { alertsController } from '../controllers/alerts.js';
import { controladorProgramas } from '../controllers/programas.js';
import { controladorReportes } from '../controllers/reportes.js';
import { id, pagination, ok, rateLimit } from '../http.js';

export function apiRoutes(pool, config, stream) {
  const router = Router(),
    auth = authController(pool, config),
    users = usersController(pool),
    access = accessController(pool),
    alerts = alertsController(pool),
    programas = controladorProgramas(pool),
    reportes = controladorReportes(pool);
  const limit = rateLimit(pool, 'auth', 20, 900),
    resetLimit = rateLimit(pool, 'reset', 10, 900);
  router.post('/auth/registro', limit, auth.register);
  router.post('/auth/login', limit, auth.login);
  router.post('/auth/olvide-contrasena', resetLimit, auth.forgot);
  router.post('/auth/validar-recuperacion', resetLimit, auth.validateReset);
  router.post('/auth/restablecer-contrasena', resetLimit, auth.reset);
  router.use(authenticate(pool, config));
  router.get('/auth/me', auth.me);
  router.post('/auth/logout', auth.logout);
  router.put('/auth/contrasena', limit, auth.changePassword);
  router.get('/eventos', stream.handler);
  router.get('/usuarios', authorize(), users.list);
  router.post('/usuarios', authorize(), users.create);
  router.get('/usuarios/:id', users.get);
  router.patch('/usuarios/:id', users.update);
  router.delete('/usuarios/:id', authorize(), users.deactivate);
  router.get('/ingresos', access.list);
  router.get('/reportes/accesos', authorize(), reportes.accesos);
  router.get('/reportes/horarios', authorize(), reportes.horarios);
  router.get('/programas', programas.listar);
  router.get('/programas/instructores', authorize(), programas.instructores);
  router.get('/programas/:id', authorize(), programas.detalle);
  router.post('/programas', authorize(), programas.crear);
  router.patch('/programas/:id', authorize(), programas.actualizar);
  router.post('/ingresos', authorize('celador'), access.create);
  router.get('/alertas', alerts.list);
  router.get('/alertas/activas', alerts.current);
  router.post('/alertas', authorize(), alerts.create);
  router.post('/alertas/sos', rateLimit(pool, 'sos', 30, 60), alerts.sos);
  router.post('/alertas/reportes', authorize('instructor'), alerts.report);
  router.get('/alertas/:id', alerts.get);
  router.patch('/alertas/:id/cerrar', authorize(), alerts.close);
  router.get('/alertas/:id/sos', authorize(), alerts.listSos);
  router.get('/alertas/:id/reportes', authorize('instructor'), alerts.reports);
  // Sólo nombres definidos por código; los identificadores de SQL no vienen del cliente.
  for (const [path, table, key] of [
    ['roles', 'rol', 'id_rol'],
    ['fichas', 'ficha', 'id_ficha'],
    ['jornadas', 'jornada', 'id_jornada'],
    ['horarios', 'horarios', 'id_horario'],
  ]) {
    router.get(`/${path}`, async (req, res) => {
      const p = pagination.parse(req.query);
      const { rows } = await pool.query(`SELECT * FROM ${table} ORDER BY ${key} LIMIT $1 OFFSET $2`, [
        p.limit,
        p.offset,
      ]);
      ok(res, rows, 200, p);
    });
  }
  router.get('/usuarios/:id/fichas', async (req, res) => {
    const target = id.parse(req.params.id);
    ownOrAdmin(req, target);
    const { rows } = await pool.query(
      `SELECT DISTINCT f.*,p.nombre_programa FROM ficha f JOIN programa p USING(id_programa)
      WHERE f.id_ficha IN (SELECT id_ficha FROM aprendiz_ficha WHERE id_usuarios=$1 AND fechasalida IS NULL
        AND lower(estado) NOT IN ('inactivo','retirado','finalizado','cancelado','desertado')
        UNION SELECT id_ficha FROM instructor_ficha WHERE id_usuarios=$1 AND lower(estado)='activo') ORDER BY f.id_ficha`,
      [target],
    );
    ok(res, rows);
  });
  router.get('/asistencias', async (req, res) => {
    const p = pagination.parse(req.query);
    const { rows } = await pool.query(
      'SELECT * FROM asistencia WHERE ($1::integer IS NULL OR id_usuarios=$1) ORDER BY fecha DESC,id_asistencia DESC LIMIT $2 OFFSET $3',
      [isAdmin(req.user) ? null : req.user.id_usuarios, p.limit, p.offset],
    );
    ok(res, rows, 200, p);
  });
  return router;
}
export function legacyRoutes(pool, config) {
  const router = Router(),
    auth = authController(pool, config),
    alerts = alertsController(pool);
  router.use((req, res, next) => {
    req.legacy = true;
    next();
  });
  router.post('/login', rateLimit(pool, 'auth', 20, 900), auth.login);
  router.post('/registro', rateLimit(pool, 'auth', 20, 900), auth.register);
  router.get('/alertas/estado-actual', authenticate(pool, config), alerts.current);
  return router;
}
