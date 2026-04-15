import { ConflictError, NotFoundError } from '@identity-starter/core';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import { createMockDb } from '../../../test/mock-db.js';
import { RBAC_EVENTS } from '../rbac.events.js';
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
import { makeCreateRoleInput } from './rbac.factory.js';

const ROLE_ID = '550e8400-e29b-41d4-a716-446655440000';
const USER_ID = '660e8400-e29b-41d4-a716-446655440000';
const ASSIGNER_ID = '770e8400-e29b-41d4-a716-446655440000';
const PERM_ID_1 = '880e8400-e29b-41d4-a716-446655440001';
const PERM_ID_2 = '880e8400-e29b-41d4-a716-446655440002';

describe('createRole', () => {
  it('creates a role with isSystem false and returns it', async () => {
    const row = { id: ROLE_ID, name: 'editor' };
    const returning = vi.fn().mockResolvedValue([row]);
    const values = vi.fn().mockReturnValue({ returning });
    const insert = vi.fn().mockReturnValue({ values });
    const db = createMockDb({ insert });
    const eventBus = new InMemoryEventBus();
    const publishSpy = vi.spyOn(eventBus, 'publish');

    const input = makeCreateRoleInput({ name: 'editor' });
    const result = await createRole(db, eventBus, input);

    expect(result).toEqual(row);
    expect(insert).toHaveBeenCalled();
    const inserted = values.mock.calls[0][0] as { isSystem: boolean };
    expect(inserted.isSystem).toBe(false);
    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(publishSpy.mock.calls[0][0].eventName).toBe(RBAC_EVENTS.ROLE_CREATED);
    expect(publishSpy.mock.calls[0][0].payload).toEqual({ roleId: ROLE_ID, name: 'editor' });
  });

  it('throws ConflictError when name already exists', async () => {
    const err = new Error('duplicate');
    (err as { code: string }).code = '23505';
    const returning = vi.fn().mockRejectedValue(err);
    const values = vi.fn().mockReturnValue({ returning });
    const insert = vi.fn().mockReturnValue({ values });
    const db = createMockDb({ insert });
    const eventBus = new InMemoryEventBus();

    const input = makeCreateRoleInput({ name: 'admin' });
    await expect(createRole(db, eventBus, input)).rejects.toThrow(ConflictError);
  });
});

describe('listRoles', () => {
  it('returns paginated roles with permission counts', async () => {
    const rows = [
      {
        id: ROLE_ID,
        name: 'admin',
        description: 'Admin role',
        isSystem: true,
        createdAt: new Date(),
        permissionCount: 5,
      },
    ];
    const offset = vi.fn().mockResolvedValue(rows);
    const limit = vi.fn().mockReturnValue({ offset });
    const orderBy = vi.fn().mockReturnValue({ limit });
    const groupBy = vi.fn().mockReturnValue({ orderBy });
    const leftJoin = vi.fn().mockReturnValue({ groupBy });
    const dataFrom = vi.fn().mockReturnValue({ leftJoin });

    const countFrom = vi.fn().mockResolvedValue([{ total: 1 }]);

    let callCount = 0;
    const db = createMockDb({
      select: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return { from: countFrom };
        }
        return { from: dataFrom };
      }),
    });

    const result = await listRoles(db, { page: 1, limit: 50 });

    expect(result.data).toEqual(rows);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.data[0].permissionCount).toBe(5);
  });
});

