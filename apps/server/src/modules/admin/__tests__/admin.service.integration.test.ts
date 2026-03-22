import { NotFoundError, ValidationError } from '@identity-starter/core';
import { roles, userRoles, users } from '@identity-starter/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type DomainEvent, InMemoryEventBus } from '../../../infra/event-bus.js';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';
import { seedSystemRoles } from '../../rbac/rbac.service.js';
import { createSession } from '../../session/session.service.js';
import { makeCreateUserInput } from '../../user/__tests__/user.factory.js';
import { createUser } from '../../user/user.service.js';
import { ADMIN_EVENTS } from '../admin.events.js';
import {
  bulkRevokeSessions,
  getUser,
  listSessions,
  listUsers,
  revokeSession,
  updateUserStatus,
} from '../admin.service.js';

let testDb: TestDb;
let eventBus: InMemoryEventBus;

beforeAll(async () => {
  testDb = await createTestDb();
  eventBus = new InMemoryEventBus();
  await seedSystemRoles(testDb.db);
});

afterAll(async () => {
  await testDb.teardown();
});

beforeEach(() => {
  eventBus = new InMemoryEventBus();
});

async function seedActiveUser() {
  const user = await createUser(testDb.db, eventBus, makeCreateUserInput());
  await testDb.db.update(users).set({ status: 'active' }).where(eq(users.id, user.id));
  return user;
}

async function assignAdminRole(userId: string) {
  const [adminRole] = await testDb.db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, 'admin'))
    .limit(1);
  await testDb.db.insert(userRoles).values({ userId, roleId: adminRole.id });
}

describe('listUsers', () => {
  it('returns paginated users', async () => {
    await seedActiveUser();
    const result = await listUsers(testDb.db, { page: 1, limit: 10 });
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.total).toBeGreaterThan(0);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(10);
  });

  it('filters by status', async () => {
    const user = await seedActiveUser();
    await testDb.db.update(users).set({ status: 'suspended' }).where(eq(users.id, user.id));

    const result = await listUsers(testDb.db, { page: 1, limit: 100, status: 'suspended' });
    expect(result.data.some((u) => u.id === user.id)).toBe(true);
    for (const u of result.data) {
      expect(u.status).toBe('suspended');
    }
  });

  it('filters by email partial match', async () => {
    const user = await seedActiveUser();
    const emailPart = user.email.split('@')[0];
    const result = await listUsers(testDb.db, { page: 1, limit: 100, email: emailPart });
    expect(result.data.some((u) => u.id === user.id)).toBe(true);
  });
});

describe('getUser', () => {
  it('returns user with roles', async () => {
    const user = await seedActiveUser();
    await assignAdminRole(user.id);

    const result = await getUser(testDb.db, user.id);
    expect(result.id).toBe(user.id);
    expect(result.roles).toHaveLength(1);
    expect(result.roles[0].name).toBe('admin');
  });

  it('throws NotFoundError for missing user', async () => {
    await expect(getUser(testDb.db, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('updateUserStatus', () => {
  it('suspends user and destroys sessions', async () => {
    const user = await seedActiveUser();
    const admin = await seedActiveUser();
    await createSession(testDb.db, eventBus, { userId: user.id });

    const collected: DomainEvent[] = [];
    eventBus.subscribe(ADMIN_EVENTS.USER_SUSPENDED, (e) => {
      collected.push(e);
    });

    const result = await updateUserStatus(
      testDb.db,
      eventBus,
      user.id,
      { status: 'suspended' },
      admin.id,
    );
    expect(result.status).toBe('suspended');
    expect(collected).toHaveLength(1);
  });

  it('activates suspended user', async () => {
    const user = await seedActiveUser();
    const admin = await seedActiveUser();
    await testDb.db.update(users).set({ status: 'suspended' }).where(eq(users.id, user.id));

    const collected: DomainEvent[] = [];
    eventBus.subscribe(ADMIN_EVENTS.USER_ACTIVATED, (e) => {
      collected.push(e);
    });

    const result = await updateUserStatus(
      testDb.db,
      eventBus,
      user.id,
      { status: 'active' },
      admin.id,
    );
    expect(result.status).toBe('active');
    expect(collected).toHaveLength(1);
  });

  it('prevents self-suspension', async () => {
    const admin = await seedActiveUser();
    await expect(
      updateUserStatus(testDb.db, eventBus, admin.id, { status: 'suspended' }, admin.id),
    ).rejects.toThrow(ValidationError);
  });
});

describe('listSessions + revokeSession', () => {
  it('lists sessions and revokes one', async () => {
    const user = await seedActiveUser();
    const admin = await seedActiveUser();
    const session = await createSession(testDb.db, eventBus, { userId: user.id });

    const list = await listSessions(testDb.db, { page: 1, limit: 100, userId: user.id });
    expect(list.data.some((s) => s.id === session.id)).toBe(true);

    const collected: DomainEvent[] = [];
    eventBus.subscribe(ADMIN_EVENTS.SESSION_REVOKED, (e) => {
      collected.push(e);
    });

    await revokeSession(testDb.db, eventBus, session.id, admin.id);
    expect(collected).toHaveLength(1);

    const after = await listSessions(testDb.db, { page: 1, limit: 100, userId: user.id });
    expect(after.data.some((s) => s.id === session.id)).toBe(false);
  });
});

describe('bulkRevokeSessions', () => {
  it('revokes all sessions for a user', async () => {
    const user = await seedActiveUser();
    const admin = await seedActiveUser();
    await createSession(testDb.db, eventBus, { userId: user.id });
    await createSession(testDb.db, eventBus, { userId: user.id });

    const result = await bulkRevokeSessions(testDb.db, eventBus, user.id, admin.id);
    expect(result.revoked).toBe(2);

    const after = await listSessions(testDb.db, { page: 1, limit: 100, userId: user.id });
    expect(after.total).toBe(0);
  });
});
