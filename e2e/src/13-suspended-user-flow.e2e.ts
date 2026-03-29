import { ADMIN_EMAIL, ADMIN_PASSWORD, TEST_PASSWORD } from './helpers/constants.js';
import { uniqueEmail } from './helpers/crypto.js';
import { api } from './helpers/http-client.js';

describe('Suspended User Flow', () => {
  let adminToken: string;
  const email = uniqueEmail('suspended');
  let userId: string;

  it('admin logs in', async () => {
    const res = await api.post<{ token: string }>('/api/auth/login', {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(res.status).toBe(200);
    adminToken = res.data.token;
  });

  it('registers target user and verifies login works', async () => {
    const regRes = await api.post<{ user: { id: string } }>('/api/auth/register', {
      body: { email, password: TEST_PASSWORD, displayName: 'Suspend Target' },
    });
    expect(regRes.status).toBe(201);
    userId = regRes.data.user.id;

    const loginRes = await api.post<{ token: string }>('/api/auth/login', {
      body: { email, password: TEST_PASSWORD },
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.data.token).toBeDefined();
  });

  it('admin suspends user', async () => {
    const res = await api.patch<{ status: string }>(`/api/admin/users/${userId}/status`, {
      body: { status: 'suspended' },
      token: adminToken,
    });
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('suspended');
  });

  it('suspended user cannot login', async () => {
    const res = await api.post('/api/auth/login', {
      body: { email, password: TEST_PASSWORD },
    });
    expect(res.status).toBe(401);
  });

  it('admin reactivates user', async () => {
    const res = await api.patch<{ status: string }>(`/api/admin/users/${userId}/status`, {
      body: { status: 'active' },
      token: adminToken,
    });
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('active');
  });

  it('reactivated user can login again', async () => {
    const res = await api.post<{ token: string }>('/api/auth/login', {
      body: { email, password: TEST_PASSWORD },
    });
    expect(res.status).toBe(200);
    expect(res.data.token).toBeDefined();
  });
});
