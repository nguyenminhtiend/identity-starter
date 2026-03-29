import { z } from 'zod';

export const forgotPasswordSchema = z.object({
  email: z.email(),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const forgotPasswordResponseSchema = z.object({
  message: z.string(),
  resetToken: z.string().optional(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const resetPasswordResponseSchema = z.object({
  message: z.string(),
});
