// e2e/src/20-flow-e-admin-dashboard.e2e.ts
import { ADMIN_EMAIL, ADMIN_PASSWORD, TEST_PASSWORD } from './helpers/constants.js';
import { uniqueEmail } from './helpers/crypto.js';
import { createFlowLogger } from './helpers/flow-logger.js';
import { api } from './helpers/http-client.js';

const REDIRECT_URI = 'https://example.com/callback';

describe('Flow E: Admin Dashboard', () => {
  const flow = createFlowLogger('Flow E: Admin Dashboard');
  let adminToken: string;
  let clientId: string;
  let targetUserId: string;
  let _targetSessionToken: string;
  let createdRoleId: string;

  beforeAll(() => {
    flow.banner();
  });

  // --- ADMIN LOGIN ---

  it('step 1: admin logs in', async () => {
    const body = { email: ADMIN_EMAIL, password: ADMIN_PASSWORD };
    const res = await flow.step<{ token: string }>(
      'Admin logs in',
      () => api.post('/api/auth/login', { body }),
      { method: 'POST', path: '/api/auth/login', body },
    );
    expect(res.status).toBe(200);
    adminToken = res.data.token;
  });

  // --- CLIENT MANAGEMENT ---

  it('step 2: create OAuth client', async () => {
    const body = {
      clientName: 'Flow E Test Client',
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code'],
      scope: 'openid profile',
      tokenEndpointAuthMethod: 'client_secret_basic',
      isConfidential: true,
    };
    const res = await flow.step<{ id: string; clientId: string; clientSecret: string }>(
      'Create OAuth client',
      () => api.post('/api/admin/clients', { body, token: adminToken }),
      { method: 'POST', path: '/api/admin/clients', body },
    );
    expect(res.status).toBe(201);
    clientId = res.data.id;
  });

  it('step 3: list clients', async () => {
    const res = await flow.step<Array<{ clientId: string; clientName: string }>>(
      'List all OAuth clients',
      () => api.get('/api/admin/clients', { token: adminToken }),
      { method: 'GET', path: '/api/admin/clients' },
    );
    expect(res.status).toBe(200);
  });

  it('step 4: get client by ID', async () => {
    const res = await flow.step<{ clientId: string; clientName: string }>(
      'Get client details',
      () => api.get(`/api/admin/clients/${clientId}`, { token: adminToken }),
      { method: 'GET', path: `/api/admin/clients/${clientId}` },
    );
    expect(res.status).toBe(200);
    expect(res.data.clientName).toBe('Flow E Test Client');
  });

  it('step 5: update client', async () => {
    const body = { clientName: 'Flow E Updated Client' };
    const res = await flow.step<{ clientName: string }>(
      'Update client name',
      () => api.patch(`/api/admin/clients/${clientId}`, { body, token: adminToken }),
      { method: 'PATCH', path: `/api/admin/clients/${clientId}`, body },
    );
    expect(res.status).toBe(200);
    expect(res.data.clientName).toBe('Flow E Updated Client');
  });

  it('step 6: rotate client secret', async () => {
    const res = await flow.step<{ clientSecret: string }>(
      'Rotate client secret',
      () => api.post(`/api/admin/clients/${clientId}/rotate-secret`, { token: adminToken }),
      { method: 'POST', path: `/api/admin/clients/${clientId}/rotate-secret` },
    );
    expect(res.status).toBe(200);
    expect(res.data.clientSecret).toBeDefined();
  });

  it('step 7: delete client', async () => {
    const res = await flow.step(
      'Delete OAuth client',
      () => api.delete(`/api/admin/clients/${clientId}`, { token: adminToken }),
      { method: 'DELETE', path: `/api/admin/clients/${clientId}` },
    );
    expect(res.status).toBe(204);
  });

  // --- USER MANAGEMENT ---

  it('step 8: register target user', async () => {
    const email = uniqueEmail('flow-e-target');
    const body = { email, password: TEST_PASSWORD, displayName: 'Flow E Target' };
    const res = await flow.step<{ token: string; user: { id: string } }>(
      'Register target user',
      () => api.post('/api/auth/register', { body }),
      { method: 'POST', path: '/api/auth/register', body },
    );
    expect(res.status).toBe(201);
    targetUserId = res.data.user.id;
    _targetSessionToken = res.data.token;
  });

  it('step 9: list users', async () => {
    const res = await flow.step<{ data: unknown[]; total: number }>(
      'List users (paginated)',
      () => api.get('/api/admin/users', { token: adminToken }),
      { method: 'GET', path: '/api/admin/users' },
    );
    expect(res.status).toBe(200);
    expect(res.data.total).toBeGreaterThanOrEqual(2);
  });

  it('step 10: get user by ID', async () => {
    const res = await flow.step<{ id: string; email: string }>(
      'Get user details',
      () => api.get(`/api/admin/users/${targetUserId}`, { token: adminToken }),
      { method: 'GET', path: `/api/admin/users/${targetUserId}` },
    );
    expect(res.status).toBe(200);
    expect(res.data.id).toBe(targetUserId);
  });

  it('step 11: suspend user', async () => {
    const body = { status: 'suspended' };
    const res = await flow.step<{ status: string }>(
      'Suspend user',
      () => api.patch(`/api/admin/users/${targetUserId}/status`, { body, token: adminToken }),
      { method: 'PATCH', path: `/api/admin/users/${targetUserId}/status`, body },
    );
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('suspended');
  });

  it('step 12: reactivate user', async () => {
    const body = { status: 'active' };
    const res = await flow.step<{ status: string }>(
      'Reactivate user',
      () => api.patch(`/api/admin/users/${targetUserId}/status`, { body, token: adminToken }),
      { method: 'PATCH', path: `/api/admin/users/${targetUserId}/status`, body },
    );
    expect(res.status).toBe(200);
    expect(res.data.status).toBe('active');
  });

  // --- RBAC ---

  it('step 13: create role', async () => {
    const body = { name: `flow_e_role_${Date.now()}` };
    const res = await flow.step<{ id: string; name: string }>(
      'Create RBAC role',
      () => api.post('/api/admin/roles', { body, token: adminToken }),
      { method: 'POST', path: '/api/admin/roles', body },
    );
    expect(res.status).toBe(201);
    createdRoleId = res.data.id;
  });

  it('step 14: list roles', async () => {
    const res = await flow.step<Array<{ id: string; name: string }>>(
      'List roles + permissions',
      () => api.get('/api/admin/roles', { token: adminToken }),
      { method: 'GET', path: '/api/admin/roles' },
    );
    expect(res.status).toBe(200);
    expect(res.data.length).toBeGreaterThanOrEqual(4);
  });

  it('step 15: assign role to user', async () => {
    const body = { roleId: createdRoleId };
    const res = await flow.step(
      'Assign role to user',
      () => api.post(`/api/admin/users/${targetUserId}/roles`, { body, token: adminToken }),
      { method: 'POST', path: `/api/admin/users/${targetUserId}/roles`, body },
    );
    expect(res.status).toBe(201);
  });

  it('step 16: remove role from user', async () => {
    const res = await flow.step(
      'Remove role from user',
      () =>
        api.delete(`/api/admin/users/${targetUserId}/roles/${createdRoleId}`, {
          token: adminToken,
        }),
      { method: 'DELETE', path: `/api/admin/users/${targetUserId}/roles/${createdRoleId}` },
    );
    expect(res.status).toBe(204);
  });

  // --- SESSION OVERSIGHT ---

  it('step 17: list all sessions', async () => {
    const res = await flow.step<{ data: Array<{ id: string }> }>(
      'List all sessions',
      () => api.get('/api/admin/sessions', { token: adminToken }),
      { method: 'GET', path: '/api/admin/sessions' },
    );
    expect(res.status).toBe(200);
    expect(res.data.data.length).toBeGreaterThanOrEqual(1);
  });

  it('step 18: bulk revoke target user sessions', async () => {
    const res = await flow.step(
      'Bulk revoke user sessions',
      () => api.delete(`/api/admin/users/${targetUserId}/sessions`, { token: adminToken }),
      { method: 'DELETE', path: `/api/admin/users/${targetUserId}/sessions` },
    );
    expect(res.status).toBe(200);
    flow.note("All of target user's sessions revoked — they are now logged out everywhere");
  });

  // --- AUDIT ---

  it('step 19: query audit logs', async () => {
    const res = await flow.step<{ data: Array<{ action: string }>; total: number }>(
      'Query audit logs',
      () => api.get('/api/admin/audit-logs', { token: adminToken }),
      { method: 'GET', path: '/api/admin/audit-logs' },
    );
    expect(res.status).toBe(200);
    expect(res.data.total).toBeGreaterThan(0);
  });

  it('step 20: verify audit chain integrity', async () => {
    const res = await flow.step<{ valid: boolean; totalEntries: number }>(
      'Verify audit hash chain',
      () => api.get('/api/admin/audit-logs/verify', { token: adminToken }),
      { method: 'GET', path: '/api/admin/audit-logs/verify' },
    );
    expect(res.status).toBe(200);
    expect(res.data.valid).toBe(true);
  });

  it('step 21: export audit logs (NDJSON)', async () => {
    const res = await flow.step<string>(
      'Export audit logs',
      () => api.get('/api/admin/audit-logs/export', { token: adminToken }),
      { method: 'GET', path: '/api/admin/audit-logs/export' },
    );
    expect(res.status).toBe(200);
    const lines = (res.data as string).split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    flow.note(`Exported ${lines.length} audit log entries as NDJSON`);
  });

  // --- LOGOUT ---

  it('step 22: admin logs out', async () => {
    const res = await flow.step(
      'Admin logs out',
      () => api.post('/api/auth/logout', { token: adminToken }),
      { method: 'POST', path: '/api/auth/logout' },
    );
    expect(res.status).toBe(204);
  });
});
