import type { z } from 'zod';
import type { createUserSchema, updateUserSchema } from './user.schemas.js';

export interface User {
  id: string;
  email: string;
  emailVerified: boolean;
  passwordHash: string | null;
  displayName: string;
  status: 'active' | 'suspended' | 'pending_verification';
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
