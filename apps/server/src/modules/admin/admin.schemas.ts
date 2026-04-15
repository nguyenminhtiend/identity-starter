import { z } from 'zod';

const userStatusEnum = z.enum(['active', 'suspended', 'pending_verification']);

export const adminUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  emailVerified: z.boolean(),
  displayName: z.string(),
  status: userStatusEnum,
  createdAt: z.date(),
  roles: z.array(z.object({ id: z.uuid(), name: z.string() })),
});

export type AdminUser = z.infer<typeof adminUserSchema>;

export const adminUserListItemSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string(),
  status: userStatusEnum,
  createdAt: z.date(),
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(200).default(50),
});

export const userListQuerySchema = paginationQuerySchema.extend({
  status: userStatusEnum.optional(),
  email: z.string().optional(),
});

export type UserListQuery = z.infer<typeof userListQuerySchema>;

export const paginatedResponseSchema = <T extends z.ZodType>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    total: z.number(),
    page: z.number(),
    limit: z.number(),
  });

export const userListResponseSchema = paginatedResponseSchema(adminUserListItemSchema);
export type UserListResponse = z.infer<typeof userListResponseSchema>;

export const updateUserStatusSchema = z.object({
  status: z.enum(['active', 'suspended']),
});

export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;

export const userIdParamSchema = z.object({
  id: z.uuid(),
});

export const adminSessionSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  lastActiveAt: z.date(),
  createdAt: z.date(),
});

export const sessionListQuerySchema = paginationQuerySchema.extend({
  userId: z.uuid().optional(),
});

export const sessionListResponseSchema = paginatedResponseSchema(adminSessionSchema);

export const sessionIdParamSchema = z.object({
  id: z.uuid(),
});

export const messageResponseSchema = z.object({
  message: z.string(),
});
