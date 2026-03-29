import { TEST_PASSWORD } from './helpers/constants.js';
import { uniqueEmail } from './helpers/crypto.js';
import { api } from './helpers/http-client.js';

describe('Resend Email Verification', () => {
  const email = uniqueEmail('resend');
  let verificationToken: string;

  it('registers new user (unverified)', async () => {
    const res = await api.post<{
      token: string;
      verificationToken: string;
      user: { id: string; status: string };
    }>('/api/auth/register', {
      body: { email, password: TEST_PASSWORD, displayName: 'Resend User' },
    });
    expect(res.status).toBe(201);
    expect(res.data.user.status).toBe('pending_verification');
    verificationToken = res.data.verificationToken;
  });

  it('resends verification email', async () => {
    const res = await api.post<{ message: string }>('/api/auth/resend-verification', {
      body: { email },
    });
    expect(res.status).toBe(200);
    expect(res.data.message).toContain('sent');
  });

  it('original verification token is invalidated after resend', async () => {
    const res = await api.post('/api/auth/verify-email', {
      body: { token: verificationToken },
    });
    expect(res.status).toBe(401);
  });

  it('returns generic message for already verified email', async () => {
    const verifiedEmail = uniqueEmail('already-verified');
    const regRes = await api.post<{ verificationToken: string }>('/api/auth/register', {
      body: { email: verifiedEmail, password: TEST_PASSWORD, displayName: 'Verified' },
    });
    await api.post('/api/auth/verify-email', {
      body: { token: regRes.data.verificationToken },
    });

    const res = await api.post<{ message: string }>('/api/auth/resend-verification', {
      body: { email: verifiedEmail },
    });
    expect(res.status).toBe(200);
    expect(res.data.message).toContain('eligible');
  });

  it('returns generic message for unknown email', async () => {
    const res = await api.post<{ message: string }>('/api/auth/resend-verification', {
      body: { email: 'nobody-at-all@e2e.test' },
    });
    expect(res.status).toBe(200);
    expect(res.data.message).toContain('eligible');
  });
});
