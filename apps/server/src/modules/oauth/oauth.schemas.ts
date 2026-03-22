import { z } from 'zod';

export const authorizeQuerySchema = z.object({
  response_type: z.literal('code'),
  client_id: z.string().min(1),
  redirect_uri: z.string().min(1),
  scope: z.string().min(1),
  state: z.string().min(1),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal('S256'),
  nonce: z.string().optional(),
});

export type AuthorizeQueryInput = z.infer<typeof authorizeQuerySchema>;

const authCodeTokenSchema = z.object({
  grant_type: z.literal('authorization_code'),
  code: z.string().min(1),
  redirect_uri: z.string().min(1),
  code_verifier: z.string().min(43).max(128),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
});

const refreshTokenGrantSchema = z.object({
  grant_type: z.literal('refresh_token'),
  refresh_token: z.string().min(1),
  scope: z.string().optional(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
});

export const tokenRequestSchema = z.discriminatedUnion('grant_type', [
  authCodeTokenSchema,
  refreshTokenGrantSchema,
]);

export type TokenRequestInput = z.infer<typeof tokenRequestSchema>;

const consentApproveSchema = z.object({
  client_id: z.string().min(1),
  scope: z.string().min(1),
  decision: z.literal('approve'),
  state: z.string().min(1),
  redirect_uri: z.string().min(1),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal('S256'),
  nonce: z.string().optional(),
});

const consentDenySchema = z.object({
  client_id: z.string().min(1),
  scope: z.string().min(1),
  decision: z.literal('deny'),
  state: z.string().min(1),
  redirect_uri: z.string().min(1),
});

export const consentSchema = z.discriminatedUnion('decision', [
  consentApproveSchema,
  consentDenySchema,
]);

export type ConsentInput = z.infer<typeof consentSchema>;

export const revokeSchema = z.object({
  token: z.string().min(1),
  token_type_hint: z.enum(['refresh_token', 'access_token']).optional(),
});

export type RevokeInput = z.infer<typeof revokeSchema>;

export const tokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.literal('Bearer'),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
  scope: z.string(),
});

export type TokenResponse = z.infer<typeof tokenResponseSchema>;

export const userinfoResponseSchema = z.object({
  sub: z.string(),
  name: z.string().optional(),
  email: z.string().optional(),
  email_verified: z.boolean().optional(),
});

export type UserinfoResponse = z.infer<typeof userinfoResponseSchema>;
