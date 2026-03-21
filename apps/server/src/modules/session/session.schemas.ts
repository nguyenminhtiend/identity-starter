import { z } from 'zod';

export interface Session {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date;
  lastActiveAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export const createSessionSchema = z.object({
  userId: z.uuid(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;

export const sessionIdParamSchema = z.object({
  id: z.uuid(),
});
