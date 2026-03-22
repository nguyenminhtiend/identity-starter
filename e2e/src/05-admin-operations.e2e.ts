import { ADMIN_EMAIL, ADMIN_PASSWORD, TEST_PASSWORD } from './helpers/constants.js';
import { uniqueEmail } from './helpers/crypto.js';
import { api } from './helpers/http-client.js';

describe('Admin Operations', () => {
  let adminToken: string;
  let targetUserId: string;

  it('admin logs in with seeded credentials', async () => {
    const res = await api.post<{ token: string }>('/api/auth/login', {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });

    expect(res.status).toBe(200);
    adminToken = res.data.token;
  });

  it('registers a target user for admin operations', async () => {
    const res = await api.post<{ user: { id: string } }>('/api/auth/register', {
      body: { email: uniqueEmail('target'), password: TEST_PASSWORD, displayName: 'Target User' },
    });

    expect(res.status).toBe(201);
    targetUserId = res.data.user.id;
  });

  describe('user management', () => {
    it('lists users', async () => {
      const res = await api.get<{ data: unknown[]; total: number }>('/api/admin/users', {
        token: adminToken,
      });

      expect(res.status).toBe(200);
      expect(res.data.data.length).toBeGreaterThanOrEqual(2);
      expect(res.data.total).toBeGreaterThanOrEqual(2);
    });

    it('gets user by ID with roles', async () => {
      const res = await api.get<{ id: string; roles: unknown[] }>(
        `/api/admin/users/${targetUserId}`,
        { token: adminToken },
      );

      expect(res.status).toBe(200);
      expect(res.data.id).toBe(targetUserId);
    });

    it('suspends user', async () => {
      const res = await api.patch<{ status: string }>(`/api/admin/users/${targetUserId}/status`, {
        body: { status: 'suspended' },
        token: adminToken,
      });

      expect(res.status).toBe(200);
      expect(res.data.status).toBe('suspended');
    });

    it('reactivates user', async () => {
      const res = await api.patch<{ status: string }>(`/api/admin/users/${targetUserId}/status`, {
        body: { status: 'active' },
        token: adminToken,
      });

      expect(res.status).toBe(200);
      expect(res.data.status).toBe('active');
    });
  });

  describe('role management', () => {
    it('lists system roles', async () => {
      const res = await api.get<Array<{ id: string; name: string }>>('/api/admin/roles', {
        token: adminToken,
      });

      expect(res.status).toBe(200);
      expect(res.data.length).toBeGreaterThanOrEqual(3);
      expect(res.data.some((r) => r.name === 'super_admin')).toBe(true);
      expect(res.data.some((r) => r.name === 'admin')).toBe(true);
      expect(res.data.some((r) => r.name === 'user')).toBe(true);
    });

    it('creates a custom role', async () => {
      const res = await api.post<{ id: string; name: string; isSystem: boolean }>(
        '/api/admin/roles',
        {
          body: { name: `e2e-role-${Date.now()}`, description: 'E2E test role' },
          token: adminToken,
        },
      );

      expect(res.status).toBe(201);
      expect(res.data.isSystem).toBe(false);
    });

    it('assigns role to user', async () => {
      const rolesRes = await api.get<Array<{ id: string; name: string }>>('/api/admin/roles', {
        token: adminToken,
      });
      const userRole = rolesRes.data.find((r) => r.name === 'user');
      if (!userRole) {
        throw new Error('user role not found');
      }

      const res = await api.post(`/api/admin/users/${targetUserId}/roles`, {
        body: { roleId: userRole.id },
        token: adminToken,
      });

      expect(res.status).toBe(201);
    });

    it('removes role from user', async () => {
      const rolesRes = await api.get<Array<{ id: string; name: string }>>('/api/admin/roles', {
        token: adminToken,
      });
      const userRole = rolesRes.data.find((r) => r.name === 'user');
      if (!userRole) {
        throw new Error('user role not found');
      }

      const res = await api.delete(`/api/admin/users/${targetUserId}/roles/${userRole.id}`, {
        token: adminToken,
      });

      expect(res.status).toBe(204);
    });
  });

  describe('session management', () => {
    it('lists sessions', async () => {
      const res = await api.get<{ data: unknown[] }>('/api/admin/sessions', {
        token: adminToken,
      });

      expect(res.status).toBe(200);
      expect(res.data.data.length).toBeGreaterThan(0);
    });
  });

  describe('audit logs', () => {
    it('queries audit logs', async () => {
      const res = await api.get<{ data: unknown[]; total: number }>('/api/admin/audit-logs', {
        token: adminToken,
      });

      expect(res.status).toBe(200);
      expect(res.data.data.length).toBeGreaterThan(0);
      expect(res.data.total).toBeGreaterThan(0);
    });

    it('exports audit logs as NDJSON', async () => {
      const res = await api.get<string>('/api/admin/audit-logs/export', { token: adminToken });

      expect(res.status).toBe(200);
      const lines = (res.data as string).split('\n').filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      expect(() => JSON.parse(lines[0])).not.toThrow();
    });
  });

  describe('RBAC enforcement', () => {
    it('non-admin gets 403 on admin routes', async () => {
      const regRes = await api.post<{ token: string }>('/api/auth/register', {
        body: {
          email: uniqueEmail('nonadmin'),
          password: TEST_PASSWORD,
          displayName: 'Non Admin',
        },
      });

      const res = await api.get('/api/admin/users', { token: regRes.data.token });
      expect(res.status).toBe(403);
    });
  });
});
