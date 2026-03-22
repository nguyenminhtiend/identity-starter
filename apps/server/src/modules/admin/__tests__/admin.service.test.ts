import { NotFoundError, ValidationError } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import { ADMIN_EVENTS } from '../admin.events.js';
import {
  bulkRevokeSessions,
  getUser,
  listSessions,
  listUsers,
  revokeSession,
  updateUserStatus,
} from '../admin.service.js';
import { makeUpdateUserStatusInput, makeUserListQuery } from './admin.factory.js';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
  offset: vi.fn(),
  innerJoin: vi.fn(),
  set: vi.fn(),
}));

function mockChain() {
  mocks.select.mockReturnValue({ from: mocks.from });
  mocks.from.mockReturnValue({ where: mocks.where });
  mocks.where.mockReturnValue({ limit: mocks.limit, offset: mocks.offset });
  mocks.limit.mockReturnValue({ offset: mocks.offset });
  mocks.offset.mockResolvedValue([]);
  mocks.update.mockReturnValue({ set: mocks.set });
  mocks.set.mockReturnValue({ where: mocks.where });
  mocks.delete.mockReturnValue({ where: mocks.where });
  mocks.innerJoin.mockReturnValue({ where: mocks.where });
}

function makeDb(): Database {
  return {
    select: mocks.select,
    update: mocks.update,
    delete: mocks.delete,
  } as unknown as Database;
}

let db: Database;
let eventBus: InMemoryEventBus;

beforeEach(() => {
  vi.resetAllMocks();
  mockChain();
  db = makeDb();
  eventBus = new InMemoryEventBus();
});

describe('listUsers', () => {
  it('returns paginated users with total count', async () => {
    const userRow = {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'user@example.com',
      displayName: 'User',
      emailVerified: true,
      status: 'active',
      isAdmin: false,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    let selectCall = 0;
    mocks.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) {
        mocks.from.mockReturnValue({ where: vi.fn().mockResolvedValue([{ total: 1 }]) });
      } else {
        mocks.from.mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              offset: vi.fn().mockResolvedValue([userRow]),
            }),
          }),
        });
      }
      return { from: mocks.from };
    });

    const query = makeUserListQuery();
    const result = await listUsers(db, query);

    expect(result.total).toBe(1);
    expect(result.data).toEqual([userRow]);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it('filters by status when provided', async () => {
    let selectCall = 0;
    mocks.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) {
        mocks.from.mockReturnValue({ where: vi.fn().mockResolvedValue([{ total: 0 }]) });
      } else {
        mocks.from.mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              offset: vi.fn().mockResolvedValue([]),
            }),
          }),
        });
      }
      return { from: mocks.from };
    });

    const query = makeUserListQuery({ status: 'suspended' });
    const result = await listUsers(db, query);

    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);
  });

  it('filters by email partial match when provided', async () => {
    let selectCall = 0;
    mocks.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) {
        mocks.from.mockReturnValue({ where: vi.fn().mockResolvedValue([{ total: 0 }]) });
      } else {
        mocks.from.mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              offset: vi.fn().mockResolvedValue([]),
            }),
          }),
        });
      }
      return { from: mocks.from };
    });

    const query = makeUserListQuery({ email: 'admin' });
    const result = await listUsers(db, query);

    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);
  });
});

describe('getUser', () => {
  it('returns user with roles', async () => {
    const userRow = {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'user@example.com',
      displayName: 'User',
      emailVerified: true,
      status: 'active',
      isAdmin: false,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const roleRows = [{ id: 'role-1', name: 'admin' }];

    let selectCall = 0;
    mocks.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) {
        mocks.from.mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([userRow]),
          }),
        });
      } else {
        mocks.from.mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(roleRows),
          }),
        });
      }
      return { from: mocks.from };
    });

    const result = await getUser(db, userRow.id);

    expect(result.id).toBe(userRow.id);
    expect(result.email).toBe(userRow.email);
    expect(result.roles).toEqual(roleRows);
  });

  it('throws NotFoundError when not found', async () => {
    mocks.from.mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    });

    await expect(getUser(db, '00000000-0000-0000-0000-000000000099')).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('updateUserStatus', () => {
  const adminId = '00000000-0000-0000-0000-000000000099';
  const userId = '00000000-0000-0000-0000-000000000001';

  function setupExistingUser() {
    const userRow = {
      id: userId,
      email: 'user@example.com',
      displayName: 'User',
      emailVerified: true,
      status: 'active',
      isAdmin: false,
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const roleRows = [{ id: 'role-1', name: 'user' }];

    let selectCall = 0;
    mocks.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) {
        // exists check
        mocks.from.mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: userId }]),
          }),
        });
      } else if (selectCall === 2) {
        // getUser -> user select
        mocks.from.mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([userRow]),
          }),
        });
      } else {
        // getUser -> roles select
        mocks.from.mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(roleRows),
          }),
        });
      }
      return { from: mocks.from };
    });

    mocks.update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });

    mocks.delete.mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });

    return { userRow, roleRows };
  }

  it('updates user status and emits admin.user_suspended', async () => {
    setupExistingUser();
    const events: string[] = [];
    eventBus.subscribe(ADMIN_EVENTS.USER_SUSPENDED, (e) => {
      events.push(e.eventName);
    });

    const input = makeUpdateUserStatusInput({ status: 'suspended' });
    const result = await updateUserStatus(db, eventBus, userId, input, adminId);

    expect(result.id).toBe(userId);
    expect(events).toContain(ADMIN_EVENTS.USER_SUSPENDED);
  });

  it('updates user status and emits admin.user_activated', async () => {
    setupExistingUser();
    const events: string[] = [];
    eventBus.subscribe(ADMIN_EVENTS.USER_ACTIVATED, (e) => {
      events.push(e.eventName);
    });

    const input = makeUpdateUserStatusInput({ status: 'active' });
    const result = await updateUserStatus(db, eventBus, userId, input, adminId);

    expect(result.id).toBe(userId);
    expect(events).toContain(ADMIN_EVENTS.USER_ACTIVATED);
  });

  it('throws NotFoundError when user does not exist', async () => {
    mocks.from.mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    });

    const input = makeUpdateUserStatusInput({ status: 'suspended' });
    await expect(updateUserStatus(db, eventBus, userId, input, adminId)).rejects.toThrow(
      NotFoundError,
    );
  });

  it('throws ValidationError when trying to suspend self', async () => {
    const input = makeUpdateUserStatusInput({ status: 'suspended' });
    await expect(updateUserStatus(db, eventBus, adminId, input, adminId)).rejects.toThrow(
      ValidationError,
    );
  });
});

