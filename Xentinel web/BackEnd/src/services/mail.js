import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import { transaction } from '../db.js';

export function encryptMail(payload, config) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', Buffer.from(config.MAIL_ENCRYPTION_KEY, 'hex'), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}
function decryptMail(value, config) {
  const [iv, tag, data] = value.split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(config.MAIL_ENCRYPTION_KEY, 'hex'), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
}
export function createMailer(config) {
  if (!config.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE === 'true',
    requireTLS: config.NODE_ENV === 'production' && config.SMTP_SECURE !== 'true',
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
  });
}
export async function sendPendingMail(pool, config, mailer) {
  if (!mailer) return;
  await transaction(pool, async (db) => {
    const {
      rows: [job],
    } = await db.query(`SELECT m.*,t.usado_en,t.token_expiracion FROM mail_outbox m
      JOIN password_reset_tokens t USING(id_token) WHERE m.enviado_en IS NULL AND m.intentos<5 AND m.siguiente_intento<=now()
      ORDER BY m.id_mail LIMIT 1 FOR UPDATE OF m SKIP LOCKED`);
    if (!job) return;
    if (job.usado_en || new Date(job.token_expiracion) <= new Date()) {
      await db.query(
        'UPDATE mail_outbox SET payload_encrypted=NULL,enviado_en=now(),error_codigo=$2 WHERE id_mail=$1',
        [job.id_mail, 'TOKEN_INACTIVE'],
      );
      return;
    }
    try {
      const { to, link } = decryptMail(job.payload_encrypted, config);
      await mailer.sendMail({
        from: config.SMTP_FROM,
        to,
        subject: 'Restablecer contraseña de Xentinel',
        text: `Se solicitó restablecer tu contraseña de Xentinel. El enlace vence en ${config.RESET_TTL_MINUTES} minutos y sólo se puede usar una vez.\n\n${link}\n\nSi no lo solicitaste, ignora este correo.`,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      await db.query(
        'UPDATE mail_outbox SET enviado_en=now(),payload_encrypted=NULL,error_codigo=NULL WHERE id_mail=$1',
        [job.id_mail],
      );
    } catch {
      await db.query(
        `UPDATE mail_outbox SET intentos=intentos+1,error_codigo='SMTP_DELIVERY_FAILED',
        siguiente_intento=now()+make_interval(secs=>60*(intentos+1)),
        payload_encrypted=CASE WHEN intentos>=4 THEN NULL ELSE payload_encrypted END WHERE id_mail=$1`,
        [job.id_mail],
      );
      console.error('SMTP_DELIVERY_FAILED');
    }
  });
}
export function startMailWorker(pool, config, mailer) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await sendPendingMail(pool, config, mailer);
    } catch {
      console.error('MAIL_WORKER_ERROR');
    } finally {
      running = false;
    }
  }, 2000);
  timer.unref();
  return () => clearInterval(timer);
}
