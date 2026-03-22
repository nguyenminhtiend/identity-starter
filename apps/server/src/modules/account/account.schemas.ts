import { z } from 'zod';

const userStatusEnum = z.enum(['active', 'suspended', 'pending_verification']);

export const profileResponseSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  emailVerified: z.boolean(),
  displayName: z.string(),
  status: userStatusEnum,
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.date(),
});

export type ProfileResponse = z.infer<typeof profileResponseSchema>;

export const updateProfileSchema = z.object({
  displayName: z.string().min(1).max(255).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const updateProfileResponseSchema = profileResponseSchema;

export const sessionListItemSchema = z.object({
  id: z.uuid(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  lastActiveAt: z.date(),
  createdAt: z.date(),
  isCurrent: z.boolean(),
});

export const sessionListResponseSchema = z.array(sessionListItemSchema);

export const sessionIdParamSchema = z.object({
  id: z.uuid(),
});

export const passkeyListItemSchema = z.object({
  id: z.uuid(),
  credentialId: z.string(),
  deviceType: z.string(),
  backedUp: z.boolean(),
  name: z.string().nullable(),
  aaguid: z.string().nullable(),
  createdAt: z.date(),
});

export type PasskeyListItem = z.infer<typeof passkeyListItemSchema>;

export const passkeyListResponseSchema = z.array(passkeyListItemSchema);

export const passkeyIdParamSchema = z.object({
  id: z.uuid(),
});

export const renamePasskeySchema = z.object({
  name: z.string().min(1).max(255),
});

export type RenamePasskeyInput = z.infer<typeof renamePasskeySchema>;

export const renamePasskeyResponseSchema = passkeyListItemSchema;

export const messageResponseSchema = z.object({
  message: z.string(),
});
