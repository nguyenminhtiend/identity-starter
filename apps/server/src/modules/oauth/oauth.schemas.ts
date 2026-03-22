import { z } from 'zod';

export const authorizeQueryStandardSchema = z.object({
  response_type: z.literal('code'),
  client_id: z.string().min(1),
  redirect_uri: z.string().min(1),
  scope: z.string().min(1),
  state: z.string(),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal('S256'),
  nonce: z.string().optional(),
});

export type AuthorizeQueryInput = z.infer<typeof authorizeQueryStandardSchema>;

export const authorizeQueryParSchema = z.object({
  request_uri: z.string().min(1),
  client_id: z.string().min(1),
});

export type AuthorizeQueryParInput = z.infer<typeof authorizeQueryParSchema>;

export const authorizeQuerySchema = z.union([
  authorizeQueryStandardSchema,
  authorizeQueryParSchema,
]);

export const parRequestSchema = z.object({
  response_type: z.literal('code'),
  client_id: z.string().min(1),
  redirect_uri: z.string().min(1),
  scope: z.string().min(1),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal('S256'),
  state: z.string().optional(),
  nonce: z.string().optional(),
  client_secret: z.string().optional(),
});

export type ParRequestBody = z.infer<typeof parRequestSchema>;

export const parResponseSchema = z.object({
  request_uri: z.string(),
  expires_in: z.number(),
});

export const authorizeConsentRequiredResponseSchema = z.object({
  type: z.literal('consent_required'),
  client: z.object({
    clientId: z.string(),
    clientName: z.string(),
    scope: z.string(),
    logoUri: z.string().nullable(),
    policyUri: z.string().nullable(),
    tosUri: z.string().nullable(),
  }),
  requestedScope: z.string(),
  state: z.string(),
  redirectUri: z.string(),
});

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

const clientCredentialsTokenSchema = z.object({
  grant_type: z.literal('client_credentials'),
  scope: z.string().optional(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
});

export const tokenRequestSchema = z.discriminatedUnion('grant_type', [
  authCodeTokenSchema,
  refreshTokenGrantSchema,
  clientCredentialsTokenSchema,
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

export const consentClientIdParamSchema = z.object({
  clientId: z.string().min(1),
});

export const revokeSchema = z.object({
  token: z.string().min(1),
  token_type_hint: z.enum(['refresh_token', 'access_token']).optional(),
});

export type RevokeInput = z.infer<typeof revokeSchema>;

export const revokeBodySchema = revokeSchema.extend({
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
});

export const tokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.enum(['Bearer', 'DPoP']),
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

export const introspectRequestSchema = z.object({
  token: z.string().min(1),
  token_type_hint: z.enum(['access_token', 'refresh_token']).optional(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
});

export const introspectResponseSchema = z.object({
  active: z.boolean(),
  scope: z.string().optional(),
  client_id: z.string().optional(),
  sub: z.string().optional(),
  exp: z.number().optional(),
  iat: z.number().optional(),
  iss: z.string().optional(),
  token_type: z.string().optional(),
  cnf: z.object({ jkt: z.string() }).optional(),
});

export type IntrospectRequest = z.infer<typeof introspectRequestSchema>;
export type IntrospectResponse = z.infer<typeof introspectResponseSchema>;

export const endSessionQuerySchema = z.object({
  id_token_hint: z.string().optional(),
  post_logout_redirect_uri: z.string().optional(),
  state: z.string().optional(),
});

export type EndSessionQuery = z.infer<typeof endSessionQuerySchema>;
