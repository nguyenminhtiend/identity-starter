import { webAppEnvSchema } from '@identity-starter/core';

export const env = webAppEnvSchema.parse({
  API_URL: process.env.API_URL,
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
});
