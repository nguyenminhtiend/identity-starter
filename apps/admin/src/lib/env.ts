import { z } from 'zod';

const envSchema = z.object({
  API_URL: z.string().default('http://localhost:3001'),
  SESSION_COOKIE_NAME: z.string().default('admin_session'),
  NEXT_PUBLIC_APP_NAME: z.string().default('Identity Admin'),
});

export const env = envSchema.parse({
  API_URL: process.env.API_URL,
  SESSION_COOKIE_NAME: process.env.SESSION_COOKIE_NAME,
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
});
