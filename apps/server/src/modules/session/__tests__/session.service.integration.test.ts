import { sessions } from '@identity-starter/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type DomainEvent, InMemoryEventBus } from '../../../infra/event-bus.js';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';
import { makeCreateUserInput } from '../../user/__tests__/user.factory.js';
import { createUser } from '../../user/user.service.js';
import { SESSION_EVENTS } from '../session.events.js';
import {
  createSession,
  deleteExpiredSessions,
  revokeAllUserSessions,
  revokeSession,
  validateSession,
} from '../session.service.js';
import { makeCreateSessionInput } from './session.factory.js';

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

async function createTestUser() {
  return createUser(testDb.db, eventBus, makeCreateUserInput({ passwordHash: 'hash' }));
}

describe('createSession', () => {
  it('creates a session and returns it with all fields', async () => {
    const user = await createTestUser();
    const input = makeCreateSessionInput({
      userId: user.id,
      ipAddress: '10.0.0.1',
      userAgent: 'integration-test',
    });

    const session = await createSession(testDb.db, eventBus, input);

    expect(session.userId).toBe(user.id);
    expect(session.token).toBeDefined();
    expect(session.id).toBeDefined();
    expect(session.expiresAt).toBeInstanceOf(Date);
    expect(session.lastActiveAt).toBeInstanceOf(Date);
    expect(session.createdAt).toBeInstanceOf(Date);
    expect(session.ipAddress).toBe('10.0.0.1');
    expect(session.userAgent).toBe('integration-test');
  });

  it('generates a base64url token', async () => {
    const user = await createTestUser();
    const session = await createSession(
      testDb.db,
      eventBus,
      makeCreateSessionInput({ userId: user.id }),
    );

    expect(session.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(session.token.length).toBeGreaterThan(0);
  });

  it('sets expiresAt in the future', async () => {
    const user = await createTestUser();
    const before = Date.now();
    const session = await createSession(
      testDb.db,
      eventBus,
      makeCreateSessionInput({ userId: user.id }),
    );

    expect(session.expiresAt.getTime()).toBeGreaterThan(before);
  });

  it('publishes SESSION_EVENTS.CREATED event', async () => {
    const user = await createTestUser();
    const events: DomainEvent[] = [];
    eventBus.subscribe(SESSION_EVENTS.CREATED, (event) => {
      events.push(event);
    });

    const session = await createSession(
      testDb.db,
      eventBus,
      makeCreateSessionInput({ userId: user.id }),
    );

    expect(events).toHaveLength(1);
    expect(events[0].eventName).toBe(SESSION_EVENTS.CREATED);
    expect(events[0].payload).toEqual({ session });
  });

  it('stores optional ipAddress and userAgent', async () => {
    const user = await createTestUser();
    const session = await createSession(
      testDb.db,
      eventBus,
      makeCreateSessionInput({
        userId: user.id,
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
      }),
    );

    expect(session.ipAddress).toBe('192.168.1.1');
    expect(session.userAgent).toBe('Mozilla/5.0');
  });
});

describe('validateSession', () => {
  it('returns session for valid token', async () => {
    const user = await createTestUser();
    const created = await createSession(
      testDb.db,
      eventBus,
      makeCreateSessionInput({ userId: user.id }),
    );

    const session = await validateSession(testDb.db, created.token);

    expect(session).not.toBeNull();
    expect(session?.id).toBe(created.id);
    expect(session?.userId).toBe(user.id);
  });

  it('returns null for non-existent token', async () => {
    const session = await validateSession(testDb.db, 'non-existent-token-value');
    expect(session).toBeNull();
  });

  it('returns null for expired session (create session, then manually update expires_at to past)', async () => {
    const user = await createTestUser();
    const created = await createSession(
      testDb.db,
      eventBus,
      makeCreateSessionInput({ userId: user.id }),
    );

    await testDb.db
      .update(sessions)
      .set({ expiresAt: new Date(0) })
      .where(eq(sessions.id, created.id));

    const session = await validateSession(testDb.db, created.token);
    expect(session).toBeNull();
  });

  it('updates lastActiveAt on validation', async () => {
    const user = await createTestUser();
    const created = await createSession(
      testDb.db,
      eventBus,
      makeCreateSessionInput({ userId: user.id }),
    );

    await testDb.db
      .update(sessions)
      .set({ lastActiveAt: new Date(0) })
      .where(eq(sessions.id, created.id));

    const validated = await validateSession(testDb.db, created.token);

    expect(validated).not.toBeNull();
    expect(validated?.lastActiveAt.getTime()).toBeGreaterThan(new Date(0).getTime());
  });
});

describe('revokeSession', () => {
  it('deletes the session from DB', async () => {
    const user = await createTestUser();
    const created = await createSession(
      testDb.db,
      eventBus,
      makeCreateSessionInput({ userId: user.id }),
    );

    await revokeSession(testDb.db, eventBus, created.id);

    const session = await validateSession(testDb.db, created.token);
    expect(session).toBeNull();
  });

  it('publishes SESSION_EVENTS.REVOKED event with sessionId and userId', async () => {
    const user = await createTestUser();
    const created = await createSession(
      testDb.db,
      eventBus,
      makeCreateSessionInput({ userId: user.id }),
    );
    const events: DomainEvent[] = [];
    eventBus.subscribe(SESSION_EVENTS.REVOKED, (event) => {
      events.push(event);
    });

    await revokeSession(testDb.db, eventBus, created.id);

    expect(events).toHaveLength(1);
    expect(events[0].eventName).toBe(SESSION_EVENTS.REVOKED);
    expect(events[0].payload).toEqual({ sessionId: created.id, userId: user.id });
  });

  it('silently returns for non-existent session id (idempotent)', async () => {
    const events: DomainEvent[] = [];
    eventBus.subscribe(SESSION_EVENTS.REVOKED, (event) => {
      events.push(event);
    });

    await expect(
      revokeSession(testDb.db, eventBus, '00000000-0000-0000-0000-000000000000'),
    ).resolves.toBeUndefined();

    expect(events).toHaveLength(0);
  });
});

describe('revokeAllUserSessions', () => {
  it('deletes all sessions for a user', async () => {
    const user = await createTestUser();
    await createSession(testDb.db, eventBus, makeCreateSessionInput({ userId: user.id }));
    await createSession(testDb.db, eventBus, makeCreateSessionInput({ userId: user.id }));

    await revokeAllUserSessions(testDb.db, eventBus, user.id);

    const remaining = await testDb.db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(remaining).toHaveLength(0);
  });

  it('publishes REVOKED event for each session', async () => {
    const user = await createTestUser();
    const s1 = await createSession(
      testDb.db,
      eventBus,
      makeCreateSessionInput({ userId: user.id }),
    );
    const s2 = await createSession(
      testDb.db,
      eventBus,
      makeCreateSessionInput({ userId: user.id }),
    );
    const events: DomainEvent[] = [];
    eventBus.subscribe(SESSION_EVENTS.REVOKED, (event) => {
      events.push(event);
    });

    await revokeAllUserSessions(testDb.db, eventBus, user.id);

    expect(events).toHaveLength(2);
    const payloads = events
      .map((e) => e.payload as { sessionId: string; userId: string })
      .sort((a, b) => a.sessionId.localeCompare(b.sessionId));
    expect(payloads).toEqual(
      [
        { sessionId: s1.id, userId: user.id },
        { sessionId: s2.id, userId: user.id },
      ].sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
    );
  });

  it('silently returns when user has no sessions', async () => {
    const user = await createTestUser();
    const events: DomainEvent[] = [];
    eventBus.subscribe(SESSION_EVENTS.REVOKED, (event) => {
      events.push(event);
    });

    await expect(revokeAllUserSessions(testDb.db, eventBus, user.id)).resolves.toBeUndefined();

    expect(events).toHaveLength(0);
  });
});

describe('deleteExpiredSessions', () => {
  it('deletes expired sessions and returns count', async () => {
    const user = await createTestUser();
    const created = await createSession(
      testDb.db,
      eventBus,
      makeCreateSessionInput({ userId: user.id }),
    );

    await testDb.db
      .update(sessions)
      .set({ expiresAt: new Date(0) })
      .where(eq(sessions.id, created.id));

    const count = await deleteExpiredSessions(testDb.db);

    expect(count).toBeGreaterThanOrEqual(1);
    const session = await validateSession(testDb.db, created.token);
    expect(session).toBeNull();
  });

  it('returns 0 when no expired sessions exist', async () => {
    await deleteExpiredSessions(testDb.db);
    const user = await createTestUser();
    await createSession(testDb.db, eventBus, makeCreateSessionInput({ userId: user.id }));

    const count = await deleteExpiredSessions(testDb.db);

    expect(count).toBe(0);
  });
});
