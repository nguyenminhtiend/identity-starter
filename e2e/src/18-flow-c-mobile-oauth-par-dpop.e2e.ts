// e2e/src/18-flow-c-mobile-oauth-par-dpop.e2e.ts
import * as jose from 'jose';
import { ADMIN_EMAIL, ADMIN_PASSWORD, BASE_URL, TEST_PASSWORD } from './helpers/constants.js';
import { basicAuth, codeFromLocation, pkcePair, uniqueEmail } from './helpers/crypto.js';
import { createDPoPProof, type DPoPKeyPair, generateDPoPKeyPair } from './helpers/dpop.js';
import { createFlowLogger } from './helpers/flow-logger.js';
import { api } from './helpers/http-client.js';

const REDIRECT_URI = 'com.mobileapp.example://callback';
const SCOPE = 'openid profile email';

describe('Flow C: Mobile Native App (OAuth 2.1 + PAR + DPoP)', () => {
  const flow = createFlowLogger('Flow C: Mobile Native App (OAuth 2.1 + PAR + DPoP)');
  const userEmail = uniqueEmail('flow-c');
  let adminToken: string;
  let clientId: string;
  let clientSecret: string;
  let userToken: string;
  let dpopKeyPair: DPoPKeyPair;
  let codeVerifier: string;
  let codeChallenge: string;
  let state: string;
  let nonce: string;
  let requestUri: string;
  let authorizationCode: string;
  let accessToken: string;
  let refreshToken: string;

  beforeAll(() => {
    flow.banner();
  });

  it('step 1: setup — admin creates public mobile client', async () => {
    const loginBody = { email: ADMIN_EMAIL, password: ADMIN_PASSWORD };
    const loginRes = await flow.step<{ token: string }>(
      'Admin logs in',
      () => api.post('/api/auth/login', { body: loginBody }),
      { method: 'POST', path: '/api/auth/login', body: loginBody },
    );
    adminToken = loginRes.data.token;

    const clientBody = {
      clientName: 'Mobile App (Flow C)',
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code', 'refresh_token'],
      scope: SCOPE,
      tokenEndpointAuthMethod: 'client_secret_basic',
      isConfidential: true,
    };
    const clientRes = await flow.step<{ clientId: string; clientSecret: string }>(
      'Register mobile OAuth client',
      () => api.post('/api/admin/clients', { body: clientBody, token: adminToken }),
      { method: 'POST', path: '/api/admin/clients', body: clientBody },
    );
    expect(clientRes.status).toBe(201);
    clientId = clientRes.data.clientId;
    clientSecret = clientRes.data.clientSecret;
  });

  it('step 2: user registers and logs in', async () => {
    const regBody = {
      email: userEmail,
      password: TEST_PASSWORD,
      displayName: 'Flow C Mobile User',
    };
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

  it('step 3: generate DPoP key pair + PKCE', async () => {
    dpopKeyPair = await generateDPoPKeyPair();
    const pkce = pkcePair();
    codeVerifier = pkce.codeVerifier;
    codeChallenge = pkce.codeChallenge;
    state = `state-mobile-${Date.now()}`;
    nonce = `nonce-mobile-${Date.now()}`;
    flow.note('Mobile app generates ES256 DPoP key pair + PKCE S256 challenge + state + nonce');
  });

  it('step 4: pushed authorization request (PAR)', async () => {
    const body = {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const res = await flow.step<{ request_uri: string; expires_in: number }>(
      'Push Authorization Request (PAR)',
      () => api.post('/oauth/par', { body, headers }),
      { method: 'POST', path: '/oauth/par', body, headers },
    );
    expect(res.status).toBe(201);
    expect(res.data.request_uri).toMatch(/^urn:ietf:params:oauth:request_uri:/);
    requestUri = res.data.request_uri;
    flow.note('Auth params sent server-side via PAR — browser URL only carries opaque request_uri');
  });

  it('step 5: authorize with request_uri (system browser)', async () => {
    const query = { request_uri: requestUri, client_id: clientId };
    const res = await flow.step<{ type: string }>(
      'Authorize via request_uri',
      () => api.get('/oauth/authorize', { query, token: userToken }),
      { method: 'GET', path: '/oauth/authorize', body: query },
    );

    if (res.status === 302) {
      const location = res.headers.get('location') ?? '';
      authorizationCode = codeFromLocation(location);
    } else {
      expect(res.status).toBe(200);
      expect(res.data.type).toBe('consent_required');

      const consentBody = {
        client_id: clientId,
        scope: SCOPE,
        decision: 'approve',
        state,
        redirect_uri: REDIRECT_URI,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        nonce,
      };
      const consentRes = await flow.step(
        'User consents in system browser',
        () => api.post('/oauth/consent', { body: consentBody, token: userToken }),
        { method: 'POST', path: '/oauth/consent', body: consentBody },
      );
      expect(consentRes.status).toBe(302);
      authorizationCode = codeFromLocation(consentRes.headers.get('location') ?? '');
    }
  });

  it('step 6: token exchange with DPoP proof', async () => {
    const tokenUrl = `${BASE_URL}/oauth/token`;
    const dpopProof = await createDPoPProof(dpopKeyPair, 'POST', tokenUrl);

    const body = {
      grant_type: 'authorization_code',
      code: authorizationCode,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    };
    const headers = {
      authorization: basicAuth(clientId, clientSecret),
      dpop: dpopProof,
    };
    const res = await flow.step<{
      access_token: string;
      refresh_token: string;
      token_type: string;
      id_token: string;
    }>('Exchange code for DPoP-bound tokens', () => api.post('/oauth/token', { body, headers }), {
      method: 'POST',
      path: '/oauth/token',
      body,
      headers,
    });
    expect(res.status).toBe(200);
    expect(res.data.token_type).toBe('DPoP');
    accessToken = res.data.access_token;
    refreshToken = res.data.refresh_token;
    flow.note('token_type is "DPoP" — token is bound to the mobile device\'s key pair');
  });

  it('step 7: verify access token has cnf.jkt claim', async () => {
    const decoded = jose.decodeJwt(accessToken);
    expect(decoded.cnf).toBeDefined();
    expect((decoded.cnf as { jkt: string }).jkt).toBeDefined();
    flow.note(
      `Access token cnf.jkt = ${(decoded.cnf as { jkt: string }).jkt} (DPoP key thumbprint)`,
    );
  });

  it('step 8: userinfo with DPoP proof', async () => {
    const userinfoUrl = `${BASE_URL}/oauth/userinfo`;
    const dpopProof = await createDPoPProof(dpopKeyPair, 'GET', userinfoUrl, accessToken);

    const headers = {
      authorization: `DPoP ${accessToken}`,
      dpop: dpopProof,
    };
    const res = await flow.step<{ sub: string; email: string }>(
      'Get userinfo with DPoP proof',
      () => api.get('/oauth/userinfo', { headers }),
      { method: 'GET', path: '/oauth/userinfo', headers },
    );
    expect(res.status).toBe(200);
    expect(res.data.email).toBe(userEmail);
  });

  it('step 9: refresh token with DPoP proof (rotation)', async () => {
    const tokenUrl = `${BASE_URL}/oauth/token`;
    const dpopProof = await createDPoPProof(dpopKeyPair, 'POST', tokenUrl);

    const body = { grant_type: 'refresh_token', refresh_token: refreshToken };
    const headers = {
      authorization: basicAuth(clientId, clientSecret),
      dpop: dpopProof,
    };
    const res = await flow.step<{ access_token: string; refresh_token: string }>(
      'Refresh token with DPoP (rotation)',
      () => api.post('/oauth/token', { body, headers }),
      { method: 'POST', path: '/oauth/token', body, headers },
    );
    expect(res.status).toBe(200);
    expect(res.data.access_token).not.toBe(accessToken);
    expect(res.data.refresh_token).not.toBe(refreshToken);
    accessToken = res.data.access_token;
    refreshToken = res.data.refresh_token;
  });

  it('step 10: revoke refresh token', async () => {
    const body = { token: refreshToken };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const res = await flow.step(
      'Revoke refresh token',
      () => api.post('/oauth/revoke', { body, headers }),
      { method: 'POST', path: '/oauth/revoke', body, headers },
    );
    expect(res.status).toBe(200);
  });

  it('step 11: verify revoked token is inactive', async () => {
    const body = { token: refreshToken, token_type_hint: 'refresh_token' };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const res = await flow.step<{ active: boolean }>(
      'Introspect revoked token',
      () => api.post('/oauth/introspect', { body, headers }),
      { method: 'POST', path: '/oauth/introspect', body, headers },
    );
    expect(res.status).toBe(200);
    expect(res.data.active).toBe(false);
    flow.note('Refresh token revoked — mobile app must clear local storage and re-authenticate');
  });
});
