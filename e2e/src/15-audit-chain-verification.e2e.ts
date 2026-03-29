import { ADMIN_EMAIL, ADMIN_PASSWORD, TEST_PASSWORD } from './helpers/constants.js';
import { uniqueEmail } from './helpers/crypto.js';
import { api } from './helpers/http-client.js';

describe('Audit Chain Verification', () => {
  let adminToken: string;

  it('admin logs in', async () => {
    const res = await api.post<{ token: string }>('/api/auth/login', {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(res.status).toBe(200);
    adminToken = res.data.token;
  });

  it('generates audit entries via user operations', async () => {
    const email = uniqueEmail('audit');
    await api.post('/api/auth/register', {
      body: { email, password: TEST_PASSWORD, displayName: 'Audit User' },
    });
    await api.post('/api/auth/login', {
      body: { email, password: TEST_PASSWORD },
    });
  });

  it('verifies audit log hash chain integrity', async () => {
    const res = await api.get<{
      valid: boolean;
      totalEntries: number;
      checkedEntries: number;
      firstInvalidEntryId: string | null;
    }>('/api/admin/audit-logs/verify', { token: adminToken });

    expect(res.status).toBe(200);
    expect(res.data.valid).toBe(true);
    expect(res.data.totalEntries).toBeGreaterThan(0);
    expect(res.data.checkedEntries).toBe(res.data.totalEntries);
    expect(res.data.firstInvalidEntryId).toBeNull();
  });

  it('audit logs can be filtered by action', async () => {
    const res = await api.get<{ data: Array<{ action: string }>; total: number }>(
      '/api/admin/audit-logs',
      {
        token: adminToken,
        query: { action: 'auth.login' },
      },
    );

    expect(res.status).toBe(200);
    expect(res.data.total).toBeGreaterThan(0);
    for (const entry of res.data.data) {
      expect(entry.action).toBe('auth.login');
    }
  });

  it('audit logs export returns NDJSON with filtered results', async () => {
    const res = await api.get<string>('/api/admin/audit-logs/export', {
      token: adminToken,
    });

    expect(res.status).toBe(200);
    const lines = (res.data as string).split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);

    const firstEntry = JSON.parse(lines[0]);
    expect(firstEntry.id).toBeDefined();
    expect(firstEntry.action).toBeDefined();
    expect(firstEntry.createdAt).toBeDefined();
  });
});
