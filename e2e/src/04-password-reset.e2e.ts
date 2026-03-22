import { TEST_PASSWORD } from './helpers/constants.js';
import { uniqueEmail } from './helpers/crypto.js';
import { api } from './helpers/http-client.js';

describe('Password Reset', () => {
  const email = uniqueEmail('reset');
  let sessionToken: string;

  it('registers user', async () => {
    const res = await api.post<{ token: string }>('/api/auth/register', {
      body: { email, password: TEST_PASSWORD, displayName: 'Reset E2E User' },
    });

    expect(res.status).toBe(201);
    sessionToken = res.data.token;
  });

  it('requests password reset and gets token', async () => {
    const res = await api.post<{ message: string; resetToken?: string }>(
      '/api/auth/forgot-password',
      { body: { email } },
    );

    expect(res.status).toBe(200);
    expect(res.data.resetToken).toBeDefined();
  });

  it('returns generic response for unknown email', async () => {
    const res = await api.post<{ message: string; resetToken?: string }>(
      '/api/auth/forgot-password',
      { body: { email: 'nobody@e2e.test' } },
    );

    expect(res.status).toBe(200);
    expect(res.data.resetToken).toBeUndefined();
  });

  it('resets password and invalidates old session', async () => {
    const forgotRes = await api.post<{ resetToken: string }>('/api/auth/forgot-password', {
      body: { email },
    });

    const res = await api.post<{ message: string }>('/api/auth/reset-password', {
      body: { token: forgotRes.data.resetToken, newPassword: 'ResetPass123!' },
    });

    expect(res.status).toBe(200);

    const logoutRes = await api.post('/api/auth/logout', { token: sessionToken });
    expect(logoutRes.status).toBe(401);
  });

  it('logs in with new password', async () => {
    const res = await api.post<{ token: string }>('/api/auth/login', {
      body: { email, password: 'ResetPass123!' },
    });

    expect(res.status).toBe(200);
    expect(res.data.token).toBeDefined();
  });
});
