import * as OTPAuth from 'otpauth';
import { TEST_PASSWORD } from './helpers/constants.js';
import { uniqueEmail } from './helpers/crypto.js';
import { api } from './helpers/http-client.js';

describe('MFA Flow', () => {
  const email = uniqueEmail('mfa');
  let sessionToken: string;
  let totp: OTPAuth.TOTP;
  let recoveryCodes: string[];

  it('registers and gets session', async () => {
    const res = await api.post<{ token: string }>('/api/auth/register', {
      body: { email, password: TEST_PASSWORD, displayName: 'MFA E2E User' },
    });

    expect(res.status).toBe(201);
    sessionToken = res.data.token;
  });

  it('enrolls TOTP', async () => {
    const res = await api.post<{ otpauthUri: string; recoveryCodes: string[] }>(
      '/api/account/mfa/totp/enroll',
      { token: sessionToken },
    );

    expect(res.status).toBe(200);
    expect(res.data.otpauthUri).toContain('otpauth://totp/');
    expect(res.data.recoveryCodes).toHaveLength(8);

    const parsed = OTPAuth.URI.parse(res.data.otpauthUri);
    if (!(parsed instanceof OTPAuth.TOTP)) {
      throw new Error('expected TOTP URI');
    }
    totp = parsed;
    recoveryCodes = res.data.recoveryCodes;
  });

  it('verifies TOTP enrollment with valid OTP', async () => {
    const res = await api.post('/api/account/mfa/totp/verify', {
      body: { otp: totp.generate() },
      token: sessionToken,
    });

    expect(res.status).toBe(200);
  });

  it('login now returns MFA challenge instead of session', async () => {
    const res = await api.post<{ mfaRequired: boolean; mfaToken: string }>('/api/auth/login', {
      body: { email, password: TEST_PASSWORD },
    });

    expect(res.status).toBe(200);
    expect(res.data.mfaRequired).toBe(true);
    expect(res.data.mfaToken).toBeDefined();
  });

  it('completes MFA login with TOTP', async () => {
    const loginRes = await api.post<{ mfaToken: string }>('/api/auth/login', {
      body: { email, password: TEST_PASSWORD },
    });

    const res = await api.post<{ token: string; user: { email: string } }>('/api/auth/mfa/verify', {
      body: { mfaToken: loginRes.data.mfaToken, otp: totp.generate() },
    });

    expect(res.status).toBe(200);
    expect(res.data.token).toBeDefined();
    expect(res.data.user.email).toBe(email);
  });

  it('recovery code login works and code is consumed', async () => {
    const loginRes = await api.post<{ mfaToken: string }>('/api/auth/login', {
      body: { email, password: TEST_PASSWORD },
    });

    const res = await api.post<{ token: string }>('/api/auth/mfa/verify', {
      body: { mfaToken: loginRes.data.mfaToken, recoveryCode: recoveryCodes[0] },
    });

    expect(res.status).toBe(200);
    expect(res.data.token).toBeDefined();

    const loginRes2 = await api.post<{ mfaToken: string }>('/api/auth/login', {
      body: { email, password: TEST_PASSWORD },
    });

    const reuse = await api.post('/api/auth/mfa/verify', {
      body: { mfaToken: loginRes2.data.mfaToken, recoveryCode: recoveryCodes[0] },
    });

    expect(reuse.status).toBe(401);
  });
});
