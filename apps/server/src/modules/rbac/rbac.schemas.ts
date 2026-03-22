import { z } from 'zod';

export const roleSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  createdAt: z.date(),
});

export type Role = z.infer<typeof roleSchema>;

export const createRoleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const permissionSchema = z.object({
  id: z.uuid(),
  resource: z.string(),
  action: z.string(),
});

export type Permission = z.infer<typeof permissionSchema>;

export const setRolePermissionsSchema = z.object({
  permissionIds: z.array(z.uuid()).min(1),
});

export type SetRolePermissionsInput = z.infer<typeof setRolePermissionsSchema>;

export const assignRoleSchema = z.object({
  roleId: z.uuid(),
});

export type AssignRoleInput = z.infer<typeof assignRoleSchema>;

export const roleWithPermissionCountSchema = roleSchema.extend({
  permissionCount: z.number(),
});

export type RoleWithPermissionCount = z.infer<typeof roleWithPermissionCountSchema>;

export const roleListResponseSchema = z.array(roleWithPermissionCountSchema);

export const roleIdParamSchema = z.object({
  id: z.uuid(),
});

export const userIdParamSchema = z.object({
  id: z.uuid(),
});

export const userRoleParamsSchema = z.object({
  id: z.uuid(),
  roleId: z.uuid(),
});
