import { z } from 'zod';

export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export const webAppEnvSchema = baseEnvSchema.extend({
  API_URL: z.string().default('http://localhost:3001'),
  NEXT_PUBLIC_APP_NAME: z.string().default('Identity Starter'),
});
