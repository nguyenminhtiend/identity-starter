import { ConflictError, NotFoundError } from '@identity-starter/core';
import { permissions, rolePermissions, roles } from '@identity-starter/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';
import { makeCreateUserInput } from '../../user/__tests__/user.factory.js';
import { createUser } from '../../user/user.service.js';
import {
  assignRole,
  createRole,
  getUserRoles,
  hasPermission,
  listRoles,
  removeRole,
  seedSystemRoles,
  setRolePermissions,
} from '../rbac.service.js';

let testDb: TestDb;
let eventBus: InMemoryEventBus;

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.teardown();
});

beforeEach(() => {
  eventBus = new InMemoryEventBus();
});

async function seedUser() {
  const input = makeCreateUserInput();
  return createUser(testDb.db, eventBus, input);
}

describe('seedSystemRoles', () => {
  it('seeds 3 system roles', async () => {
    await seedSystemRoles(testDb.db);

    const allRoles = await testDb.db
      .select({ name: roles.name, isSystem: roles.isSystem })
      .from(roles)
      .where(eq(roles.isSystem, true));

    const names = allRoles.map((r) => r.name).sort();
    expect(names).toEqual(['admin', 'super_admin', 'user']);
  });

  it('seeds 8 default permissions', async () => {
    await seedSystemRoles(testDb.db);

    const allPerms = await testDb.db
      .select({ resource: permissions.resource, action: permissions.action })
      .from(permissions);

    expect(allPerms).toHaveLength(8);
  });

  it('assigns correct permissions to admin role', async () => {
    await seedSystemRoles(testDb.db);

    const [adminRole] = await testDb.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.name, 'admin'))
      .limit(1);

    const adminPerms = await testDb.db
      .select({
        resource: permissions.resource,
        action: permissions.action,
      })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(rolePermissions.roleId, adminRole.id));

    const permSet = adminPerms.map((p) => `${p.resource}:${p.action}`).sort();
    expect(permSet).toEqual([
      'audit:read',
      'sessions:read',
      'sessions:write',
      'users:read',
      'users:write',
    ]);
  });

  it('is idempotent — calling twice does not error or duplicate', async () => {
    await seedSystemRoles(testDb.db);
    await seedSystemRoles(testDb.db);

    const allRoles = await testDb.db
      .select({ name: roles.name })
      .from(roles)
      .where(eq(roles.isSystem, true));

    expect(allRoles).toHaveLength(3);

    const allPerms = await testDb.db.select({ id: permissions.id }).from(permissions);

    expect(allPerms).toHaveLength(8);
  });
});

describe('createRole', () => {
  it('creates custom role with isSystem false', async () => {
    const role = await createRole(testDb.db, eventBus, {
      name: `custom-${Date.now()}`,
      description: 'A test role',
    });

    expect(role.id).toBeDefined();
    expect(role.name).toContain('custom-');

    const [row] = await testDb.db
      .select({ isSystem: roles.isSystem })
      .from(roles)
      .where(eq(roles.id, role.id));

    expect(row.isSystem).toBe(false);
  });

  it('throws ConflictError on duplicate name', async () => {
    const name = `dup-${Date.now()}`;
    await createRole(testDb.db, eventBus, { name });

    await expect(createRole(testDb.db, eventBus, { name })).rejects.toThrow(ConflictError);
  });
});

describe('listRoles', () => {
  it('returns all roles with correct permission counts', async () => {
    await seedSystemRoles(testDb.db);

    const list = await listRoles(testDb.db);

    expect(list.data.length).toBeGreaterThanOrEqual(3);

    const admin = list.data.find((r) => r.name === 'admin');
    expect(admin).toBeDefined();
    expect(admin?.permissionCount).toBe(5);

    const superAdmin = list.data.find((r) => r.name === 'super_admin');
    expect(superAdmin).toBeDefined();
    expect(superAdmin?.permissionCount).toBe(0);
  });

  it('reflects updated permission count after setRolePermissions', async () => {
    await seedSystemRoles(testDb.db);

    const roleName = `counted-${Date.now()}`;
    const role = await createRole(testDb.db, eventBus, { name: roleName });

    const allPerms = await testDb.db.select({ id: permissions.id }).from(permissions);
    const twoPerms = allPerms.slice(0, 2).map((p) => p.id);

    await setRolePermissions(testDb.db, eventBus, role.id, twoPerms);

    const list = await listRoles(testDb.db);
    const found = list.data.find((r) => r.id === role.id);
    expect(found?.permissionCount).toBe(2);
  });
});

