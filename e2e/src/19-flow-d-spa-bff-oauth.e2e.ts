// e2e/src/19-flow-d-spa-bff-oauth.e2e.ts
import { ADMIN_EMAIL, ADMIN_PASSWORD, TEST_PASSWORD } from './helpers/constants.js';
import { basicAuth, codeFromLocation, pkcePair, uniqueEmail } from './helpers/crypto.js';
import { createFlowLogger } from './helpers/flow-logger.js';
import { api } from './helpers/http-client.js';

const BFF_CALLBACK = 'https://bff.spa-example.com/auth/callback';
const SCOPE = 'openid profile email';

describe('Flow D: SPA + BFF Proxy (OAuth 2.1)', () => {
  const flow = createFlowLogger('Flow D: SPA + BFF Proxy (OAuth 2.1)');
  const userEmail = uniqueEmail('flow-d');
  let adminToken: string;
  let clientId: string;
  let clientSecret: string;
  let userToken: string;
  let codeVerifier: string;
  let codeChallenge: string;
  let state: string;
  let accessToken: string;
  let refreshToken: string;

  beforeAll(() => {
    flow.banner();
    flow.note(
      'In this flow, the BFF (Backend-for-Frontend) proxy handles all OAuth interactions.\n' +
        '  The browser SPA never sees or stores tokens — it only has an httpOnly session cookie to the BFF.\n' +
        '  Server-side, the OAuth calls are identical to Flow A.',
    );
  });

  it('step 1: admin registers BFF as confidential client', async () => {
    const loginBody = { email: ADMIN_EMAIL, password: ADMIN_PASSWORD };
    const loginRes = await flow.step<{ token: string }>(
      'Admin logs in',
      () => api.post('/api/auth/login', { body: loginBody }),
      { method: 'POST', path: '/api/auth/login', body: loginBody },
    );
    adminToken = loginRes.data.token;

    const clientBody = {
      clientName: 'SPA BFF Proxy (Flow D)',
      redirectUris: [BFF_CALLBACK],
      grantTypes: ['authorization_code', 'refresh_token'],
      scope: SCOPE,
      tokenEndpointAuthMethod: 'client_secret_basic',
      isConfidential: true,
    };
    const clientRes = await flow.step<{ clientId: string; clientSecret: string }>(
      'Register BFF as confidential OAuth client',
      () => api.post('/api/admin/clients', { body: clientBody, token: adminToken }),
      { method: 'POST', path: '/api/admin/clients', body: clientBody },
    );
    expect(clientRes.status).toBe(201);
    clientId = clientRes.data.clientId;
    clientSecret = clientRes.data.clientSecret;
    flow.note('BFF stores client_secret server-side — the SPA JavaScript never has it');
  });

  it('step 2: user registers and logs in', async () => {
    const regBody = { email: userEmail, password: TEST_PASSWORD, displayName: 'Flow D SPA User' };
    const regRes = await flow.step<{ token: string; verificationToken: string }>(
      'User registers',
      () => api.post('/api/auth/register', { body: regBody }),
      { method: 'POST', path: '/api/auth/register', body: regBody },
    );
    expect(regRes.status).toBe(201);

    const verifyBody = { token: regRes.data.verificationToken };
    await flow.step(
      'Verify email',
      () => api.post('/api/auth/verify-email', { body: verifyBody }),
      { method: 'POST', path: '/api/auth/verify-email', body: verifyBody },
    );

    const loginBody = { email: userEmail, password: TEST_PASSWORD };
    const loginRes = await flow.step<{ token: string }>(
      'User logs in',
      () => api.post('/api/auth/login', { body: loginBody }),
      { method: 'POST', path: '/api/auth/login', body: loginBody },
    );
    userToken = loginRes.data.token;
  });

  it('step 3: BFF generates PKCE and initiates authorize (server-side)', async () => {
    flow.note('BFF generates PKCE server-side — the browser only calls GET /bff/login');
    const pkce = pkcePair();
    codeVerifier = pkce.codeVerifier;
    codeChallenge = pkce.codeChallenge;
    state = `state-bff-${Date.now()}`;

    const query = {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: BFF_CALLBACK,
      scope: SCOPE,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    };
    const res = await flow.step<{ type: string }>(
      'BFF initiates authorize',
      () => api.get('/oauth/authorize', { query, token: userToken }),
      { method: 'GET', path: '/oauth/authorize', body: query },
    );
    expect(res.status).toBe(200);
    expect(res.data.type).toBe('consent_required');
  });

  it('step 4: user consents in browser (redirected by BFF)', async () => {
    const body = {
      client_id: clientId,
      scope: SCOPE,
      decision: 'approve',
      state,
      redirect_uri: BFF_CALLBACK,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    };
    const res = await flow.step(
      'User approves consent',
      () => api.post('/oauth/consent', { body, token: userToken }),
      { method: 'POST', path: '/oauth/consent', body },
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('bff.spa-example.com');
    const authorizationCode = codeFromLocation(location);

    flow.note('IdP redirects back to BFF callback — browser is just along for the ride');

    // BFF exchanges code server-side
    const tokenBody = {
      grant_type: 'authorization_code',
      code: authorizationCode,
      redirect_uri: BFF_CALLBACK,
      code_verifier: codeVerifier,
    };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const tokenRes = await flow.step<{
      access_token: string;
      refresh_token: string;
      token_type: string;
    }>(
      'BFF exchanges code for tokens (server-to-server)',
      () => api.post('/oauth/token', { body: tokenBody, headers }),
      { method: 'POST', path: '/oauth/token', body: tokenBody, headers },
    );
    expect(tokenRes.status).toBe(200);
    accessToken = tokenRes.data.access_token;
    refreshToken = tokenRes.data.refresh_token;
    flow.note('BFF stores tokens in server memory, sets httpOnly cookie for browser');
  });

  it('step 5: BFF proxies userinfo request', async () => {
    flow.note('Browser calls GET /bff/api/profile → BFF attaches access_token and calls IdP');
    const headers = { authorization: `Bearer ${accessToken}` };
    const res = await flow.step<{ sub: string; email: string }>(
      'BFF fetches userinfo (on behalf of browser)',
      () => api.get('/oauth/userinfo', { headers }),
      { method: 'GET', path: '/oauth/userinfo', headers },
    );
    expect(res.status).toBe(200);
    expect(res.data.email).toBe(userEmail);
  });

  it('step 6: BFF refreshes token (server-side)', async () => {
    flow.note('Token refresh happens server-side — browser session cookie unchanged');
    const body = { grant_type: 'refresh_token', refresh_token: refreshToken };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const res = await flow.step<{ access_token: string; refresh_token: string }>(
      'BFF refreshes token',
      () => api.post('/oauth/token', { body, headers }),
      { method: 'POST', path: '/oauth/token', body, headers },
    );
    expect(res.status).toBe(200);
    expect(res.data.access_token).not.toBe(accessToken);
    refreshToken = res.data.refresh_token;
  });

  it('step 7: BFF revokes token on logout', async () => {
    flow.note('User clicks logout in SPA → BFF revokes tokens and clears session cookie');
    const body = { token: refreshToken, token_type_hint: 'refresh_token' };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const res = await flow.step(
      'BFF revokes refresh token',
      () => api.post('/oauth/revoke', { body, headers }),
      { method: 'POST', path: '/oauth/revoke', body, headers },
    );
    expect(res.status).toBe(200);
  });
});
