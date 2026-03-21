import { z } from 'zod';

export interface User {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  status: 'active' | 'suspended' | 'pending_verification';
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserWithPassword extends User {
  passwordHash: string | null;
}

export const createUserSchema = z.object({
  email: z.email(),
  displayName: z.string().min(1).max(255),
  passwordHash: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const userIdParamSchema = z.object({
  id: z.uuid(),
});
