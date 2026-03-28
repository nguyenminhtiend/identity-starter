import assert from 'node:assert';
import { UnauthorizedError } from '@identity-starter/core';
import { emailVerificationTokens, users } from '@identity-starter/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type DomainEvent, InMemoryEventBus } from '../../../infra/event-bus.js';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';
import { AUTH_EVENTS } from '../auth.events.js';
import { register } from '../auth.service.js';
import {
  generateVerificationToken,
  resendVerification,
  resendVerificationForEmail,
  verifyEmail,
} from '../email-verification.service.js';
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

async function latestUnusedVerificationTokenForUser(userId: string): Promise<string> {
  const [row] = await testDb.db
    .select()
    .from(emailVerificationTokens)
    .where(and(eq(emailVerificationTokens.userId, userId), isNull(emailVerificationTokens.usedAt)))
    .orderBy(desc(emailVerificationTokens.createdAt))
    .limit(1);
  assert(row);
  return row.token;
}

describe('generateVerificationToken', () => {
  it('persists a token row with 24h expiry', async () => {
    const input = makeRegisterInput();
    const { user } = await register(testDb.db, eventBus, input);

    const token = await generateVerificationToken(testDb.db, user.id);
    expect(token.length).toBeGreaterThan(0);

    const [row] = await testDb.db
      .select()
      .from(emailVerificationTokens)
      .where(eq(emailVerificationTokens.token, token))
      .limit(1);

    expect(row).toBeDefined();
    expect(row.userId).toBe(user.id);
    expect(row.usedAt).toBeNull();
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 25 * 60 * 60 * 1000);
  });
});

describe('verifyEmail', () => {
  it('sets user active and verified and marks token used', async () => {
    const input = makeRegisterInput();
    const { user } = await register(testDb.db, eventBus, input);
    const verificationToken = await latestUnusedVerificationTokenForUser(user.id);

    await verifyEmail(testDb.db, eventBus, verificationToken);

    const [u] = await testDb.db.select().from(users).where(eq(users.id, user.id)).limit(1);
    expect(u.emailVerified).toBe(true);
    expect(u.status).toBe('active');

    const [tok] = await testDb.db
      .select()
      .from(emailVerificationTokens)
      .where(eq(emailVerificationTokens.token, verificationToken))
      .limit(1);
    expect(tok.usedAt).not.toBeNull();
  });

  it('publishes EMAIL_VERIFIED when pending user verifies', async () => {
    const events: DomainEvent[] = [];
    eventBus.subscribe(AUTH_EVENTS.EMAIL_VERIFIED, (e) => {
      events.push(e);
    });

    const input = makeRegisterInput();
    const { user } = await register(testDb.db, eventBus, input);
    const verificationToken = await latestUnusedVerificationTokenForUser(user.id);

    await verifyEmail(testDb.db, eventBus, verificationToken);

    expect(events).toHaveLength(1);
    expect(events[0].payload).toEqual({ userId: user.id });
  });

  it('rejects reuse of consumed token', async () => {
    const input = makeRegisterInput();
    const { user } = await register(testDb.db, eventBus, input);
    const verificationToken = await latestUnusedVerificationTokenForUser(user.id);

    await verifyEmail(testDb.db, eventBus, verificationToken);

    await expect(verifyEmail(testDb.db, eventBus, verificationToken)).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it('rejects unknown token', async () => {
    await expect(verifyEmail(testDb.db, eventBus, 'not-a-real-token')).rejects.toThrow(
      UnauthorizedError,
    );
  });
});

describe('resendVerification', () => {
  it('invalidates prior unused token and returns a new one', async () => {
    const input = makeRegisterInput();
    const { user } = await register(testDb.db, eventBus, input);
    const first = await latestUnusedVerificationTokenForUser(user.id);

    const second = await resendVerification(testDb.db, user.id);
    expect(second).not.toBe(first);

    await expect(verifyEmail(testDb.db, eventBus, first)).rejects.toThrow(UnauthorizedError);

    await verifyEmail(testDb.db, eventBus, second);
    const [u] = await testDb.db.select().from(users).where(eq(users.id, user.id)).limit(1);
    expect(u.status).toBe('active');
  });
});

describe('resendVerificationForEmail', () => {
  it('returns sent message for pending unverified user', async () => {
    const input = makeRegisterInput();
    await register(testDb.db, eventBus, input);

    const result = await resendVerificationForEmail(testDb.db, input.email);
    expect(result.message).toContain('sent');
    expect(result).not.toHaveProperty('verificationToken');
  });

  it('returns generic message without token for unknown email', async () => {
    const result = await resendVerificationForEmail(testDb.db, 'nobody@example.com');
    expect(result).not.toHaveProperty('verificationToken');
    expect(result.message).toContain('eligible');
  });
});
