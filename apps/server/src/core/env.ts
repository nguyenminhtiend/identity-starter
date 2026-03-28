import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  WEBAUTHN_RP_NAME: z.string().default('Identity Starter'),
  WEBAUTHN_RP_ID: z.string().default('localhost'),
  WEBAUTHN_ORIGIN: z.url().default('http://localhost:3100'),
  CORS_ORIGINS: z.string().default('http://localhost:3100,http://localhost:3002'),
  COOKIE_SECRET: z
    .string()
    .default('change-me-in-production')
    .refine(
      (v) => process.env.NODE_ENV !== 'production' || v !== 'change-me-in-production',
      'COOKIE_SECRET must be set to a secure value in production',
    ),
  SESSION_TTL_SECONDS: z.coerce.number().default(604800),
  JWT_ISSUER: z.url().default('http://localhost:3100'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(3600),
  AUDIT_RETENTION_DAYS: z.coerce.number().default(90),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().default(2592000),
  AUTH_CODE_TTL_SECONDS: z.coerce.number().default(600),
  REFRESH_GRACE_PERIOD_SECONDS: z.coerce.number().default(10),
  PAR_TTL_SECONDS: z.coerce.number().default(60),
  DPOP_NONCE_TTL_SECONDS: z.coerce.number().default(300),
  TOTP_ENCRYPTION_KEY: z
    .string()
    .length(64)
    .default('0'.repeat(64))
    .refine(
      (v) => process.env.NODE_ENV !== 'production' || v !== '0'.repeat(64),
      'TOTP_ENCRYPTION_KEY must be set to a secure value in production',
    ),
  RATE_LIMIT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
