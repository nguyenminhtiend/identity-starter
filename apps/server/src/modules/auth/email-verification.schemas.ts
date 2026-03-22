import { z } from 'zod';

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const verifyEmailResponseSchema = z.object({
  message: z.string(),
});

export const resendVerificationSchema = z.object({
  email: z.email(),
});
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;

export const resendVerificationResponseSchema = z.object({
  message: z.string(),
  verificationToken: z.string().optional(),
});
