import jwt from 'jsonwebtoken';
import { HttpError } from './http.js';
import { userById } from './models/users.js';

export const roleName = (user) =>
  user.nombre_rol
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
export const isAdmin = (user) => ['administrador', 'admin'].includes(roleName(user));
export function authorize(...roles) {
  return (req, res, next) => {
    if (!isAdmin(req.user) && !roles.includes(roleName(req.user)))
      throw new HttpError(403, 'FORBIDDEN', 'No tiene permisos para esta operación');
    next();
  };
}
export function ownOrAdmin(req, target) {
  if (!isAdmin(req.user) && req.user.id_usuarios !== target)
    throw new HttpError(403, 'FORBIDDEN', 'No tiene acceso a este usuario');
}
export function signToken(user, config) {
  return jwt.sign({ ver: user.auth_version }, config.JWT_SECRET, {
    algorithm: 'HS256',
    subject: String(user.id_usuarios),
    issuer: 'xentinel-api',
    audience: 'xentinel-clients',
    expiresIn: config.JWT_TTL_SECONDS,
  });
}
export function authenticate(pool, config) {
  return async (req, res, next) => {
    const match = /^Bearer ([^\s]+)$/i.exec(req.get('Authorization') || '');
    if (!match) throw new HttpError(401, 'UNAUTHORIZED', 'Se requiere Authorization: Bearer token');
    let claims;
    try {
      claims = jwt.verify(match[1], config.JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: 'xentinel-api',
        audience: 'xentinel-clients',
      });
    } catch {
      throw new HttpError(401, 'INVALID_TOKEN', 'Sesión inválida o vencida');
    }
    if (!/^\d+$/.test(claims.sub) || !Number.isInteger(claims.ver))
      throw new HttpError(401, 'INVALID_TOKEN', 'Sesión inválida');
    const user = await userById(pool, claims.sub);
    if (!user || user.estado?.toLowerCase() !== 'activo' || user.auth_version !== claims.ver)
      throw new HttpError(401, 'REVOKED_TOKEN', 'Sesión inválida o revocada');
    req.user = user;
    req.claims = claims;
    next();
  };
}