describe('setRolePermissions', () => {
  it('replaces existing permissions with new set', async () => {
    const existingPerms = [{ id: PERM_ID_1 }, { id: PERM_ID_2 }];
    const selectWhere = vi.fn().mockResolvedValue(existingPerms);
    const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });

    const deleteWhere = vi.fn().mockResolvedValue(undefined);

    const insertValues = vi.fn().mockResolvedValue(undefined);

    const db = createMockDb({
      select: vi.fn().mockReturnValue({ from: selectFrom }),
      delete: vi.fn().mockReturnValue({ where: deleteWhere }),
      insert: vi.fn().mockReturnValue({ values: insertValues }),
    });
    const eventBus = new InMemoryEventBus();
    const publishSpy = vi.spyOn(eventBus, 'publish');

    await setRolePermissions(db, eventBus, ROLE_ID, [PERM_ID_1, PERM_ID_2]);

    expect(db.delete).toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalled();
    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(publishSpy.mock.calls[0][0].eventName).toBe(RBAC_EVENTS.ROLE_UPDATED);
    expect(publishSpy.mock.calls[0][0].payload).toEqual({ roleId: ROLE_ID });
  });

  it('throws NotFoundError when a permission does not exist', async () => {
    const existingPerms = [{ id: PERM_ID_1 }];
    const selectWhere = vi.fn().mockResolvedValue(existingPerms);
    const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });

    const db = createMockDb({
      select: vi.fn().mockReturnValue({ from: selectFrom }),
    });
    const eventBus = new InMemoryEventBus();

    await expect(setRolePermissions(db, eventBus, ROLE_ID, [PERM_ID_1, PERM_ID_2])).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('assignRole', () => {
  it('creates user_roles entry', async () => {
    const selectLimit = vi.fn().mockResolvedValue([{ id: ROLE_ID }]);
    const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
    const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });

    const insertValues = vi.fn().mockResolvedValue(undefined);

    const db = createMockDb({
      select: vi.fn().mockReturnValue({ from: selectFrom }),
      insert: vi.fn().mockReturnValue({ values: insertValues }),
    });
    const eventBus = new InMemoryEventBus();
    const publishSpy = vi.spyOn(eventBus, 'publish');

    await assignRole(db, eventBus, USER_ID, ROLE_ID, ASSIGNER_ID);

    expect(db.insert).toHaveBeenCalled();
    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(publishSpy.mock.calls[0][0].eventName).toBe(RBAC_EVENTS.ROLE_ASSIGNED);
    expect(publishSpy.mock.calls[0][0].payload).toEqual({
      userId: USER_ID,
      roleId: ROLE_ID,
      assignedBy: ASSIGNER_ID,
    });
  });

  it('throws ConflictError when already assigned', async () => {
    const selectLimit = vi.fn().mockResolvedValue([{ id: ROLE_ID }]);
    const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
    const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });

    const err = new Error('duplicate');
    (err as { code: string }).code = '23505';
    const insertValues = vi.fn().mockRejectedValue(err);

    const db = createMockDb({
      select: vi.fn().mockReturnValue({ from: selectFrom }),
      insert: vi.fn().mockReturnValue({ values: insertValues }),
    });
    const eventBus = new InMemoryEventBus();

    await expect(assignRole(db, eventBus, USER_ID, ROLE_ID, ASSIGNER_ID)).rejects.toThrow(
      ConflictError,
    );
  });

  it('throws NotFoundError when role does not exist', async () => {
    const selectLimit = vi.fn().mockResolvedValue([]);
    const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
    const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });

    const db = createMockDb({
      select: vi.fn().mockReturnValue({ from: selectFrom }),
    });
    const eventBus = new InMemoryEventBus();

    await expect(assignRole(db, eventBus, USER_ID, ROLE_ID, ASSIGNER_ID)).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('removeRole', () => {
  it('deletes user_roles entry', async () => {
    const returning = vi.fn().mockResolvedValue([{ userId: USER_ID }]);
    const deleteWhere = vi.fn().mockReturnValue({ returning });
    const db = createMockDb({
      delete: vi.fn().mockReturnValue({ where: deleteWhere }),
    });
    const eventBus = new InMemoryEventBus();
    const publishSpy = vi.spyOn(eventBus, 'publish');

    await removeRole(db, eventBus, USER_ID, ROLE_ID, ASSIGNER_ID);

    expect(db.delete).toHaveBeenCalled();
    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(publishSpy.mock.calls[0][0].eventName).toBe(RBAC_EVENTS.ROLE_REMOVED);
    expect(publishSpy.mock.calls[0][0].payload).toEqual({
      userId: USER_ID,
      roleId: ROLE_ID,
      removedBy: ASSIGNER_ID,
    });
  });

  it('throws NotFoundError when not assigned', async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const deleteWhere = vi.fn().mockReturnValue({ returning });
    const db = createMockDb({
      delete: vi.fn().mockReturnValue({ where: deleteWhere }),
    });
    const eventBus = new InMemoryEventBus();

    await expect(removeRole(db, eventBus, USER_ID, ROLE_ID, ASSIGNER_ID)).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('hasPermission', () => {
  function buildHasPermissionDb(rows: unknown[]) {
    const limit = vi.fn().mockResolvedValue(rows);
    const where = vi.fn().mockReturnValue({ limit });
    const leftJoin2 = vi.fn().mockReturnValue({ where });
    const leftJoin1 = vi.fn().mockReturnValue({ leftJoin: leftJoin2 });
    const innerJoin = vi.fn().mockReturnValue({ leftJoin: leftJoin1 });
    const from = vi.fn().mockReturnValue({ innerJoin });
    return createMockDb({
      select: vi.fn().mockReturnValue({ from }),
    });
  }

  it('returns true when user has super_admin role (bypasses check)', async () => {
    const db = buildHasPermissionDb([{ roleId: ROLE_ID }]);
    const result = await hasPermission(db, USER_ID, 'users', 'read');
    expect(result).toBe(true);
  });

  it('returns true when user has role with matching permission', async () => {
    const db = buildHasPermissionDb([{ roleId: ROLE_ID }]);
    const result = await hasPermission(db, USER_ID, 'users', 'read');
    expect(result).toBe(true);
  });

  it('returns false when user has no matching permission', async () => {
    const db = buildHasPermissionDb([]);
    const result = await hasPermission(db, USER_ID, 'users', 'delete');
    expect(result).toBe(false);
  });
});

describe('getUserRoles', () => {
  it('returns list of roles for a user', async () => {
    const rows = [
      {
        id: ROLE_ID,
        name: 'admin',
        description: 'Admin',
        isSystem: true,
        createdAt: new Date(),
        assignedAt: new Date(),
      },
    ];
    const where = vi.fn().mockResolvedValue(rows);
    const innerJoin = vi.fn().mockReturnValue({ where });
    const from = vi.fn().mockReturnValue({ innerJoin });
    const db = createMockDb({
      select: vi.fn().mockReturnValue({ from }),
    });

    const result = await getUserRoles(db, USER_ID);

    expect(result).toEqual(rows);
    expect(result[0].name).toBe('admin');
  });
});

describe('seedSystemRoles', () => {
  it('creates system roles and permissions if not present', async () => {
    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    const insertValues = vi.fn().mockReturnValue({ onConflictDoNothing });

    const adminRole = { id: ROLE_ID };
    const permRow = { id: PERM_ID_1 };

    const selectLimit = vi.fn().mockResolvedValue([adminRole]);
    const selectWhere = vi.fn().mockImplementation(() => {
      return { limit: selectLimit };
    });
    const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });

    let selectCallCount = 0;
    const db = createMockDb({
      insert: vi.fn().mockReturnValue({ values: insertValues }),
      select: vi.fn().mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return { from: selectFrom };
        }
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([permRow]),
            }),
          }),
        };
      }),
    });

    await seedSystemRoles(db);

    expect(db.insert).toHaveBeenCalled();
    expect(onConflictDoNothing).toHaveBeenCalled();
  });

  it('is idempotent — no error on re-run', async () => {
    const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    const insertValues = vi.fn().mockReturnValue({ onConflictDoNothing });

    const adminRole = { id: ROLE_ID };

    const db = createMockDb({
      insert: vi.fn().mockReturnValue({ values: insertValues }),
      select: vi.fn().mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([adminRole]),
          }),
        }),
      })),
    });

    await seedSystemRoles(db);
    await seedSystemRoles(db);

    expect(onConflictDoNothing).toHaveBeenCalled();
  });
});
