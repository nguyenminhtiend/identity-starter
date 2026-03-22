import assert from 'node:assert';
import { ConflictError, UnauthorizedError } from '@identity-starter/core';
import { users } from '@identity-starter/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DomainEvent, InMemoryEventBus } from '../../../infra/event-bus.js';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';
import { validateSession } from '../../session/session.service.js';
import { AUTH_EVENTS } from '../auth.events.js';
import { changePassword, login, logout, register } from '../auth.service.js';
import { makeRegisterInput } from './auth.factory.js';

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

describe('register', () => {
  it('creates user and returns token + user', async () => {
    const input = makeRegisterInput();
    const result = await register(testDb.db, eventBus, input);

    expect(result.token).toBeDefined();
    expect(result.token.length).toBeGreaterThan(0);
    expect(result.verificationToken).toBeDefined();
    expect(result.verificationToken?.length).toBeGreaterThan(0);
    expect(result.user.email).toBe(input.email);
    expect(result.user.displayName).toBe(input.displayName);
    expect(result.user.id).toBeDefined();
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('hashes the password (not stored as plaintext)', async () => {
    const input = makeRegisterInput();
    await register(testDb.db, eventBus, input);

    const [row] = await testDb.db.select().from(users).where(eq(users.email, input.email)).limit(1);
    expect(row.passwordHash).not.toBe(input.password);
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('publishes REGISTERED event', async () => {
    const events: DomainEvent[] = [];
    eventBus.subscribe(AUTH_EVENTS.REGISTERED, (event) => {
      events.push(event);
    });

    const input = makeRegisterInput();
    const result = await register(testDb.db, eventBus, input);

    expect(events).toHaveLength(1);
    expect(events[0].eventName).toBe(AUTH_EVENTS.REGISTERED);
    expect(events[0].payload).toEqual({ userId: result.user.id });
  });

  it('throws ConflictError on duplicate email', async () => {
    const input = makeRegisterInput();
    await register(testDb.db, eventBus, input);

    await expect(register(testDb.db, eventBus, input)).rejects.toThrow(ConflictError);
  });
});

describe('login', () => {
  it('returns token and user for valid credentials', async () => {
    const input = makeRegisterInput();
    await register(testDb.db, eventBus, input);

    const result = await login(
      testDb.db,
      eventBus,
      { email: input.email, password: input.password },
      { ipAddress: '127.0.0.1', userAgent: 'vitest' },
    );

    expect('token' in result && result.token).toBeDefined();
    expect('user' in result && result.user.email).toBe(input.email);
    expect('user' in result && result.user).not.toHaveProperty('passwordHash');
  });

  it('publishes LOGIN event', async () => {
    const events: DomainEvent[] = [];
    eventBus.subscribe(AUTH_EVENTS.LOGIN, (event) => {
      events.push(event);
    });

    const input = makeRegisterInput();
    const registered = await register(testDb.db, eventBus, input);

    await login(
      testDb.db,
      eventBus,
      { email: input.email, password: input.password },
      { ipAddress: '127.0.0.1' },
    );

    expect(events).toHaveLength(1);
    expect(events[0].payload).toEqual({ userId: registered.user.id });
  });

  it('throws UnauthorizedError for wrong password', async () => {
    const input = makeRegisterInput();
    await register(testDb.db, eventBus, input);

    await expect(
      login(
        testDb.db,
        eventBus,
        { email: input.email, password: 'wrong-password' },
        { ipAddress: '127.0.0.1' },
      ),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('publishes FAILED_LOGIN event on wrong password', async () => {
    const events: DomainEvent[] = [];
    eventBus.subscribe(AUTH_EVENTS.FAILED_LOGIN, (event) => {
      events.push(event);
    });

    const input = makeRegisterInput();
    await register(testDb.db, eventBus, input);

    await login(
      testDb.db,
      eventBus,
      { email: input.email, password: 'wrong' },
      { ipAddress: '127.0.0.1' },
    ).catch(() => {});

    expect(events).toHaveLength(1);
    expect(events[0].payload).toEqual({
      email: input.email,
      reason: 'invalid_credentials',
    });
  });

  it('throws UnauthorizedError for non-existent email', async () => {
    await expect(
      login(
        testDb.db,
        eventBus,
        { email: 'nonexistent@example.com', password: 'anything' },
        { ipAddress: '127.0.0.1' },
      ),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError for suspended account', async () => {
    const input = makeRegisterInput();
    const result = await register(testDb.db, eventBus, input);

    await testDb.db.update(users).set({ status: 'suspended' }).where(eq(users.id, result.user.id));

    await expect(
      login(
        testDb.db,
        eventBus,
        { email: input.email, password: input.password },
        { ipAddress: '127.0.0.1' },
      ),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('applies progressive delay after five failed logins', async () => {
    const input = makeRegisterInput();
    await register(testDb.db, eventBus, input);

    for (let step = 0; step < 5; step += 1) {
      await login(
        testDb.db,
        eventBus,
        { email: input.email, password: 'wrong-password' },
        { ipAddress: '127.0.0.1' },
      ).catch(() => {});
    }

    const originalSetTimeout = globalThis.setTimeout.bind(globalThis);
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        if (timeout === 1000 && typeof handler === 'function') {
          (handler as (...a: unknown[]) => void)(...args);
          return 0 as unknown as ReturnType<typeof setTimeout>;
        }
        return originalSetTimeout(handler, timeout ?? 0, ...(args as []));
      });

    try {
      await expect(
        login(
          testDb.db,
          eventBus,
          { email: input.email, password: 'wrong-password' },
          { ipAddress: '127.0.0.1' },
        ),
      ).rejects.toThrow(UnauthorizedError);

      expect(setTimeoutSpy).toHaveBeenCalled();
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });
});

describe('logout', () => {
  it('revokes session and publishes LOGOUT event', async () => {
    const events: DomainEvent[] = [];
    eventBus.subscribe(AUTH_EVENTS.LOGOUT, (event) => {
      events.push(event);
    });

    const input = makeRegisterInput();
    const result = await register(testDb.db, eventBus, input);

    const session = await validateSession(testDb.db, result.token);
    expect(session).not.toBeNull();

    await logout(testDb.db, eventBus, session?.id ?? '', result.user.id);

    expect(events).toHaveLength(1);
    expect(events[0].eventName).toBe(AUTH_EVENTS.LOGOUT);
  });
});

describe('changePassword', () => {
  it('changes password and allows login with new password', async () => {
    const input = makeRegisterInput();
    const result = await register(testDb.db, eventBus, input);

    const session = await validateSession(testDb.db, result.token);
    assert(session);
    await changePassword(testDb.db, eventBus, result.user.id, session.id, {
      currentPassword: input.password,
      newPassword: 'brand-new-pass-123',
    });

    const loginResult = await login(
      testDb.db,
      eventBus,
      { email: input.email, password: 'brand-new-pass-123' },
      { ipAddress: '127.0.0.1' },
    );

    expect('token' in loginResult && loginResult.token).toBeDefined();
  });

  it('rejects login with old password after change', async () => {
    const input = makeRegisterInput();
    const result = await register(testDb.db, eventBus, input);

    const session2 = await validateSession(testDb.db, result.token);
    assert(session2);
    await changePassword(testDb.db, eventBus, result.user.id, session2.id, {
      currentPassword: input.password,
      newPassword: 'brand-new-pass-456',
    });

    await expect(
      login(
        testDb.db,
        eventBus,
        { email: input.email, password: input.password },
        { ipAddress: '127.0.0.1' },
      ),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError if current password is wrong', async () => {
    const input = makeRegisterInput();
    const result = await register(testDb.db, eventBus, input);

    await expect(
      changePassword(testDb.db, eventBus, result.user.id, 'fake-session-id', {
        currentPassword: 'wrong-password',
        newPassword: 'new-password-123',
      }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('publishes PASSWORD_CHANGED event', async () => {
    const events: DomainEvent[] = [];
    eventBus.subscribe(AUTH_EVENTS.PASSWORD_CHANGED, (event) => {
      events.push(event);
    });

    const input = makeRegisterInput();
    const result = await register(testDb.db, eventBus, input);

    const session3 = await validateSession(testDb.db, result.token);
    assert(session3);
    await changePassword(testDb.db, eventBus, result.user.id, session3.id, {
      currentPassword: input.password,
      newPassword: 'another-new-pass',
    });

    expect(events).toHaveLength(1);
    expect(events[0].payload).toEqual({ userId: result.user.id });
  });
});
