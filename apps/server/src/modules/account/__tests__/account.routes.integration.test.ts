import { passkeys } from '@identity-starter/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../test/app-builder.js';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';
import { makeRegisterInput } from '../../auth/__tests__/auth.factory.js';

let testDb: TestDb;
let app: FastifyInstance;
let authToken: string;
let userId: string;
let registeredCredentials: { email: string; password: string };

beforeAll(async () => {
  testDb = await createTestDb();
  app = await buildTestApp({ db: testDb.db });

  const regInput = makeRegisterInput();
  const regResponse = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: regInput,
  });
  const body = regResponse.json();
  authToken = body.token;
  userId = body.user.id;
  registeredCredentials = { email: regInput.email, password: regInput.password };
});

afterAll(async () => {
  await app.close();
  await testDb.teardown();
});

const authHeaders = () => ({ authorization: `Bearer ${authToken}` });

describe('GET /api/account/profile', () => {
  it('returns 401 without auth', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/account/profile' });
    expect(response.statusCode).toBe(401);
  });

  it('returns 200 with profile', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/account/profile',
      headers: authHeaders(),
    });
    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.id).toBe(userId);
    expect(json).not.toHaveProperty('passwordHash');
    expect(json).not.toHaveProperty('updatedAt');
  });
});

describe('PATCH /api/account/profile', () => {
  it('updates display name', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/account/profile',
      headers: authHeaders(),
      payload: { displayName: 'Route Integration' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().displayName).toBe('Route Integration');
  });
});

describe('GET /api/account/sessions', () => {
  it('lists sessions with isCurrent', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: registeredCredentials,
    });

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/account/sessions',
      headers: authHeaders(),
    });

    expect(listResponse.statusCode).toBe(200);
    const sessions = listResponse.json();
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions.filter((s: { isCurrent: boolean }) => s.isCurrent)).toHaveLength(1);
  });
});

describe('DELETE /api/account/sessions/:id', () => {
  it('returns 400 when deleting current session', async () => {
    const sessions = await app.inject({
      method: 'GET',
      url: '/api/account/sessions',
      headers: authHeaders(),
    });
    const current = sessions.json().find((s: { isCurrent: boolean }) => s.isCurrent);
    expect(current).toBeDefined();

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/account/sessions/${current.id}`,
      headers: authHeaders(),
    });
    expect(response.statusCode).toBe(400);
  });

  it('deletes another session', async () => {
    const listBefore = await app.inject({
      method: 'GET',
      url: '/api/account/sessions',
      headers: authHeaders(),
    });
    const sessions = listBefore.json() as Array<{ id: string; isCurrent: boolean }>;
    const other = sessions.find((s) => !s.isCurrent);
    if (!other) {
      throw new Error('expected a non-current session');
    }

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/account/sessions/${other.id}`,
      headers: authHeaders(),
    });
    expect(response.statusCode).toBe(204);
  });
});

describe('GET /api/account/passkeys', () => {
  it('returns passkeys for user', async () => {
    await testDb.db.insert(passkeys).values({
      userId,
      credentialId: `route-pk-${userId.slice(0, 8)}`,
      publicKey: new Uint8Array([7, 8]),
      counter: 0,
      deviceType: 'singleDevice',
      backedUp: false,
      name: 'RouteKey',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/account/passkeys',
      headers: authHeaders(),
    });
    expect(response.statusCode).toBe(200);
    const list = response.json();
    expect(list.some((p: { name: string | null }) => p.name === 'RouteKey')).toBe(true);
  });
});

describe('PATCH /api/account/passkeys/:id', () => {
  it('renames a passkey', async () => {
    const [row] = await testDb.db
      .select({ id: passkeys.id })
      .from(passkeys)
      .where(eq(passkeys.userId, userId));

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/account/passkeys/${row.id}`,
      headers: authHeaders(),
      payload: { name: 'Renamed via route' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().name).toBe('Renamed via route');
  });
});

describe('DELETE /api/account/passkeys/:id', () => {
  it('returns 204 when user still has password', async () => {
    const rows = await testDb.db
      .select({ id: passkeys.id })
      .from(passkeys)
      .where(eq(passkeys.userId, userId));

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/account/passkeys/${rows[0].id}`,
      headers: authHeaders(),
    });
    expect(response.statusCode).toBe(204);
  });
});
