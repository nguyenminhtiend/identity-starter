import { z } from 'zod';

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

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    status: string;
  };
}
