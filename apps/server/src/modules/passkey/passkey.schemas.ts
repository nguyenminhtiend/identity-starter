import { z } from 'zod';

export const registrationVerifyBodySchema = z.object({
  id: z.string(),
  rawId: z.string(),
  response: z.object({
    clientDataJSON: z.string(),
    attestationObject: z.string(),
    authenticatorData: z.string().optional(),
    transports: z.array(z.string()).optional(),
    publicKeyAlgorithm: z.number().optional(),
    publicKey: z.string().optional(),
  }),
  authenticatorAttachment: z.string().optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
  type: z.string(),
});

export type RegistrationVerifyBody = z.infer<typeof registrationVerifyBodySchema>;

export const authenticationVerifyBodySchema = z.object({
  id: z.string(),
  rawId: z.string(),
  response: z.object({
    clientDataJSON: z.string(),
    authenticatorData: z.string(),
    signature: z.string(),
    userHandle: z.string().optional(),
  }),
  authenticatorAttachment: z.string().optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
  type: z.string(),
});

export type AuthenticationVerifyBody = z.infer<typeof authenticationVerifyBodySchema>;

export const registrationVerifyResponseSchema = z.object({
  passkeyId: z.string(),
});

export const authResponseSchema = z.object({
  token: z.string(),
  user: z.object({
    id: z.uuid(),
    email: z.string(),
    displayName: z.string(),
    status: z.enum(['active', 'suspended', 'pending_verification']),
  }),
});

export interface PasskeyAuthResponse {
  token: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    status: 'active' | 'suspended' | 'pending_verification';
  };
}
