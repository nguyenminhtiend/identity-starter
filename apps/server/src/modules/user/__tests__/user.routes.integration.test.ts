import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../test/app-builder.js';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';
import { makeRegisterInput } from '../../auth/__tests__/auth.factory.js';

let testDb: TestDb;
let app: FastifyInstance;
let authToken: string;

beforeAll(async () => {
  testDb = await createTestDb();
  app = await buildTestApp({ db: testDb.db });

  const regInput = makeRegisterInput();
  const regResponse = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: regInput,
  });
  authToken = regResponse.json().token;
});

afterAll(async () => {
  await app.close();
  await testDb.teardown();
});

describe('GET /api/users/:id', () => {
  it('returns 401 without auth header', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/users/550e8400-e29b-41d4-a716-446655440000',
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 200 with user data after registration', async () => {
    const input = makeRegisterInput();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: input,
    });
    expect(createResponse.statusCode).toBe(201);
    const { token, user: createdUser } = createResponse.json() as {
      token: string;
      user: { id: string; email: string; displayName: string };
    };

    const response = await app.inject({
      method: 'GET',
      url: `/api/users/${createdUser.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.id).toBe(createdUser.id);
    expect(body.email).toBe(input.email);
    expect(body).not.toHaveProperty('passwordHash');
  });

  it('returns 404 for non-existent UUID', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/users/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toHaveProperty('error');
  });

  it('returns 400 for malformed UUID', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/users/not-a-uuid',
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('full lifecycle', () => {
  it('register then retrieve returns consistent data', async () => {
    const input = makeRegisterInput();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: input,
    });

    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json() as {
      token: string;
      user: { id: string; email: string; displayName: string };
    };

    const getResponse = await app.inject({
      method: 'GET',
      url: `/api/users/${created.user.id}`,
      headers: { authorization: `Bearer ${created.token}` },
    });

    expect(getResponse.statusCode).toBe(200);
    const fetched = getResponse.json();

    expect(fetched.id).toBe(created.user.id);
    expect(fetched.email).toBe(created.user.email);
    expect(fetched.displayName).toBe(created.user.displayName);
    expect(fetched.emailVerified).toBe(false);
    expect(fetched.status).toBe('pending_verification');
  });
});
