import { z } from 'zod';

export const enrollTotpResponseSchema = z.object({
  otpauthUri: z.string(),
  recoveryCodes: z.array(z.string()),
});

export type EnrollTotpResponse = z.infer<typeof enrollTotpResponseSchema>;

export const verifyTotpEnrollmentSchema = z.object({
  otp: z.string().length(6),
});

export type VerifyTotpEnrollmentInput = z.infer<typeof verifyTotpEnrollmentSchema>;

export const disableTotpSchema = z.object({
  password: z.string().min(1),
});

export type DisableTotpInput = z.infer<typeof disableTotpSchema>;

export const regenerateRecoveryCodesSchema = z.object({
  password: z.string().min(1),
});

export type RegenerateRecoveryCodesInput = z.infer<typeof regenerateRecoveryCodesSchema>;

export const regenerateRecoveryCodesResponseSchema = z.object({
  recoveryCodes: z.array(z.string()),
});

export type RegenerateRecoveryCodesResponse = z.infer<typeof regenerateRecoveryCodesResponseSchema>;

export const mfaVerifySchema = z.object({
  mfaToken: z.string().min(1),
  otp: z.string().length(6).optional(),
  recoveryCode: z.string().optional(),
});

export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;

export const mfaVerifyResponseSchema = z.object({
  token: z.string(),
  user: z.object({
    id: z.uuid(),
    email: z.email(),
    displayName: z.string(),
    status: z.enum(['active', 'suspended', 'pending_verification']),
  }),
});

export type MfaVerifyResponse = z.infer<typeof mfaVerifyResponseSchema>;

export const messageResponseSchema = z.object({
  message: z.string(),
});

export type MessageResponse = z.infer<typeof messageResponseSchema>;
