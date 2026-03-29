import assert from 'node:assert';
import { passwordResetTokens, users } from '@identity-starter/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
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

async function latestUnusedResetTokenForEmail(email: string): Promise<string> {
  const [user] = await testDb.db.select().from(users).where(eq(users.email, email)).limit(1);
  assert(user);
  const [row] = await testDb.db
    .select()
    .from(passwordResetTokens)
    .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)))
    .orderBy(desc(passwordResetTokens.createdAt))
    .limit(1);
  assert(row);
  return row.token;
}

describe('POST /api/auth/forgot-password', () => {
  it('returns 200 with message and includes resetToken in non-production mode', async () => {
    const input = makeRegisterInput();
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: input });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: input.email },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.message).toBeDefined();
    expect(body.resetToken).toBeDefined();
    expect(typeof body.resetToken).toBe('string');
    const dbToken = await latestUnusedResetTokenForEmail(input.email);
    expect(body.resetToken).toBe(dbToken);
  });

  it('returns 200 without resetToken when email is unknown', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: 'nobody-for-reset@example.com' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.message).toBeDefined();
    expect(body.resetToken).toBeUndefined();
  });

  it('returns 400 on invalid email', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: 'not-an-email' },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('POST /api/auth/reset-password', () => {
  it('returns 200 and allows login with new password', async () => {
    const input = makeRegisterInput();
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: input });

    await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: input.email },
    });
    const resetToken = await latestUnusedResetTokenForEmail(input.email);

    const resetResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token: resetToken, newPassword: 'http-reset-new-pass-99' },
    });

    expect(resetResponse.statusCode).toBe(200);
    expect(resetResponse.json().message).toBe('Password reset successfully');

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: input.email, password: 'http-reset-new-pass-99' },
    });

    expect(loginResponse.statusCode).toBe(200);
  });

  it('returns 401 for invalid token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token: 'invalid-token-value', newPassword: 'newpassword1' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns 400 on short newPassword', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token: 'any', newPassword: 'short' },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('password reset HTTP lifecycle', () => {
  it('invalidates prior session after reset', async () => {
    const input = makeRegisterInput();
    const regResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: input,
    });
    const sessionToken = (regResponse.json() as { token: string }).token;

    await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: input.email },
    });
    const resetToken = await latestUnusedResetTokenForEmail(input.email);

    await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token: resetToken, newPassword: 'post-reset-session-88' },
    });

    const logoutResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: `Bearer ${sessionToken}` },
    });

    expect(logoutResponse.statusCode).toBe(401);
  });
});
