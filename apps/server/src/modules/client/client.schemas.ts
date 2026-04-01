import { z } from 'zod';

const grantTypeEnum = z.enum(['authorization_code', 'refresh_token', 'client_credentials']);

const tokenEndpointAuthMethodEnum = z.enum(['client_secret_basic', 'client_secret_post', 'none']);

const responseTypeEnum = z.enum(['code']);

const applicationTypeEnum = z.enum(['web', 'native']);

const clientStatusEnum = z.enum(['active', 'suspended']);

const clientWritableFields = z.object({
  clientName: z.string().min(1).max(255),
  redirectUris: z.array(z.url()),
  grantTypes: z.array(grantTypeEnum),
  scope: z.string().min(1),
  tokenEndpointAuthMethod: tokenEndpointAuthMethodEnum,
  isConfidential: z.boolean(),
  isFirstParty: z.boolean().optional().default(false),
});

export const createClientSchema = clientWritableFields;

export type CreateClientInput = z.infer<typeof createClientSchema>;

export const updateClientSchema = clientWritableFields.partial();

export type UpdateClientInput = z.infer<typeof updateClientSchema>;

export const clientResponseSchema = z.object({
  id: z.uuid(),
  clientId: z.string(),
  clientName: z.string(),
  description: z.string().nullable(),
  redirectUris: z.array(z.url()),
  grantTypes: z.array(grantTypeEnum),
  responseTypes: z.array(responseTypeEnum),
  scope: z.string(),
  tokenEndpointAuthMethod: tokenEndpointAuthMethodEnum,
  isConfidential: z.boolean(),
  isFirstParty: z.boolean(),
  logoUri: z.url().nullable(),
  tosUri: z.url().nullable(),
  policyUri: z.url().nullable(),
  applicationType: applicationTypeEnum,
  status: clientStatusEnum,
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type ClientResponse = z.infer<typeof clientResponseSchema>;

export const clientListResponseSchema = z.array(clientResponseSchema);

export const clientWithSecretResponseSchema = clientResponseSchema.extend({
  clientSecret: z.string().min(1),
});

export type ClientWithSecretResponse = z.infer<typeof clientWithSecretResponseSchema>;

export const rotateSecretResponseSchema = z.object({
  clientSecret: z.string().min(1),
});

export const clientIdParamSchema = z.object({
  id: z.uuid(),
});
