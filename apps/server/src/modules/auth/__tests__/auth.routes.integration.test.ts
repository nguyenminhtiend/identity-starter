import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../test/app-builder.js';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';
import { makeRegisterInput } from './auth.factory.js';

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

describe('POST /api/auth/register', () => {
  it('returns 201 with token and user', async () => {
    const input = makeRegisterInput();
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: input,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.token).toBeDefined();
    expect(body.user.email).toBe(input.email);
    expect(body.user.displayName).toBe(input.displayName);
    expect(body.user.id).toBeDefined();
    expect(body.user).not.toHaveProperty('passwordHash');
  });

  it('returns 409 on duplicate email', async () => {
    const input = makeRegisterInput();
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: input });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: input,
    });

    expect(response.statusCode).toBe(409);
  });

  it('returns 400 on missing fields', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('returns 400 on short password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'a@b.com', password: 'short', displayName: 'Test' },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  it('returns 200 with token and user for valid credentials', async () => {
    const input = makeRegisterInput();
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: input });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: input.email, password: input.password },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.token).toBeDefined();
    expect(body.user.email).toBe(input.email);
    expect(body.user).not.toHaveProperty('passwordHash');
  });

  it('returns 401 on wrong password', async () => {
    const input = makeRegisterInput();
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: input });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: input.email, password: 'wrong-password' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns 401 on non-existent email', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nobody@example.com', password: 'whatever123' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns 400 on missing fields', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('POST /api/auth/logout', () => {
  it('returns 204 with valid session token', async () => {
    const input = makeRegisterInput();
    const regResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: input,
    });
    const { token } = regResponse.json();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(204);
  });

  it('returns 401 without auth header', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns 401 with invalid token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: 'Bearer invalid-token' },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('POST /api/auth/change-password', () => {
  it('returns 204 on successful password change', async () => {
    const input = makeRegisterInput();
    const regResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: input,
    });
    const { token } = regResponse.json();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { authorization: `Bearer ${token}` },
      payload: { currentPassword: input.password, newPassword: 'brand-new-pass-123' },
    });

    expect(response.statusCode).toBe(204);
  });

  it('allows login with new password after change', async () => {
    const input = makeRegisterInput();
    const regResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: input,
    });
    const { token } = regResponse.json();

    await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { authorization: `Bearer ${token}` },
      payload: { currentPassword: input.password, newPassword: 'changed-password-123' },
    });

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: input.email, password: 'changed-password-123' },
    });

    expect(loginResponse.statusCode).toBe(200);
  });

  it('returns 401 on wrong current password', async () => {
    const input = makeRegisterInput();
    const regResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: input,
    });
    const { token } = regResponse.json();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { authorization: `Bearer ${token}` },
      payload: { currentPassword: 'wrong-password', newPassword: 'new-pass-123' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns 401 without auth header', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      payload: { currentPassword: 'old', newPassword: 'newpassword1' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns 400 on short newPassword', async () => {
    const input = makeRegisterInput();
    const regResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: input,
    });
    const { token } = regResponse.json();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { authorization: `Bearer ${token}` },
      payload: { currentPassword: input.password, newPassword: 'short' },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('full auth lifecycle', () => {
  it('register → login → access protected → change password → logout → reject old session', async () => {
    const input = makeRegisterInput();

    const regResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: input,
    });
    expect(regResponse.statusCode).toBe(201);

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: input.email, password: input.password },
    });
    expect(loginResponse.statusCode).toBe(200);
    const loginToken = loginResponse.json().token;

    await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { authorization: `Bearer ${loginToken}` },
      payload: { currentPassword: input.password, newPassword: 'updated-pass-123' },
    });

    const logoutResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: `Bearer ${loginToken}` },
    });
    expect(logoutResponse.statusCode).toBe(204);

    const rejectedResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: `Bearer ${loginToken}` },
    });
    expect(rejectedResponse.statusCode).toBe(401);

    const finalLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: input.email, password: 'updated-pass-123' },
    });
    expect(finalLogin.statusCode).toBe(200);
  });
});
