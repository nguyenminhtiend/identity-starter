// e2e/src/21-flow-f-service-to-service.e2e.ts
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './helpers/constants.js';
import { basicAuth } from './helpers/crypto.js';
import { createFlowLogger } from './helpers/flow-logger.js';
import { api } from './helpers/http-client.js';

describe('Flow F: Service-to-Service (Client Credentials)', () => {
  const flow = createFlowLogger('Flow F: Service-to-Service (Client Credentials)');
  let adminToken: string;
  let clientId: string;
  let clientSecret: string;
  let accessToken: string;

  beforeAll(() => {
    flow.banner();
    flow.note(
      'No human user involved. A backend service authenticates with its own\n' +
        '  client_id + client_secret to get an access token for machine-to-machine API calls.',
    );
  });

  it('step 1: admin registers a confidential service client', async () => {
    const loginBody = { email: ADMIN_EMAIL, password: ADMIN_PASSWORD };
    const loginRes = await flow.step<{ token: string }>(
      'Admin logs in',
      () => api.post('/api/auth/login', { body: loginBody }),
      { method: 'POST', path: '/api/auth/login', body: loginBody },
    );
    adminToken = loginRes.data.token;

    const clientBody = {
      clientName: 'Cron Service (Flow F)',
      redirectUris: [],
      grantTypes: ['client_credentials'],
      scope: 'openid',
      tokenEndpointAuthMethod: 'client_secret_basic',
      isConfidential: true,
    };
    const clientRes = await flow.step<{ clientId: string; clientSecret: string }>(
      'Register service client',
      () => api.post('/api/admin/clients', { body: clientBody, token: adminToken }),
      { method: 'POST', path: '/api/admin/clients', body: clientBody },
    );
    expect(clientRes.status).toBe(201);
    clientId = clientRes.data.clientId;
    clientSecret = clientRes.data.clientSecret;
  });

  it('step 2: service authenticates via client_credentials grant', async () => {
    const body = { grant_type: 'client_credentials' };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const res = await flow.step<{
      access_token: string;
      token_type: string;
      expires_in: number;
      refresh_token?: string;
      id_token?: string;
      scope: string;
    }>('Client credentials token request', () => api.post('/oauth/token', { body, headers }), {
      method: 'POST',
      path: '/oauth/token',
      body,
      headers,
    });
    expect(res.status).toBe(200);
    expect(res.data.token_type).toBe('Bearer');
    expect(res.data.access_token).toBeDefined();
    expect(res.data.refresh_token).toBeUndefined();
    expect(res.data.id_token).toBeUndefined();
    accessToken = res.data.access_token;
    flow.note('No refresh_token or id_token — client_credentials has no user context');
  });

  it('step 3: introspect service token (active)', async () => {
    const body = { token: accessToken };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const res = await flow.step<{ active: boolean; client_id: string }>(
      'Introspect service access token',
      () => api.post('/oauth/introspect', { body, headers }),
      { method: 'POST', path: '/oauth/introspect', body, headers },
    );
    expect(res.status).toBe(200);
    expect(res.data.active).toBe(true);
  });

  it('step 4: revoke service token', async () => {
    const body = { token: accessToken };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const res = await flow.step(
      'Revoke access token',
      () => api.post('/oauth/revoke', { body, headers }),
      { method: 'POST', path: '/oauth/revoke', body, headers },
    );
    expect(res.status).toBe(200);
  });

  it('step 5: re-authenticate (get new token)', async () => {
    flow.note('Token expired or revoked? Just request a new one — no refresh needed');
    const body = { grant_type: 'client_credentials' };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const res = await flow.step<{ access_token: string }>(
      'Re-authenticate with client_credentials',
      () => api.post('/oauth/token', { body, headers }),
      { method: 'POST', path: '/oauth/token', body, headers },
    );
    expect(res.status).toBe(200);
    expect(res.data.access_token).toBeDefined();
    expect(res.data.access_token).not.toBe(accessToken);
  });
});
