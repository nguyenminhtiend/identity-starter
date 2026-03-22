import { NotFoundError, UnauthorizedError } from '@identity-starter/core';
import { passkeys, users, webauthnChallenges } from '@identity-starter/db';
import type {
  VerifiedAuthenticationResponse,
  VerifiedRegistrationResponse,
} from '@simplewebauthn/server';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type DomainEvent, InMemoryEventBus } from '../../../infra/event-bus.js';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';
import { PASSKEY_EVENTS } from '../passkey.events.js';
import { makeAuthenticationResponse, makeRegistrationResponse } from './passkey.factory.js';

vi.mock('@simplewebauthn/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simplewebauthn/server')>();
  return {
    ...actual,
    generateRegistrationOptions: vi.fn(),
    verifyRegistrationResponse: vi.fn(),
    generateAuthenticationOptions: vi.fn(),
    verifyAuthenticationResponse: vi.fn(),
  };
});

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import {
  deleteExpiredChallenges,
  generatePasskeyAuthenticationOptions,
  generatePasskeyRegistrationOptions,
  verifyPasskeyAuthentication,
  verifyPasskeyRegistration,
} from '../passkey.service.js';

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
  vi.mocked(generateRegistrationOptions).mockReset();
  vi.mocked(verifyRegistrationResponse).mockReset();
  vi.mocked(generateAuthenticationOptions).mockReset();
  vi.mocked(verifyAuthenticationResponse).mockReset();
});

