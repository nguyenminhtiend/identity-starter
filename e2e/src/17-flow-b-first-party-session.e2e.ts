// e2e/src/17-flow-b-first-party-session.e2e.ts
import * as OTPAuth from 'otpauth';
import { TEST_PASSWORD } from './helpers/constants.js';
import { uniqueEmail } from './helpers/crypto.js';
import { createFlowLogger } from './helpers/flow-logger.js';
import { api } from './helpers/http-client.js';

describe('Flow B: First-Party Web App (Direct Session Auth)', () => {
  const flow = createFlowLogger('Flow B: First-Party Web App (Direct Session Auth)');
  const email = uniqueEmail('flow-b');
  const newPassword = 'NewFlowB_Pass123!';
  const resetPassword = 'ResetFlowB_Pass456!';
  let sessionToken: string;
  let verificationToken: string;
  let totp: OTPAuth.TOTP;
  let _recoveryCodes: string[];

  beforeAll(() => {
    flow.banner();
  });

  // --- REGISTRATION ---

  it('step 1: register new user', async () => {
    const body = { email, password: TEST_PASSWORD, displayName: 'Flow B User' };
    const res = await flow.step<{
      token: string;
      verificationToken: string;
      user: { id: string; email: string };
    }>('Register new user', () => api.post('/api/auth/register', { body }), {
      method: 'POST',
      path: '/api/auth/register',
      body,
    });
    expect(res.status).toBe(201);
    expect(res.data.user.email).toBe(email);
    sessionToken = res.data.token;
    verificationToken = res.data.verificationToken;
  });

  it('step 2: verify email', async () => {
    const body = { token: verificationToken };
    const res = await flow.step(
      'Verify email via token',
      () => api.post('/api/auth/verify-email', { body }),
      { method: 'POST', path: '/api/auth/verify-email', body },
    );
    expect(res.status).toBe(200);
  });

  // --- LOGIN ---

  it('step 3: login with credentials', async () => {
    const body = { email, password: TEST_PASSWORD };
    const res = await flow.step<{ token: string; user: { email: string } }>(
      'Login with email + password',
      () => api.post('/api/auth/login', { body }),
      { method: 'POST', path: '/api/auth/login', body },
    );
    expect(res.status).toBe(200);
    expect(res.data.token).toBeDefined();
    sessionToken = res.data.token;
  });

  // --- PROFILE MANAGEMENT ---

  it('step 4: get own profile', async () => {
    const res = await flow.step<{ email: string; displayName: string }>(
      'Get own profile',
      () => api.get('/api/account/profile', { token: sessionToken }),
      { method: 'GET', path: '/api/account/profile' },
    );
    expect(res.status).toBe(200);
    expect(res.data.email).toBe(email);
    expect(res.data.displayName).toBe('Flow B User');
  });

  it('step 5: update display name', async () => {
    const body = { displayName: 'Flow B Updated' };
    const res = await flow.step<{ displayName: string }>(
      'Update profile display name',
      () => api.patch('/api/account/profile', { body, token: sessionToken }),
      { method: 'PATCH', path: '/api/account/profile', body },
    );
    expect(res.status).toBe(200);
    expect(res.data.displayName).toBe('Flow B Updated');
  });

  // --- SESSION MANAGEMENT ---

  it('step 6: list active sessions', async () => {
    const res = await flow.step<{ data: Array<{ id: string }> }>(
      'List own sessions',
      () => api.get('/api/account/sessions', { token: sessionToken }),
      { method: 'GET', path: '/api/account/sessions' },
    );
    expect(res.status).toBe(200);
    expect(res.data.data.length).toBeGreaterThanOrEqual(1);
  });

  // --- MFA ENROLLMENT ---

  it('step 7: enroll TOTP MFA', async () => {
    const res = await flow.step<{ otpauthUri: string; recoveryCodes: string[] }>(
      'Enroll TOTP (generate secret + QR)',
      () => api.post('/api/account/mfa/totp/enroll', { token: sessionToken }),
      { method: 'POST', path: '/api/account/mfa/totp/enroll' },
    );
    expect(res.status).toBe(200);
    expect(res.data.otpauthUri).toContain('otpauth://totp/');
    expect(res.data.recoveryCodes).toHaveLength(8);

    const parsed = OTPAuth.URI.parse(res.data.otpauthUri);
    if (!(parsed instanceof OTPAuth.TOTP)) {
      throw new Error('expected TOTP URI');
    }
    totp = parsed;
    _recoveryCodes = res.data.recoveryCodes;
  });

  it('step 8: verify TOTP enrollment with valid OTP', async () => {
    const otp = totp.generate();
    const body = { otp };
    const res = await flow.step(
      'Confirm TOTP enrollment',
      () => api.post('/api/account/mfa/totp/verify', { body, token: sessionToken }),
      { method: 'POST', path: '/api/account/mfa/totp/verify', body },
    );
    expect(res.status).toBe(200);
    flow.note('TOTP is now active — future logins will require MFA step');
  });

  // --- LOGOUT + MFA LOGIN ---

  it('step 9: logout', async () => {
    const res = await flow.step(
      'Logout (revoke session)',
      () => api.post('/api/auth/logout', { token: sessionToken }),
      { method: 'POST', path: '/api/auth/logout' },
    );
    expect(res.status).toBe(204);
  });

  it('step 10: login returns MFA challenge', async () => {
    const body = { email, password: TEST_PASSWORD };
    const res = await flow.step<{ mfaRequired: boolean; mfaToken: string }>(
      'Login (expect MFA challenge)',
      () => api.post('/api/auth/login', { body }),
      { method: 'POST', path: '/api/auth/login', body },
    );
    expect(res.status).toBe(200);
    expect(res.data.mfaRequired).toBe(true);
    expect(res.data.mfaToken).toBeDefined();

    // Complete MFA in next step
    const mfaBody = { mfaToken: res.data.mfaToken, otp: totp.generate() };
    const mfaRes = await flow.step<{ token: string }>(
      'Complete MFA with TOTP',
      () => api.post('/api/auth/mfa/verify', { body: mfaBody }),
      { method: 'POST', path: '/api/auth/mfa/verify', body: mfaBody },
    );
    expect(mfaRes.status).toBe(200);
    sessionToken = mfaRes.data.token;
  });

  // --- RECOVERY CODES ---

  it('step 11: regenerate recovery codes', async () => {
    const body = { password: TEST_PASSWORD };
    const res = await flow.step<{ recoveryCodes: string[] }>(
      'Regenerate recovery codes',
      () => api.post('/api/account/mfa/recovery-codes/regenerate', { body, token: sessionToken }),
      { method: 'POST', path: '/api/account/mfa/recovery-codes/regenerate', body },
    );
    expect(res.status).toBe(200);
    expect(res.data.recoveryCodes).toHaveLength(8);
    _recoveryCodes = res.data.recoveryCodes;
  });

  // --- DISABLE TOTP ---

  it('step 12: disable TOTP', async () => {
    const body = { password: TEST_PASSWORD };
    const res = await flow.step(
      'Disable TOTP MFA',
      () => api.delete('/api/account/mfa/totp', { body, token: sessionToken }),
      { method: 'DELETE', path: '/api/account/mfa/totp', body },
    );
    expect(res.status).toBe(204);
    flow.note('MFA disabled — login no longer requires TOTP');
  });

  // --- PASSWORD CHANGE ---

  it('step 13: change password', async () => {
    const body = { currentPassword: TEST_PASSWORD, newPassword };
    const res = await flow.step(
      'Change password (authenticated)',
      () => api.post('/api/auth/change-password', { body, token: sessionToken }),
      { method: 'POST', path: '/api/auth/change-password', body },
    );
    expect(res.status).toBe(204);
  });

  it('step 14: logout after password change', async () => {
    const res = await flow.step(
      'Logout',
      () => api.post('/api/auth/logout', { token: sessionToken }),
      { method: 'POST', path: '/api/auth/logout' },
    );
    expect(res.status).toBe(204);
  });

  // --- FORGOT / RESET PASSWORD ---

  it('step 15: forgot password (initiate reset)', async () => {
    const body = { email };
    const res = await flow.step<{ message: string; resetToken?: string }>(
      'Forgot password (request reset)',
      () => api.post('/api/auth/forgot-password', { body }),
      { method: 'POST', path: '/api/auth/forgot-password', body },
    );
    expect(res.status).toBe(200);
    expect(res.data.resetToken).toBeDefined();

    const resetBody = { token: res.data.resetToken ?? '', newPassword: resetPassword };
    const resetRes = await flow.step(
      'Reset password with token',
      () => api.post('/api/auth/reset-password', { body: resetBody }),
      { method: 'POST', path: '/api/auth/reset-password', body: resetBody },
    );
    expect(resetRes.status).toBe(200);
  });

  // --- FINAL LOGIN + LOGOUT ---

  it('step 16: login with reset password and logout', async () => {
    const body = { email, password: resetPassword };
    const res = await flow.step<{ token: string }>(
      'Login with new password',
      () => api.post('/api/auth/login', { body }),
      { method: 'POST', path: '/api/auth/login', body },
    );
    expect(res.status).toBe(200);
    sessionToken = res.data.token;

    const logoutRes = await flow.step(
      'Final logout',
      () => api.post('/api/auth/logout', { token: sessionToken }),
      { method: 'POST', path: '/api/auth/logout' },
    );
    expect(logoutRes.status).toBe(204);
  });
});
