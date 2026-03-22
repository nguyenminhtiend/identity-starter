import { UnauthorizedError } from '@identity-starter/core';
import { passwordResetTokens } from '@identity-starter/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type DomainEvent, InMemoryEventBus } from '../../../infra/event-bus.js';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';
import { validateSession } from '../../session/session.service.js';
import { AUTH_EVENTS } from '../auth.events.js';
import { login, register } from '../auth.service.js';
import {
  createPasswordResetService,
  requestPasswordReset,
  resetPassword,
} from '../password-reset.service.js';
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

describe('createPasswordResetService', () => {
  it('delegates to requestPasswordReset and resetPassword', async () => {
    const input = makeRegisterInput();
    await register(testDb.db, eventBus, input);

    const svc = createPasswordResetService({ db: testDb.db, eventBus });
    const token = await svc.requestReset(input.email);
    expect(token).toBeTruthy();

    await svc.reset({ token: token ?? '', newPassword: 'reset-flow-pass-99' });

    const loggedIn = await login(
      testDb.db,
      eventBus,
      { email: input.email, password: 'reset-flow-pass-99' },
      {},
    );
    expect('token' in loggedIn && loggedIn.token).toBeDefined();
  });
});

describe('password reset lifecycle', () => {
  it('register → request reset → reset password → old session invalid → login with new password', async () => {
    const input = makeRegisterInput();
    const reg = await register(testDb.db, eventBus, input);
    const oldToken = reg.token;

    const sessionBefore = await validateSession(testDb.db, oldToken);
    expect(sessionBefore).not.toBeNull();

    const resetToken = await requestPasswordReset(testDb.db, eventBus, input.email);
    expect(resetToken).toBeTruthy();

    await resetPassword(testDb.db, eventBus, {
      token: resetToken ?? '',
      newPassword: 'brand-new-after-reset-88',
    });

    const sessionAfter = await validateSession(testDb.db, oldToken);
    expect(sessionAfter).toBeNull();

    const loginResult = await login(
      testDb.db,
      eventBus,
      { email: input.email, password: 'brand-new-after-reset-88' },
      { ipAddress: '127.0.0.1' },
    );

    expect('token' in loginResult && loginResult.token).toBeDefined();
    expect('user' in loginResult && loginResult.user.email).toBe(input.email);
  });

  it('publishes PASSWORD_RESET_REQUESTED and PASSWORD_RESET_COMPLETED', async () => {
    const events: DomainEvent[] = [];
    eventBus.subscribe(AUTH_EVENTS.PASSWORD_RESET_REQUESTED, (e) => {
      events.push(e);
    });
    eventBus.subscribe(AUTH_EVENTS.PASSWORD_RESET_COMPLETED, (e) => {
      events.push(e);
    });

    const input = makeRegisterInput();
    const reg = await register(testDb.db, eventBus, input);

    const resetToken = await requestPasswordReset(testDb.db, eventBus, input.email);
    await resetPassword(testDb.db, eventBus, {
      token: resetToken ?? '',
      newPassword: 'event-test-pass-77',
    });

    const requested = events.filter((e) => e.eventName === AUTH_EVENTS.PASSWORD_RESET_REQUESTED);
    const completed = events.filter((e) => e.eventName === AUTH_EVENTS.PASSWORD_RESET_COMPLETED);

    expect(requested).toHaveLength(1);
    expect(completed).toHaveLength(1);
    expect(requested[0].payload).toMatchObject({
      userId: reg.user.id,
      email: input.email,
      token: resetToken,
    });
    expect(completed[0].payload).toEqual({ userId: reg.user.id });
  });

  it('rejects second reset with same token', async () => {
    const input = makeRegisterInput();
    await register(testDb.db, eventBus, input);

    const resetToken = await requestPasswordReset(testDb.db, eventBus, input.email);
    await resetPassword(testDb.db, eventBus, {
      token: resetToken ?? '',
      newPassword: 'first-reset-pass-66',
    });

    await expect(
      resetPassword(testDb.db, eventBus, {
        token: resetToken ?? '',
        newPassword: 'second-reset-pass-66',
      }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('stops issuing tokens after three unused requests in one hour', async () => {
    const input = makeRegisterInput();
    const reg = await register(testDb.db, eventBus, input);

    const t1 = await requestPasswordReset(testDb.db, eventBus, input.email);
    const t2 = await requestPasswordReset(testDb.db, eventBus, input.email);
    const t3 = await requestPasswordReset(testDb.db, eventBus, input.email);
    const t4 = await requestPasswordReset(testDb.db, eventBus, input.email);

    expect(t1).toBeTruthy();
    expect(t2).toBeTruthy();
    expect(t3).toBeTruthy();
    expect(t4).toBeNull();

    const rows = await testDb.db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, reg.user.id));

    expect(rows.filter((r) => r.usedAt === null)).toHaveLength(3);
  });
});