async function createTestUser(email?: string) {
  const [row] = await testDb.db
    .insert(users)
    .values({
      email: email ?? `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
      displayName: 'Test User',
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$fake',
      status: 'active',
    })
    .returning();
  return row;
}

describe('generatePasskeyRegistrationOptions', () => {
  it('generates options and stores challenge in DB', async () => {
    const user = await createTestUser();
    vi.mocked(generateRegistrationOptions).mockResolvedValue({
      challenge: 'test-reg-challenge',
      rp: { name: 'Test', id: 'localhost' },
      user: { id: user.id, name: user.email, displayName: 'Test User' },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      timeout: 60000,
      attestation: 'none',
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    });

    const options = await generatePasskeyRegistrationOptions(testDb.db, user.id);

    expect(options.challenge).toBe('test-reg-challenge');

    const [stored] = await testDb.db
      .select()
      .from(webauthnChallenges)
      .where(eq(webauthnChallenges.challenge, 'test-reg-challenge'))
      .limit(1);

    expect(stored).toBeDefined();
    expect(stored.userId).toBe(user.id);
    expect(stored.type).toBe('registration');
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('throws NotFoundError for non-existent user', async () => {
    await expect(
      generatePasskeyRegistrationOptions(testDb.db, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow(NotFoundError);
  });

  it('excludes existing credentials', async () => {
    const user = await createTestUser();
    await testDb.db.insert(passkeys).values({
      userId: user.id,
      credentialId: 'existing-cred-id',
      publicKey: new Uint8Array([1, 2, 3]),
      counter: 0,
      deviceType: 'multiDevice',
      backedUp: false,
      transports: ['internal'],
    });

    vi.mocked(generateRegistrationOptions).mockResolvedValue({
      challenge: `exclude-test-${Date.now()}`,
      rp: { name: 'Test', id: 'localhost' },
      user: { id: user.id, name: user.email, displayName: 'Test User' },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
    });

    await generatePasskeyRegistrationOptions(testDb.db, user.id);

    expect(vi.mocked(generateRegistrationOptions)).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeCredentials: expect.arrayContaining([
          expect.objectContaining({ id: 'existing-cred-id' }),
        ]),
      }),
    );
  });
});

describe('verifyPasskeyRegistration', () => {
  it('stores credential and emits event on success', async () => {
    const user = await createTestUser();
    const challenge = `reg-verify-${Date.now()}`;

    await testDb.db.insert(webauthnChallenges).values({
      userId: user.id,
      challenge,
      type: 'registration',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    vi.mocked(verifyRegistrationResponse).mockResolvedValue({
      verified: true,
      registrationInfo: {
        fmt: 'none',
        counter: 0,
        aaguid: '00000000-0000-0000-0000-000000000000',
        credential: {
          id: `new-cred-${Date.now()}`,
          publicKey: new Uint8Array([1, 2, 3, 4, 5]),
          counter: 0,
          transports: ['internal'],
        },
        credentialType: 'public-key',
        attestationObject: new Uint8Array(),
        userVerified: true,
        credentialDeviceType: 'multiDevice',
        credentialBackedUp: true,
        rpIdHash: new Uint8Array(),
        origin: 'http://localhost:3000',
        authenticatorExtensionResults: undefined,
      },
    } as VerifiedRegistrationResponse);

    const events: DomainEvent[] = [];
    eventBus.subscribe(PASSKEY_EVENTS.REGISTERED, (event) => {
      events.push(event);
    });

    const result = await verifyPasskeyRegistration(
      testDb.db,
      eventBus,
      user.id,
      makeRegistrationResponse(),
    );

    expect(result.passkeyId).toBeDefined();

    const [stored] = await testDb.db
      .select()
      .from(passkeys)
      .where(eq(passkeys.id, result.passkeyId))
      .limit(1);

    expect(stored).toBeDefined();
    expect(stored.userId).toBe(user.id);
    expect(stored.deviceType).toBe('multiDevice');
    expect(stored.backedUp).toBe(true);
    expect(stored.aaguid).toBe('00000000-0000-0000-0000-000000000000');

    expect(events).toHaveLength(1);
    expect(events[0].payload).toEqual({ passkeyId: result.passkeyId, userId: user.id });
  });

  it('deletes consumed challenge after verification', async () => {
    const user = await createTestUser();
    const challenge = `consumed-${Date.now()}`;

    const [inserted] = await testDb.db
      .insert(webauthnChallenges)
      .values({
        userId: user.id,
        challenge,
        type: 'registration',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      })
      .returning();

    vi.mocked(verifyRegistrationResponse).mockResolvedValue({
      verified: true,
      registrationInfo: {
        fmt: 'none',
        counter: 0,
        aaguid: '00000000-0000-0000-0000-000000000000',
        credential: {
          id: `consumed-cred-${Date.now()}`,
          publicKey: new Uint8Array([10, 20]),
          counter: 0,
        },
        credentialType: 'public-key',
        attestationObject: new Uint8Array(),
        userVerified: true,
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        rpIdHash: new Uint8Array(),
        origin: 'http://localhost:3000',
        authenticatorExtensionResults: undefined,
      },
    } as VerifiedRegistrationResponse);

    await verifyPasskeyRegistration(testDb.db, eventBus, user.id, makeRegistrationResponse());

    const [remaining] = await testDb.db
      .select()
      .from(webauthnChallenges)
      .where(eq(webauthnChallenges.id, inserted.id))
      .limit(1);

    expect(remaining).toBeUndefined();
  });

  it('throws UnauthorizedError when no challenge found', async () => {
    const user = await createTestUser();

    await expect(
      verifyPasskeyRegistration(testDb.db, eventBus, user.id, makeRegistrationResponse()),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError when challenge is expired', async () => {
    const user = await createTestUser();

    await testDb.db.insert(webauthnChallenges).values({
      userId: user.id,
      challenge: `expired-${Date.now()}`,
      type: 'registration',
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(
      verifyPasskeyRegistration(testDb.db, eventBus, user.id, makeRegistrationResponse()),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError when verification fails', async () => {
    const user = await createTestUser();

    await testDb.db.insert(webauthnChallenges).values({
      userId: user.id,
      challenge: `fail-verify-${Date.now()}`,
      type: 'registration',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    vi.mocked(verifyRegistrationResponse).mockResolvedValue({
      verified: false,
      registrationInfo: undefined,
    } as VerifiedRegistrationResponse);

    await expect(
      verifyPasskeyRegistration(testDb.db, eventBus, user.id, makeRegistrationResponse()),
    ).rejects.toThrow(UnauthorizedError);
  });
});

describe('generatePasskeyAuthenticationOptions', () => {
  it('generates options and stores challenge in DB with null userId', async () => {
    vi.mocked(generateAuthenticationOptions).mockResolvedValue({
      challenge: 'test-auth-challenge',
      rpId: 'localhost',
      timeout: 60000,
      userVerification: 'required',
    });

    const options = await generatePasskeyAuthenticationOptions(testDb.db);

    expect(options.challenge).toBe('test-auth-challenge');

    const [stored] = await testDb.db
      .select()
      .from(webauthnChallenges)
      .where(eq(webauthnChallenges.challenge, 'test-auth-challenge'))
      .limit(1);

    expect(stored).toBeDefined();
    expect(stored.userId).toBeNull();
    expect(stored.type).toBe('authentication');
  });
});

describe('verifyPasskeyAuthentication', () => {
  it('verifies authentication, updates counter, and creates session', async () => {
    const user = await createTestUser();
    const credId = `auth-cred-${Date.now()}`;
    const challenge = `auth-challenge-${Date.now()}`;

    await testDb.db.insert(passkeys).values({
      userId: user.id,
      credentialId: credId,
      publicKey: new Uint8Array([1, 2, 3, 4]),
      counter: 5,
      deviceType: 'multiDevice',
      backedUp: true,
      transports: ['internal'],
    });

    await testDb.db.insert(webauthnChallenges).values({
      challenge,
      type: 'authentication',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    vi.mocked(verifyAuthenticationResponse).mockImplementation(async (opts) => {
      const challengeFn = opts.expectedChallenge;
      if (typeof challengeFn === 'function') {
        await challengeFn(challenge);
      }
      return {
        verified: true,
        authenticationInfo: {
          newCounter: 6,
          credentialID: credId,
          userVerified: true,
          credentialDeviceType: 'multiDevice',
          credentialBackedUp: true,
          origin: 'http://localhost:3000',
          rpID: 'localhost',
          authenticatorExtensionResults: undefined,
        },
      } as VerifiedAuthenticationResponse;
    });

    const result = await verifyPasskeyAuthentication(
      testDb.db,
      eventBus,
      makeAuthenticationResponse({ id: credId }),
      { ipAddress: '127.0.0.1', userAgent: 'vitest' },
    );

    expect(result.token).toBeDefined();
    expect(result.user.id).toBe(user.id);
    expect(result.user.email).toBe(user.email);

    const [updated] = await testDb.db
      .select()
      .from(passkeys)
      .where(eq(passkeys.credentialId, credId))
      .limit(1);

    expect(updated.counter).toBe(6);
  });

  it('throws UnauthorizedError when passkey not found', async () => {
    await expect(
      verifyPasskeyAuthentication(
        testDb.db,
        eventBus,
        makeAuthenticationResponse({ id: 'nonexistent' }),
        {},
      ),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError when verification fails', async () => {
    const user = await createTestUser();
    const credId = `fail-auth-${Date.now()}`;

    await testDb.db.insert(passkeys).values({
      userId: user.id,
      credentialId: credId,
      publicKey: new Uint8Array([1, 2, 3]),
      counter: 0,
      deviceType: 'singleDevice',
      backedUp: false,
    });

    vi.mocked(verifyAuthenticationResponse).mockResolvedValue({
      verified: false,
      authenticationInfo: {
        newCounter: 0,
        credentialID: credId,
        userVerified: false,
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
        origin: 'http://localhost:3000',
        rpID: 'localhost',
        authenticatorExtensionResults: undefined,
      },
    } as VerifiedAuthenticationResponse);

    await expect(
      verifyPasskeyAuthentication(
        testDb.db,
        eventBus,
        makeAuthenticationResponse({ id: credId }),
        {},
      ),
    ).rejects.toThrow(UnauthorizedError);
  });

  it('supports multiple passkeys per user', async () => {
    const user = await createTestUser();
    const credId1 = `multi-1-${Date.now()}`;
    const credId2 = `multi-2-${Date.now()}`;
    const challenge = `multi-challenge-${Date.now()}`;

    await testDb.db.insert(passkeys).values([
      {
        userId: user.id,
        credentialId: credId1,
        publicKey: new Uint8Array([1, 2]),
        counter: 0,
        deviceType: 'multiDevice',
        backedUp: true,
      },
      {
        userId: user.id,
        credentialId: credId2,
        publicKey: new Uint8Array([3, 4]),
        counter: 0,
        deviceType: 'singleDevice',
        backedUp: false,
      },
    ]);

    await testDb.db.insert(webauthnChallenges).values({
      challenge,
      type: 'authentication',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    vi.mocked(verifyAuthenticationResponse).mockImplementation(async (opts) => {
      const challengeFn = opts.expectedChallenge;
      if (typeof challengeFn === 'function') {
        await challengeFn(challenge);
      }
      return {
        verified: true,
        authenticationInfo: {
          newCounter: 1,
          credentialID: credId2,
          userVerified: true,
          credentialDeviceType: 'singleDevice',
          credentialBackedUp: false,
          origin: 'http://localhost:3000',
          rpID: 'localhost',
          authenticatorExtensionResults: undefined,
        },
      } as VerifiedAuthenticationResponse;
    });

    const result = await verifyPasskeyAuthentication(
      testDb.db,
      eventBus,
      makeAuthenticationResponse({ id: credId2 }),
      {},
    );

    expect(result.user.id).toBe(user.id);
  });
});

describe('deleteExpiredChallenges', () => {
  it('deletes expired challenges and returns count', async () => {
    await testDb.db.insert(webauthnChallenges).values([
      {
        challenge: `expired-cleanup-1-${Date.now()}`,
        type: 'registration',
        expiresAt: new Date(Date.now() - 10_000),
      },
      {
        challenge: `expired-cleanup-2-${Date.now()}`,
        type: 'authentication',
        expiresAt: new Date(Date.now() - 5_000),
      },
    ]);

    const before = await testDb.db
      .select({ count: sql<number>`count(*)::int` })
      .from(webauthnChallenges);

    const deleted = await deleteExpiredChallenges(testDb.db);

    expect(deleted).toBeGreaterThanOrEqual(2);

    const after = await testDb.db
      .select({ count: sql<number>`count(*)::int` })
      .from(webauthnChallenges);

    expect(after[0].count).toBeLessThan(before[0].count);
  });

  it('does not delete non-expired challenges', async () => {
    const challenge = `not-expired-${Date.now()}`;
    await testDb.db.insert(webauthnChallenges).values({
      challenge,
      type: 'authentication',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    await deleteExpiredChallenges(testDb.db);

    const [remaining] = await testDb.db
      .select()
      .from(webauthnChallenges)
      .where(eq(webauthnChallenges.challenge, challenge))
      .limit(1);

    expect(remaining).toBeDefined();
  });
});
