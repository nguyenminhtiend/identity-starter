import { index, pgTable, primaryKey, uuid } from 'drizzle-orm/pg-core';
import { permissions } from './permission.js';
import { roles } from './role.js';

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permissionId] }),
    index('role_permissions_permission_id_idx').on(t.permissionId),
  ],
);
