import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../test/app-builder.js';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';
import { makeCreateUserInput } from './user.factory.js';

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

describe('POST /api/users', () => {
  it('returns 201 with created user', async () => {
    const input = makeCreateUserInput();
    const response = await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: input,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.email).toBe(input.email);
    expect(body.displayName).toBe(input.displayName);
    expect(body.id).toBeDefined();
    expect(body).not.toHaveProperty('passwordHash');
  });

  it('returns 409 on duplicate email', async () => {
    const input = makeCreateUserInput();
    await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: input,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: input,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toHaveProperty('error');
  });

  it('returns 400 on missing required fields', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns 400 on invalid email format', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { email: 'not-an-email', displayName: 'Test' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns 400 on empty displayName', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: { email: 'valid@example.com', displayName: '' },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('GET /api/users/:id', () => {
  it('returns 200 with user data after creation', async () => {
    const input = makeCreateUserInput();
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: input,
    });
    const createdUser = createResponse.json();

    const response = await app.inject({
      method: 'GET',
      url: `/api/users/${createdUser.id}`,
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
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toHaveProperty('error');
  });

  it('returns 400 for malformed UUID', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/users/not-a-uuid',
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('full lifecycle', () => {
  it('create then retrieve returns consistent data', async () => {
    const input = makeCreateUserInput({ metadata: { source: 'test' } });
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/users',
      payload: input,
    });

    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json();

    const getResponse = await app.inject({
      method: 'GET',
      url: `/api/users/${created.id}`,
    });

    expect(getResponse.statusCode).toBe(200);
    const fetched = getResponse.json();

    expect(fetched.id).toBe(created.id);
    expect(fetched.email).toBe(created.email);
    expect(fetched.displayName).toBe(created.displayName);
    expect(fetched.emailVerified).toBe(false);
    expect(fetched.status).toBe('pending_verification');
    expect(fetched.metadata).toEqual({ source: 'test' });
  });
});
