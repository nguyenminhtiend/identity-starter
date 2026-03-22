import { ConflictError, NotFoundError } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import { permissions, rolePermissions, roles, userRoles } from '@identity-starter/db';
import { and, count, eq, inArray } from 'drizzle-orm';
import { createDomainEvent, type EventBus } from '../../infra/event-bus.js';
import { RBAC_EVENTS } from './rbac.events.js';
import type { CreateRoleInput } from './rbac.schemas.js';

const SYSTEM_ROLES = ['super_admin', 'admin', 'user'] as const;

const DEFAULT_PERMISSIONS = [
  { resource: 'users', action: 'read' },
  { resource: 'users', action: 'write' },
  { resource: 'roles', action: 'read' },
  { resource: 'roles', action: 'write' },
  { resource: 'sessions', action: 'read' },
  { resource: 'sessions', action: 'write' },
  { resource: 'audit', action: 'read' },
  { resource: 'audit', action: 'export' },
] as const;

const ADMIN_ROLE_PERMISSIONS = [
  { resource: 'users', action: 'read' },
  { resource: 'users', action: 'write' },
  { resource: 'sessions', action: 'read' },
  { resource: 'sessions', action: 'write' },
  { resource: 'audit', action: 'read' },
] as const;

export async function createRole(
  db: Database,
  eventBus: EventBus,
  input: CreateRoleInput,
): Promise<{ id: string; name: string }> {
  try {
    const [row] = await db
      .insert(roles)
      .values({
        name: input.name,
        description: input.description ?? null,
        isSystem: false,
      })
      .returning({ id: roles.id, name: roles.name });

    await eventBus.publish(
      createDomainEvent(RBAC_EVENTS.ROLE_CREATED, { roleId: row.id, name: row.name }),
    );

    return row;
  } catch (error: unknown) {
    if ((error as { code?: string }).code === '23505') {
      throw new ConflictError('Role', 'name', input.name);
    }
    throw error;
  }
}

export async function listRoles(db: Database) {
  const rows = await db
    .select({
      id: roles.id,
      name: roles.name,
      description: roles.description,
      isSystem: roles.isSystem,
      createdAt: roles.createdAt,
      permissionCount: count(rolePermissions.permissionId),
    })
    .from(roles)
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .groupBy(roles.id)
    .orderBy(roles.name);

  return rows;
}

export async function setRolePermissions(
  db: Database,
  eventBus: EventBus,
  roleId: string,
  permissionIds: string[],
): Promise<void> {
  const existing = await db
    .select({ id: permissions.id })
    .from(permissions)
    .where(inArray(permissions.id, permissionIds));

  if (existing.length !== permissionIds.length) {
    const found = new Set(existing.map((r) => r.id));
    const missing = permissionIds.find((id) => !found.has(id)) ?? 'unknown';
    throw new NotFoundError('Permission', missing);
  }

  await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));

  if (permissionIds.length > 0) {
    await db
      .insert(rolePermissions)
      .values(permissionIds.map((permissionId) => ({ roleId, permissionId })));
  }

  await eventBus.publish(createDomainEvent(RBAC_EVENTS.ROLE_UPDATED, { roleId }));
}

export async function assignRole(
  db: Database,
  eventBus: EventBus,
  userId: string,
  roleId: string,
  assignedBy: string,
): Promise<void> {
  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.id, roleId)).limit(1);

  if (!role) {
    throw new NotFoundError('Role', roleId);
  }

  try {
    await db.insert(userRoles).values({ userId, roleId, assignedBy });
  } catch (error: unknown) {
    if ((error as { code?: string }).code === '23505') {
      throw new ConflictError('UserRole', 'userId+roleId', `${userId}+${roleId}`);
    }
    throw error;
  }

  await eventBus.publish(
    createDomainEvent(RBAC_EVENTS.ROLE_ASSIGNED, { userId, roleId, assignedBy }),
  );
}

export async function removeRole(
  db: Database,
  eventBus: EventBus,
  userId: string,
  roleId: string,
  removedBy: string,
): Promise<void> {
  const deleted = await db
    .delete(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)))
    .returning({ userId: userRoles.userId });

  if (deleted.length === 0) {
    throw new NotFoundError('UserRole', `${userId}+${roleId}`);
  }

  await eventBus.publish(
    createDomainEvent(RBAC_EVENTS.ROLE_REMOVED, { userId, roleId, removedBy }),
  );
}

export async function hasPermission(
  db: Database,
  userId: string,
  resource: string,
  action: string,
): Promise<boolean> {
  const [superAdminRole] = await db
    .select({ id: userRoles.roleId })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(userRoles.userId, userId), eq(roles.name, 'super_admin')))
    .limit(1);

  if (superAdminRole) {
    return true;
  }

  const [match] = await db
    .select({ id: rolePermissions.permissionId })
    .from(userRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(
      and(
        eq(userRoles.userId, userId),
        eq(permissions.resource, resource),
        eq(permissions.action, action),
      ),
    )
    .limit(1);

  return !!match;
}

export async function getUserRoles(db: Database, userId: string) {
  const rows = await db
    .select({
      id: roles.id,
      name: roles.name,
      description: roles.description,
      isSystem: roles.isSystem,
      createdAt: roles.createdAt,
      assignedAt: userRoles.assignedAt,
    })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));

  return rows;
}

export async function seedSystemRoles(db: Database): Promise<void> {
  for (const name of SYSTEM_ROLES) {
    await db
      .insert(roles)
      .values({ name, description: `System ${name} role`, isSystem: true })
      .onConflictDoNothing();
  }

  for (const perm of DEFAULT_PERMISSIONS) {
    await db.insert(permissions).values(perm).onConflictDoNothing();
  }

  const [adminRole] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, 'admin'))
    .limit(1);

  if (adminRole) {
    for (const perm of ADMIN_ROLE_PERMISSIONS) {
      const [permRow] = await db
        .select({ id: permissions.id })
        .from(permissions)
        .where(and(eq(permissions.resource, perm.resource), eq(permissions.action, perm.action)))
        .limit(1);

      if (permRow) {
        await db
          .insert(rolePermissions)
          .values({ roleId: adminRole.id, permissionId: permRow.id })
          .onConflictDoNothing();
      }
    }
  }
}
