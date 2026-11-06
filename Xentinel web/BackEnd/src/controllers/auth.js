import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { HttpError, ok } from '../http.js';
import { transaction } from '../db.js';
import { signToken } from '../auth.js';
import { userColumns, userById, publicUser } from '../models/users.js';
import { encryptMail } from '../services/mail.js';

export const password = z
  .string()
  .min(12)
  .max(72)
  .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, 'Máximo 72 bytes UTF-8');
export const email = z.string().trim().toLowerCase().email().max(254);
export const registration = z
  .object({
    nombres_completos: z.string().trim().min(2).max(150),
    tipo_documento: z.enum(['CC', 'TI', 'CE', 'PA', 'PEP', 'PPT']),
    numero_documento: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{3,20}$/),
    correo: email,
    contrasena: password,
    telefono: z.string().trim().max(20).optional(),
    fecha_nacimiento: z.iso.date().optional(),
  })
  .strict();
const tokenInput = z.object({ correo: email, token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const digest = (token) => createHash('sha256').update(token).digest('hex');
const invalidReset = () =>
  new HttpError(400, 'INVALID_RESET_TOKEN', 'El enlace es inválido, venció o ya fue utilizado');
// Hash ficticio para que documentos inexistentes también ejecuten bcrypt.
const dummyHash = await bcrypt.hash(randomBytes(32).toString('hex'), 12);

export function authController(pool, config) {
  return {
    register: async (req, res) => {
      const data = registration.parse(req.body);
      const hash = await bcrypt.hash(data.contrasena, 12);
      const user = await transaction(pool, async (db) => {
        const {
          rows: [role],
        } = await db.query("SELECT id_rol FROM rol WHERE lower(nombre_rol)='aprendiz'");
        if (!role) throw new Error('Rol Aprendiz no configurado');
        const {
          rows: [created],
        } = await db.query(
          `INSERT INTO usuarios(nombres_completos,tipo_documento,numero_documento,correo,contrasena,telefono,fecha_nacimiento,id_rol)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id_usuarios`,
          [
            data.nombres_completos,
            data.tipo_documento,
            data.numero_documento,
            data.correo,
            hash,
            data.telefono || null,
            data.fecha_nacimiento || null,
            role.id_rol,
          ],
        );
        return userById(db, created.id_usuarios);
      });
      if (req.legacy) return res.status(201).json(publicUser(user));
      ok(res, publicUser(user), 201);
    },
    login: async (req, res) => {
      const data = z
        .object({ documento: z.string().trim().min(1).max(20), contrasena: z.string().min(1).max(200) })
        .strict()
        .parse(req.body);
      const {
        rows: [user],
      } = await pool.query(
        `SELECT ${userColumns},u.contrasena,u.auth_version,u.requiere_restablecimiento
        FROM usuarios u JOIN rol r USING(id_rol) WHERE numero_documento=$1`,
        [data.documento],
      );
      const valid = await bcrypt.compare(
        data.contrasena,
        user && !user.requiere_restablecimiento ? user.contrasena : dummyHash,
      );
      if (!valid || !user || user.requiere_restablecimiento || user.estado?.toLowerCase() !== 'activo')
        throw new HttpError(401, 'INVALID_CREDENTIALS', 'Documento o contraseña incorrectos');
      const body = {
        access_token: signToken(user, config),
        token_type: 'Bearer',
        expires_in: config.JWT_TTL_SECONDS,
        usuario: publicUser(user),
      };
      if (req.legacy) return res.json({ ...body.usuario, ...body });
      ok(res, body);
    },
    me: async (req, res) => ok(res, publicUser(req.user)),
    logout: async (req, res) => {
      await pool.query('UPDATE usuarios SET auth_version=auth_version+1 WHERE id_usuarios=$1', [
        req.user.id_usuarios,
      ]);
      res.status(204).end();
    },
    forgot: async (req, res) => {
      const { correo } = z.object({ correo: email }).strict().parse(req.body);
      if (!config.SMTP_HOST && config.NODE_ENV !== 'test')
        throw new HttpError(503, 'MAIL_NOT_CONFIGURED', 'El servicio de correo aún no está configurado');
      const rawToken = randomBytes(32).toString('hex');
      await transaction(pool, async (db) => {
        const {
          rows: [user],
        } = await db.query(
          "SELECT id_usuarios,correo FROM usuarios WHERE lower(btrim(correo))=$1 AND lower(estado)='activo' FOR UPDATE",
          [correo],
        );
        if (!user) return;
        // Evita bombardeo a una misma cuenta, incluso desde distintas direcciones IP.
        const {
          rows: [recent],
        } = await db.query(
          "SELECT id_token FROM password_reset_tokens WHERE id_usuarios=$1 AND creado_en>now()-interval '1 minute' LIMIT 1",
          [user.id_usuarios],
        );
        if (recent) return;
        await db.query(
          'UPDATE password_reset_tokens SET usado_en=now() WHERE id_usuarios=$1 AND usado_en IS NULL',
          [user.id_usuarios],
        );
        const {
          rows: [token],
        } = await db.query(
          `INSERT INTO password_reset_tokens(id_usuarios,token_hash,token_expiracion)
          VALUES($1,$2,now()+make_interval(mins=>$3)) RETURNING id_token`,
          [user.id_usuarios, digest(rawToken), config.RESET_TTL_MINUTES],
        );
        const link = new URL(config.RESET_PASSWORD_URL);
        // Fragmento: el token no se transmite al servidor web ni a sus logs de acceso.
        link.hash = new URLSearchParams({ token: rawToken, correo: user.correo }).toString();
        await db.query('INSERT INTO mail_outbox(id_token,payload_encrypted) VALUES($1,$2)', [
          token.id_token,
          encryptMail({ to: user.correo, link: link.toString() }, config),
        ]);
      });
      ok(
        res,
        {
          message:
            'Si el correo corresponde a una cuenta activa, recibirás un enlace para restablecer la contraseña.',
        },
        202,
      );
    },
    validateReset: async (req, res) => {
      const data = tokenInput.parse(req.body);
      const { rows } = await pool.query(
        `SELECT t.id_token FROM password_reset_tokens t JOIN usuarios u USING(id_usuarios)
        WHERE token_hash=$1 AND lower(btrim(correo))=$2 AND usado_en IS NULL AND token_expiracion>now() AND lower(estado)='activo'`,
        [digest(data.token), data.correo],
      );
      if (!rows.length) throw invalidReset();
      ok(res, { valid: true });
    },
    reset: async (req, res) => {
      const data = tokenInput.extend({ contrasena: password }).parse(req.body);
      const hash = await bcrypt.hash(data.contrasena, 12);
      await transaction(pool, async (db) => {
        // Mismo orden de bloqueo que forgot: usuario antes de token. Revalida dentro de la transacción.
        const {
          rows: [user],
        } = await db.query(
          "SELECT id_usuarios FROM usuarios WHERE lower(btrim(correo))=$1 AND lower(estado)='activo' FOR UPDATE",
          [data.correo],
        );
        if (!user) throw invalidReset();
        const { rows } = await db.query(
          `UPDATE password_reset_tokens SET usado_en=now() WHERE token_hash=$1 AND id_usuarios=$2
          AND usado_en IS NULL AND token_expiracion>now() RETURNING id_token`,
          [digest(data.token), user.id_usuarios],
        );
        if (!rows.length) throw invalidReset();
        await db.query(
          'UPDATE usuarios SET contrasena=$1,requiere_restablecimiento=false,auth_version=auth_version+1 WHERE id_usuarios=$2',
          [hash, user.id_usuarios],
        );
        await db.query(
          'UPDATE password_reset_tokens SET usado_en=now() WHERE id_usuarios=$1 AND usado_en IS NULL',
          [user.id_usuarios],
        );
      });
      ok(res, { message: 'Contraseña actualizada. Inicia sesión de nuevo.' });
    },
    changePassword: async (req, res) => {
      const data = z
        .object({ actual: z.string().min(1).max(200), nueva: password })
        .strict()
        .parse(req.body);
      const hash = await bcrypt.hash(data.nueva, 12);
      await transaction(pool, async (db) => {
        const {
          rows: [user],
        } = await db.query('SELECT contrasena,auth_version FROM usuarios WHERE id_usuarios=$1 FOR UPDATE', [
          req.user.id_usuarios,
        ]);
        if (user.auth_version !== req.claims.ver || !(await bcrypt.compare(data.actual, user.contrasena)))
          throw new HttpError(401, 'INVALID_CREDENTIALS', 'Contraseña actual incorrecta o sesión revocada');
        await db.query('UPDATE usuarios SET contrasena=$1,auth_version=auth_version+1 WHERE id_usuarios=$2', [
          hash,
          req.user.id_usuarios,
        ]);
        await db.query(
          'UPDATE password_reset_tokens SET usado_en=now() WHERE id_usuarios=$1 AND usado_en IS NULL',
          [req.user.id_usuarios],
        );
      });
      res.status(204).end();
    },
  };
}
