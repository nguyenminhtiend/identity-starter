import * as OTPAuth from 'otpauth';
import { TEST_PASSWORD } from './helpers/constants.js';
import { uniqueEmail } from './helpers/crypto.js';
import { api } from './helpers/http-client.js';

describe('MFA Management', () => {
  const email = uniqueEmail('mfa-mgmt');
  let sessionToken: string;
  let totp: OTPAuth.TOTP;
  let recoveryCodes: string[];

  it('registers, enrolls and verifies TOTP', async () => {
    const regRes = await api.post<{ token: string }>('/api/auth/register', {
      body: { email, password: TEST_PASSWORD, displayName: 'MFA Mgmt User' },
    });
    expect(regRes.status).toBe(201);
    sessionToken = regRes.data.token;

    const enrollRes = await api.post<{ otpauthUri: string; recoveryCodes: string[] }>(
      '/api/account/mfa/totp/enroll',
      { token: sessionToken },
    );
    expect(enrollRes.status).toBe(200);
    recoveryCodes = enrollRes.data.recoveryCodes;

    const parsed = OTPAuth.URI.parse(enrollRes.data.otpauthUri);
    if (!(parsed instanceof OTPAuth.TOTP)) {
      throw new Error('expected TOTP URI');
    }
    totp = parsed;

    const verifyRes = await api.post('/api/account/mfa/totp/verify', {
      body: { otp: totp.generate() },
      token: sessionToken,
    });
    expect(verifyRes.status).toBe(200);
  });

  it('regenerates recovery codes (old codes invalidated)', async () => {
    const res = await api.post<{ recoveryCodes: string[] }>(
      '/api/account/mfa/recovery-codes/regenerate',
      {
        body: { password: TEST_PASSWORD },
        token: sessionToken,
      },
    );

    expect(res.status).toBe(200);
    expect(res.data.recoveryCodes).toHaveLength(8);

    const newCodes = res.data.recoveryCodes;
    const overlap = newCodes.filter((c) => recoveryCodes.includes(c));
    expect(overlap.length).toBe(0);

    const loginRes = await api.post<{ mfaToken: string }>('/api/auth/login', {
      body: { email, password: TEST_PASSWORD },
    });
    const oldCodeRes = await api.post('/api/auth/mfa/verify', {
      body: { mfaToken: loginRes.data.mfaToken, recoveryCode: recoveryCodes[0] },
    });
    expect(oldCodeRes.status).toBe(401);

    const loginRes2 = await api.post<{ mfaToken: string }>('/api/auth/login', {
      body: { email, password: TEST_PASSWORD },
    });
    const newCodeRes = await api.post<{ token: string }>('/api/auth/mfa/verify', {
      body: { mfaToken: loginRes2.data.mfaToken, recoveryCode: newCodes[0] },
    });
    expect(newCodeRes.status).toBe(200);
    expect(newCodeRes.data.token).toBeDefined();

    recoveryCodes = newCodes;
  });

  it('disables TOTP (login no longer requires MFA)', async () => {
    const loginRes = await api.post<{ mfaToken: string }>('/api/auth/login', {
      body: { email, password: TEST_PASSWORD },
    });
    const mfaRes = await api.post<{ token: string }>('/api/auth/mfa/verify', {
      body: { mfaToken: loginRes.data.mfaToken, otp: totp.generate() },
    });
    sessionToken = mfaRes.data.token;

    const disableRes = await api.delete('/api/account/mfa/totp', {
      body: { password: TEST_PASSWORD },
      token: sessionToken,
    });
    expect(disableRes.status).toBe(204);

    const directLoginRes = await api.post<{ token: string; mfaRequired?: boolean }>(
      '/api/auth/login',
      { body: { email, password: TEST_PASSWORD } },
    );
    expect(directLoginRes.status).toBe(200);
    expect(directLoginRes.data.token).toBeDefined();
    expect(directLoginRes.data.mfaRequired).toBeUndefined();
  });
});
