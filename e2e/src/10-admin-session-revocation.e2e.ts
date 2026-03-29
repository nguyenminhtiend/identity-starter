import { ADMIN_EMAIL, ADMIN_PASSWORD, TEST_PASSWORD } from './helpers/constants.js';
import { uniqueEmail } from './helpers/crypto.js';
import { api } from './helpers/http-client.js';

describe('Admin Session Revocation', () => {
  let adminToken: string;
  const targetEmail = uniqueEmail('sess-target');
  let targetUserId: string;
  let targetSessionToken: string;

  it('admin logs in', async () => {
    const res = await api.post<{ token: string }>('/api/auth/login', {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(res.status).toBe(200);
    adminToken = res.data.token;
  });

  it('registers target user with multiple sessions', async () => {
    const regRes = await api.post<{ token: string; user: { id: string } }>('/api/auth/register', {
      body: { email: targetEmail, password: TEST_PASSWORD, displayName: 'Session Target' },
    });
    expect(regRes.status).toBe(201);
    targetUserId = regRes.data.user.id;
    targetSessionToken = regRes.data.token;

    await api.post('/api/auth/login', {
      body: { email: targetEmail, password: TEST_PASSWORD },
    });
    await api.post('/api/auth/login', {
      body: { email: targetEmail, password: TEST_PASSWORD },
    });
  });

  it('admin lists sessions and finds target user sessions', async () => {
    const res = await api.get<{ data: Array<{ id: string; userId: string }> }>(
      '/api/admin/sessions',
      { token: adminToken },
    );

    expect(res.status).toBe(200);
    const targetSessions = res.data.data.filter((s) => s.userId === targetUserId);
    expect(targetSessions.length).toBeGreaterThanOrEqual(2);
  });

  it('admin force-revokes a specific session', async () => {
    const listRes = await api.get<{ data: Array<{ id: string; userId: string }> }>(
      '/api/admin/sessions',
      { token: adminToken },
    );
    const targetSession = listRes.data.data.find((s) => s.userId === targetUserId);
    expect(targetSession).toBeDefined();

    const res = await api.delete(`/api/admin/sessions/${targetSession?.id}`, {
      token: adminToken,
    });
    expect(res.status).toBe(204);
  });

  it('admin bulk-revokes all sessions for target user', async () => {
    const res = await api.delete<{ message: string }>(`/api/admin/users/${targetUserId}/sessions`, {
      token: adminToken,
    });

    expect(res.status).toBe(200);
    expect(res.data.message).toContain('Revoked');
  });

  it('target user session is now invalid', async () => {
    const res = await api.get('/api/account/profile', { token: targetSessionToken });
    expect(res.status).toBe(401);
  });
});
