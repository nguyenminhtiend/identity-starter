import { z } from 'zod';

const userStatusEnum = z.enum(['active', 'suspended', 'pending_verification']);

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
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const userIdParamSchema = z.object({
  id: z.uuid(),
});

export const userResponseSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  emailVerified: z.boolean(),
  displayName: z.string(),
  status: userStatusEnum,
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.date(),
  updatedAt: z.date(),
});