describe('listSessions', () => {
  it('returns paginated sessions', async () => {
    const sessionRow = {
      id: 'sess-1',
      token: 'tok',
      userId: 'user-1',
      expiresAt: new Date(),
      lastActiveAt: new Date(),
      ipAddress: '127.0.0.1',
      userAgent: 'test',
      createdAt: new Date(),
    };

    let selectCall = 0;
    mocks.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) {
        mocks.from.mockReturnValue({ where: vi.fn().mockResolvedValue([{ total: 1 }]) });
      } else {
        mocks.from.mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              offset: vi.fn().mockResolvedValue([sessionRow]),
            }),
          }),
        });
      }
      return { from: mocks.from };
    });

    const result = await listSessions(db, { page: 1, limit: 20 });

    expect(result.total).toBe(1);
    expect(result.data).toEqual([sessionRow]);
    expect(result.page).toBe(1);
  });

  it('filters by userId when provided', async () => {
    let selectCall = 0;
    mocks.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) {
        mocks.from.mockReturnValue({ where: vi.fn().mockResolvedValue([{ total: 0 }]) });
      } else {
        mocks.from.mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              offset: vi.fn().mockResolvedValue([]),
            }),
          }),
        });
      }
      return { from: mocks.from };
    });

    const result = await listSessions(db, {
      page: 1,
      limit: 20,
      userId: '00000000-0000-0000-0000-000000000001',
    });

    expect(result.total).toBe(0);
    expect(result.data).toEqual([]);
  });
});

describe('revokeSession', () => {
  it('deletes session and emits admin.session_revoked', async () => {
    const sessionRow = { id: 'sess-1', userId: 'user-1' };

    mocks.from.mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([sessionRow]),
      }),
    });
    mocks.delete.mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });

    const events: string[] = [];
    eventBus.subscribe(ADMIN_EVENTS.SESSION_REVOKED, (e) => {
      events.push(e.eventName);
    });

    await revokeSession(db, eventBus, 'sess-1', 'admin-1');

    expect(events).toContain(ADMIN_EVENTS.SESSION_REVOKED);
  });

  it('throws NotFoundError when session does not exist', async () => {
    mocks.from.mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    });

    await expect(revokeSession(db, eventBus, 'sess-missing', 'admin-1')).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('bulkRevokeSessions', () => {
  const userId = '00000000-0000-0000-0000-000000000001';
  const adminId = '00000000-0000-0000-0000-000000000099';

  it('deletes all sessions for a user and returns count', async () => {
    let selectCall = 0;
    mocks.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) {
        // user exists check
        mocks.from.mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: userId }]),
          }),
        });
      } else {
        // count sessions
        mocks.from.mockReturnValue({
          where: vi.fn().mockResolvedValue([{ total: 3 }]),
        });
      }
      return { from: mocks.from };
    });

    mocks.delete.mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });

    const events: string[] = [];
    eventBus.subscribe(ADMIN_EVENTS.SESSIONS_BULK_REVOKED, (e) => {
      events.push(e.eventName);
    });

    const result = await bulkRevokeSessions(db, eventBus, userId, adminId);

    expect(result.revoked).toBe(3);
    expect(events).toContain(ADMIN_EVENTS.SESSIONS_BULK_REVOKED);
  });

  it('returns count of revoked sessions (zero when none)', async () => {
    let selectCall = 0;
    mocks.select.mockImplementation(() => {
      selectCall++;
      if (selectCall === 1) {
        mocks.from.mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: userId }]),
          }),
        });
      } else {
        mocks.from.mockReturnValue({
          where: vi.fn().mockResolvedValue([{ total: 0 }]),
        });
      }
      return { from: mocks.from };
    });

    mocks.delete.mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    });

    const result = await bulkRevokeSessions(db, eventBus, userId, adminId);

    expect(result.revoked).toBe(0);
  });

  it('throws NotFoundError when user does not exist', async () => {
    mocks.from.mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    });

    await expect(bulkRevokeSessions(db, eventBus, userId, adminId)).rejects.toThrow(NotFoundError);
  });
});
