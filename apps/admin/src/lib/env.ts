import { webAppEnvSchema } from '@identity-starter/core';
import { z } from 'zod';

const envSchema = webAppEnvSchema.extend({
  ADMIN_OAUTH_CLIENT_ID: z.string().default('admin-dashboard'),
  ADMIN_OAUTH_CLIENT_SECRET: z.string().default('admin-dashboard-dev-secret'),

  IDP_ISSUER_URL: z.string().default('http://localhost:3100'),
  IDP_API_URL: z.string().default('http://localhost:3001'),

  ADMIN_OAUTH_REDIRECT_URI: z.string().default('http://localhost:3002/auth/callback'),

  ADMIN_SESSION_SECRET: z.string().min(32).default('0123456789abcdef0123456789abcdef'),
});

export const env = envSchema.parse({
  API_URL: process.env.API_URL,
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  ADMIN_OAUTH_CLIENT_ID: process.env.ADMIN_OAUTH_CLIENT_ID,
  ADMIN_OAUTH_CLIENT_SECRET: process.env.ADMIN_OAUTH_CLIENT_SECRET,
  IDP_ISSUER_URL: process.env.IDP_ISSUER_URL,
  IDP_API_URL: process.env.IDP_API_URL,
  ADMIN_OAUTH_REDIRECT_URI: process.env.ADMIN_OAUTH_REDIRECT_URI,
  ADMIN_SESSION_SECRET: process.env.ADMIN_SESSION_SECRET,
});
