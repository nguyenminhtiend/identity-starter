import { ADMIN_EMAIL, ADMIN_PASSWORD } from './helpers/constants.js';
import { api } from './helpers/http-client.js';

describe('Admin Client Lifecycle', () => {
  let adminToken: string;
  let clientDbId: string;
  let clientId: string;
  let clientSecret: string;

  it('admin logs in', async () => {
    const res = await api.post<{ token: string }>('/api/auth/login', {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(res.status).toBe(200);
    adminToken = res.data.token;
  });

  it('creates an OAuth client', async () => {
    const res = await api.post<{
      id: string;
      clientId: string;
      clientSecret: string;
      clientName: string;
      isConfidential: boolean;
    }>('/api/admin/clients', {
      body: {
        clientName: 'E2E Lifecycle Client',
        redirectUris: ['https://example.com/callback'],
        grantTypes: ['authorization_code', 'refresh_token'],
        scope: 'openid profile email',
        tokenEndpointAuthMethod: 'client_secret_basic',
        isConfidential: true,
      },
      token: adminToken,
    });

    expect(res.status).toBe(201);
    expect(res.data.clientName).toBe('E2E Lifecycle Client');
    expect(res.data.clientId).toBeDefined();
    expect(res.data.clientSecret).toBeDefined();
    expect(res.data.isConfidential).toBe(true);
    clientDbId = res.data.id;
    clientId = res.data.clientId;
    clientSecret = res.data.clientSecret;
  });

  it('lists clients and includes the new one', async () => {
    const res = await api.get<Array<{ clientId: string; clientName: string }>>(
      '/api/admin/clients',
      { token: adminToken },
    );

    expect(res.status).toBe(200);
    expect(res.data.some((c) => c.clientId === clientId)).toBe(true);
  });

  it('gets client by ID', async () => {
    const res = await api.get<{ id: string; clientId: string; clientName: string }>(
      `/api/admin/clients/${clientDbId}`,
      { token: adminToken },
    );

    expect(res.status).toBe(200);
    expect(res.data.clientId).toBe(clientId);
    expect(res.data.clientName).toBe('E2E Lifecycle Client');
  });

  it('updates client name and redirect URIs', async () => {
    const res = await api.patch<{ clientName: string; redirectUris: string[] }>(
      `/api/admin/clients/${clientDbId}`,
      {
        body: {
          clientName: 'Updated E2E Client',
          redirectUris: ['https://example.com/callback', 'https://example.com/cb2'],
        },
        token: adminToken,
      },
    );

    expect(res.status).toBe(200);
    expect(res.data.clientName).toBe('Updated E2E Client');
    expect(res.data.redirectUris).toHaveLength(2);
  });

  it('rotates client secret', async () => {
    const res = await api.post<{ clientSecret: string }>(
      `/api/admin/clients/${clientDbId}/rotate-secret`,
      { token: adminToken },
    );

    expect(res.status).toBe(200);
    expect(res.data.clientSecret).toBeDefined();
    expect(res.data.clientSecret).not.toBe(clientSecret);
  });

  it('deletes client', async () => {
    const res = await api.delete(`/api/admin/clients/${clientDbId}`, { token: adminToken });
    expect(res.status).toBe(204);
  });

  it('deleted client no longer appears in list', async () => {
    const res = await api.get<Array<{ clientId: string }>>('/api/admin/clients', {
      token: adminToken,
    });

    expect(res.status).toBe(200);
    expect(res.data.some((c) => c.clientId === clientId)).toBe(false);
  });
});
