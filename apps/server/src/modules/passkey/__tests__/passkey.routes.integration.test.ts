import { passkeys, users, webauthnChallenges } from '@identity-starter/db';
import type {
  VerifiedAuthenticationResponse,
  VerifiedRegistrationResponse,
} from '@simplewebauthn/server';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp } from '../../../test/app-builder.js';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';
import { makeRegisterInput } from '../../auth/__tests__/auth.factory.js';
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

let testDb: TestDb;
let app: FastifyInstance;

beforeAll(async () => {
  testDb = await createTestDb();
  app = await buildTestApp({ db: testDb.db });
});

afterAll(async () => {
  await app.close();
  await testDb.teardown();
});

beforeEach(() => {
  vi.mocked(generateRegistrationOptions).mockReset();
  vi.mocked(verifyRegistrationResponse).mockReset();
  vi.mocked(generateAuthenticationOptions).mockReset();
  vi.mocked(verifyAuthenticationResponse).mockReset();
});

async function registerAndGetToken(): Promise<{ token: string; userId: string }> {
  const input = makeRegisterInput();
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: input,
  });
  const body = response.json();
  return { token: body.token, userId: body.user.id };
}

describe('POST /api/auth/passkeys/register/options', () => {
  it('returns 200 with registration options for authenticated user', async () => {
    const { token, userId } = await registerAndGetToken();

    vi.mocked(generateRegistrationOptions).mockResolvedValue({
      challenge: 'route-reg-challenge',
      rp: { name: 'Test', id: 'localhost' },
      user: { id: userId, name: 'test@test.com', displayName: 'Test' },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/passkeys/register/options',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.challenge).toBe('route-reg-challenge');
  });

  it('returns 401 without auth header', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/passkeys/register/options',
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('POST /api/auth/passkeys/register/verify', () => {
  it('returns 201 after successful registration', async () => {
    const { token, userId } = await registerAndGetToken();
    const challenge = `route-verify-${Date.now()}`;

    vi.mocked(generateRegistrationOptions).mockResolvedValue({
      challenge,
      rp: { name: 'Test', id: 'localhost' },
      user: { id: userId, name: 'test@test.com', displayName: 'Test' },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
    });

    await app.inject({
      method: 'POST',
      url: '/api/auth/passkeys/register/options',
      headers: { authorization: `Bearer ${token}` },
    });

    const credId = `route-cred-${Date.now()}`;
    vi.mocked(verifyRegistrationResponse).mockResolvedValue({
      verified: true,
      registrationInfo: {
        fmt: 'none',
        counter: 0,
        aaguid: '00000000-0000-0000-0000-000000000000',
        credential: {
          id: credId,
          publicKey: new Uint8Array([1, 2, 3]),
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

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/passkeys/register/verify',
      headers: { authorization: `Bearer ${token}` },
      payload: makeRegistrationResponse(),
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.passkeyId).toBeDefined();

    const [stored] = await testDb.db
      .select()
      .from(passkeys)
      .where(eq(passkeys.credentialId, credId))
      .limit(1);
    expect(stored).toBeDefined();
    expect(stored.userId).toBe(userId);
  });

  it('returns 401 without auth header', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/passkeys/register/verify',
      payload: makeRegistrationResponse(),
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns 400 on invalid body', async () => {
    const { token } = await registerAndGetToken();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/passkeys/register/verify',
      headers: { authorization: `Bearer ${token}` },
      payload: { id: 'incomplete' },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('POST /api/auth/passkeys/login/options', () => {
  it('returns 200 with authentication options (no auth required)', async () => {
    vi.mocked(generateAuthenticationOptions).mockResolvedValue({
      challenge: 'route-auth-challenge',
      rpId: 'localhost',
      timeout: 60000,
      userVerification: 'required',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/passkeys/login/options',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.challenge).toBe('route-auth-challenge');
  });
});

describe('POST /api/auth/passkeys/login/verify', () => {
  it('returns 200 with token and user after successful authentication', async () => {
    const { userId } = await registerAndGetToken();
    const credId = `login-cred-${Date.now()}`;
    const challenge = `login-challenge-${Date.now()}`;

    const [user] = await testDb.db.select().from(users).where(eq(users.id, userId)).limit(1);

    await testDb.db.insert(passkeys).values({
      userId,
      credentialId: credId,
      publicKey: new Uint8Array([1, 2, 3]),
      counter: 0,
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
          newCounter: 1,
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

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/passkeys/login/verify',
      payload: makeAuthenticationResponse({ id: credId }),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.token).toBeDefined();
    expect(body.user.id).toBe(userId);
    expect(body.user.email).toBe(user.email);
    expect(body.user).not.toHaveProperty('passwordHash');
  });

  it('returns 401 when passkey not found', async () => {
    vi.mocked(verifyAuthenticationResponse).mockResolvedValue({
      verified: false,
    } as VerifiedAuthenticationResponse);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/passkeys/login/verify',
      payload: makeAuthenticationResponse({ id: 'nonexistent-cred' }),
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns 400 on invalid body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/passkeys/login/verify',
      payload: { id: 'incomplete' },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('full passkey lifecycle', () => {
  it('register passkey → login with passkey → get session', async () => {
    const { token, userId } = await registerAndGetToken();
    const challenge1 = `lifecycle-reg-${Date.now()}`;
    const credId = `lifecycle-cred-${Date.now()}`;

    vi.mocked(generateRegistrationOptions).mockResolvedValue({
      challenge: challenge1,
      rp: { name: 'Test', id: 'localhost' },
      user: { id: userId, name: 'test@test.com', displayName: 'Test' },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
    });

    await app.inject({
      method: 'POST',
      url: '/api/auth/passkeys/register/options',
      headers: { authorization: `Bearer ${token}` },
    });

    vi.mocked(verifyRegistrationResponse).mockResolvedValue({
      verified: true,
      registrationInfo: {
        fmt: 'none',
        counter: 0,
        aaguid: '00000000-0000-0000-0000-000000000000',
        credential: {
          id: credId,
          publicKey: new Uint8Array([10, 20, 30]),
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

    const regVerify = await app.inject({
      method: 'POST',
      url: '/api/auth/passkeys/register/verify',
      headers: { authorization: `Bearer ${token}` },
      payload: makeRegistrationResponse(),
    });
    expect(regVerify.statusCode).toBe(201);

    const challenge2 = `lifecycle-auth-${Date.now()}`;
    vi.mocked(generateAuthenticationOptions).mockResolvedValue({
      challenge: challenge2,
      rpId: 'localhost',
      timeout: 60000,
      userVerification: 'required',
    });

    await app.inject({
      method: 'POST',
      url: '/api/auth/passkeys/login/options',
    });

    vi.mocked(verifyAuthenticationResponse).mockImplementation(async (opts) => {
      const challengeFn = opts.expectedChallenge;
      if (typeof challengeFn === 'function') {
        await challengeFn(challenge2);
      }
      return {
        verified: true,
        authenticationInfo: {
          newCounter: 1,
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

    const loginVerify = await app.inject({
      method: 'POST',
      url: '/api/auth/passkeys/login/verify',
      payload: makeAuthenticationResponse({ id: credId }),
    });
    expect(loginVerify.statusCode).toBe(200);

    const loginBody = loginVerify.json();
    expect(loginBody.token).toBeDefined();
    expect(loginBody.user.id).toBe(userId);

    const logoutResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: `Bearer ${loginBody.token}` },
    });
    expect(logoutResponse.statusCode).toBe(204);
  });
});