describe('setRolePermissions', () => {
  it('sets permissions on a role', async () => {
    await seedSystemRoles(testDb.db);

    const role = await createRole(testDb.db, eventBus, { name: `set-perm-${Date.now()}` });
    const allPerms = await testDb.db.select({ id: permissions.id }).from(permissions);
    const ids = allPerms.slice(0, 3).map((p) => p.id);

    await setRolePermissions(testDb.db, eventBus, role.id, ids);

    const assigned = await testDb.db
      .select({ permissionId: rolePermissions.permissionId })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, role.id));

    expect(assigned).toHaveLength(3);
  });

  it('replaces (not appends) on second call', async () => {
    await seedSystemRoles(testDb.db);

    const role = await createRole(testDb.db, eventBus, { name: `replace-${Date.now()}` });
    const allPerms = await testDb.db.select({ id: permissions.id }).from(permissions);

    await setRolePermissions(
      testDb.db,
      eventBus,
      role.id,
      allPerms.slice(0, 3).map((p) => p.id),
    );
    await setRolePermissions(
      testDb.db,
      eventBus,
      role.id,
      allPerms.slice(3, 5).map((p) => p.id),
    );

    const assigned = await testDb.db
      .select({ permissionId: rolePermissions.permissionId })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, role.id));

    expect(assigned).toHaveLength(2);
    const assignedIds = assigned.map((a) => a.permissionId).sort();
    const expectedIds = allPerms
      .slice(3, 5)
      .map((p) => p.id)
      .sort();
    expect(assignedIds).toEqual(expectedIds);
  });
});

describe('assignRole + getUserRoles', () => {
  it('assigns role to user and getUserRoles returns it', async () => {
    await seedSystemRoles(testDb.db);
    const user = await seedUser();
    const assigner = await seedUser();

    const [userRole] = await testDb.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.name, 'user'))
      .limit(1);

    await assignRole(testDb.db, eventBus, user.id, userRole.id, assigner.id);

    const userRolesList = await getUserRoles(testDb.db, user.id);
    expect(userRolesList).toHaveLength(1);
    expect(userRolesList[0].name).toBe('user');
    expect(userRolesList[0].assignedAt).toBeDefined();
  });

  it('throws ConflictError on duplicate assignment', async () => {
    await seedSystemRoles(testDb.db);
    const user = await seedUser();
    const assigner = await seedUser();

    const [adminRole] = await testDb.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.name, 'admin'))
      .limit(1);

    await assignRole(testDb.db, eventBus, user.id, adminRole.id, assigner.id);

    await expect(
      assignRole(testDb.db, eventBus, user.id, adminRole.id, assigner.id),
    ).rejects.toThrow(ConflictError);
  });
});

describe('removeRole', () => {
  it('removes an assigned role', async () => {
    await seedSystemRoles(testDb.db);
    const user = await seedUser();
    const admin = await seedUser();

    const [userRole] = await testDb.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.name, 'user'))
      .limit(1);

    await assignRole(testDb.db, eventBus, user.id, userRole.id, admin.id);
    await removeRole(testDb.db, eventBus, user.id, userRole.id, admin.id);

    const remaining = await getUserRoles(testDb.db, user.id);
    expect(remaining).toHaveLength(0);
  });

  it('throws NotFoundError when removing non-assigned role', async () => {
    await seedSystemRoles(testDb.db);
    const user = await seedUser();
    const admin = await seedUser();

    const [userRole] = await testDb.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.name, 'user'))
      .limit(1);

    await expect(removeRole(testDb.db, eventBus, user.id, userRole.id, admin.id)).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('hasPermission', () => {
  it('returns true for user with admin role and users:read permission', async () => {
    await seedSystemRoles(testDb.db);
    const user = await seedUser();
    const assigner = await seedUser();

    const [adminRole] = await testDb.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.name, 'admin'))
      .limit(1);

    await assignRole(testDb.db, eventBus, user.id, adminRole.id, assigner.id);

    const result = await hasPermission(testDb.db, user.id, 'users', 'read');
    expect(result).toBe(true);
  });

  it('returns false for admin user checking unassigned audit:export', async () => {
    await seedSystemRoles(testDb.db);
    const user = await seedUser();
    const assigner = await seedUser();

    const [adminRole] = await testDb.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.name, 'admin'))
      .limit(1);

    await assignRole(testDb.db, eventBus, user.id, adminRole.id, assigner.id);

    const result = await hasPermission(testDb.db, user.id, 'audit', 'export');
    expect(result).toBe(false);
  });

  it('returns true for super_admin regardless of permission', async () => {
    await seedSystemRoles(testDb.db);
    const user = await seedUser();
    const assigner = await seedUser();

    const [superAdminRole] = await testDb.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.name, 'super_admin'))
      .limit(1);

    await assignRole(testDb.db, eventBus, user.id, superAdminRole.id, assigner.id);

    expect(await hasPermission(testDb.db, user.id, 'audit', 'export')).toBe(true);
    expect(await hasPermission(testDb.db, user.id, 'anything', 'whatever')).toBe(true);
  });

  it('returns false for user with no roles', async () => {
    const user = await seedUser();

    const result = await hasPermission(testDb.db, user.id, 'users', 'read');
    expect(result).toBe(false);
  });
});
