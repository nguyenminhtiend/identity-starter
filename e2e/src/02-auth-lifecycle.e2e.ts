import { TEST_PASSWORD } from './helpers/constants.js';
import { uniqueEmail } from './helpers/crypto.js';
import { api } from './helpers/http-client.js';

describe('Auth Lifecycle', () => {
  const email = uniqueEmail('auth');
  let sessionToken: string;
  let verificationToken: string;

  it('registers a new user', async () => {
    const res = await api.post<{
      token: string;
      verificationToken: string;
      user: { id: string; email: string; displayName: string };
    }>('/api/auth/register', {
      body: { email, password: TEST_PASSWORD, displayName: 'Auth E2E User' },
    });

    expect(res.status).toBe(201);
    expect(res.data.token).toBeDefined();
    expect(res.data.verificationToken).toBeDefined();
    expect(res.data.user.email).toBe(email);
    sessionToken = res.data.token;
    verificationToken = res.data.verificationToken;
  });

  it('rejects duplicate registration', async () => {
    const res = await api.post('/api/auth/register', {
      body: { email, password: TEST_PASSWORD, displayName: 'Dup' },
    });

    expect(res.status).toBe(409);
  });

  it('verifies email', async () => {
    const res = await api.post<{ message: string }>('/api/auth/verify-email', {
      body: { token: verificationToken },
    });

    expect(res.status).toBe(200);
    expect(res.data.message).toContain('verified');
  });

  it('logs in with verified credentials', async () => {
    const res = await api.post<{ token: string; user: { email: string } }>('/api/auth/login', {
      body: { email, password: TEST_PASSWORD },
    });

    expect(res.status).toBe(200);
    expect(res.data.token).toBeDefined();
    sessionToken = res.data.token;
  });

  it('rejects login with wrong password', async () => {
    const res = await api.post('/api/auth/login', {
      body: { email, password: 'wrong-password-123' },
    });

    expect(res.status).toBe(401);
  });

  it('changes password', async () => {
    const res = await api.post('/api/auth/change-password', {
      body: { currentPassword: TEST_PASSWORD, newPassword: 'NewPassword123!' },
      token: sessionToken,
    });

    expect(res.status).toBe(204);
  });

  it('logs out', async () => {
    const res = await api.post('/api/auth/logout', { token: sessionToken });

    expect(res.status).toBe(204);
  });

  it('rejects old session after logout', async () => {
    const res = await api.post('/api/auth/logout', { token: sessionToken });

    expect(res.status).toBe(401);
  });

  it('logs in with changed password', async () => {
    const res = await api.post<{ token: string }>('/api/auth/login', {
      body: { email, password: 'NewPassword123!' },
    });

    expect(res.status).toBe(200);
    expect(res.data.token).toBeDefined();
  });
});
