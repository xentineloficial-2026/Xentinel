import { z } from 'zod';

export function readConfig(env = process.env) {
  const schema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(8000),
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(64),
    MAIL_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
    JWT_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(60).default(20),
    WEB_ORIGINS: z.string().min(1),
    RESET_PASSWORD_URL: z.string().url(),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    SMTP_HOST: z.string().default(''),
    SMTP_PORT: z.coerce.number().int().default(587),
    SMTP_SECURE: z.enum(['true', 'false']).default('false'),
    SMTP_USER: z.string().default(''),
    SMTP_PASS: z.string().default(''),
    SMTP_FROM: z.string().default('Xentinel <no-reply@example.com>'),
  });
  const result = schema.safeParse(env);
  if (!result.success)
    throw new Error(`Configuración inválida: ${result.error.issues.map((i) => i.path.join('.')).join(', ')}`);
  const c = result.data;
  c.origins = c.WEB_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!c.origins.length || c.origins.some((o) => !/^https?:\/\/[^/]+$/.test(o)))
    throw new Error('WEB_ORIGINS debe contener orígenes explícitos sin rutas');
  if (
    c.NODE_ENV === 'production' &&
    (!c.RESET_PASSWORD_URL.startsWith('https://') ||
      c.origins.some((o) => !o.startsWith('https://')) ||
      !c.SMTP_HOST)
  ) {
    throw new Error('Producción requiere HTTPS y SMTP');
  }
  return c;
}
