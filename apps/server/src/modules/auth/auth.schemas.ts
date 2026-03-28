import { z } from 'zod';

const userStatusEnum = z.enum(['active', 'suspended', 'pending_verification']);

export const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(255),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const authResponseSchema = z.object({
  token: z.string(),
  user: z.object({
    id: z.uuid(),
    email: z.email(),
    displayName: z.string(),
    status: userStatusEnum,
  }),
});

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    status: 'active' | 'suspended' | 'pending_verification';
  };
}

export const mfaChallengeResponseSchema = z.object({
  mfaRequired: z.literal(true),
  mfaToken: z.string(),
});

export interface MfaChallengeResponse {
  mfaRequired: true;
  mfaToken: string;
}

export const loginResponseSchema = z.union([authResponseSchema, mfaChallengeResponseSchema]);
