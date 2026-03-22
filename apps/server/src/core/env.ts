import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  WEBAUTHN_RP_NAME: z.string().default('Identity Starter'),
  WEBAUTHN_RP_ID: z.string().default('localhost'),
  WEBAUTHN_ORIGIN: z.url().default('http://localhost:3000'),
  SESSION_TTL_SECONDS: z.coerce.number().default(604800),
  TOTP_ENCRYPTION_KEY: z.string().length(64).optional(),
});

export const env = EnvSchema.parse(process.env);
export type Env = z.infer<typeof EnvSchema>;
