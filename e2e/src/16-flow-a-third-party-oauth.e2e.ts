// e2e/src/16-flow-a-third-party-oauth.e2e.ts
import * as jose from 'jose';
import { ADMIN_EMAIL, ADMIN_PASSWORD, TEST_PASSWORD } from './helpers/constants.js';
import { basicAuth, codeFromLocation, pkcePair, uniqueEmail } from './helpers/crypto.js';
import { createFlowLogger } from './helpers/flow-logger.js';
import { api } from './helpers/http-client.js';

const REDIRECT_URI = 'https://thirdparty.example.com/callback';
const SCOPE = 'openid profile email';

describe('Flow A: Third-Party Web App (OAuth 2.1)', () => {
  const flow = createFlowLogger('Flow A: Third-Party Web App (OAuth 2.1)');
  const userEmail = uniqueEmail('flow-a');
  let adminToken: string;
  let clientId: string;
  let clientSecret: string;
  let userToken: string;
  let verificationToken: string;
  let codeVerifier: string;
  let codeChallenge: string;
  let state: string;
  let nonce: string;
  let authorizationCode: string;
  let accessToken: string;
  let refreshToken: string;
  let idToken: string;

  beforeAll(() => {
    flow.banner();
  });

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

  it('step 2: admin registers OAuth client for third-party app', async () => {
    const body = {
      clientName: 'Acme Corp (Flow A)',
      redirectUris: [REDIRECT_URI],
      grantTypes: ['authorization_code', 'refresh_token'],
      scope: SCOPE,
      tokenEndpointAuthMethod: 'client_secret_basic',
      isConfidential: true,
    };
    const res = await flow.step<{ clientId: string; clientSecret: string }>(
      'Register OAuth client',
      () => api.post('/api/admin/clients', { body, token: adminToken }),
      { method: 'POST', path: '/api/admin/clients', body },
    );
    expect(res.status).toBe(201);
    clientId = res.data.clientId;
    clientSecret = res.data.clientSecret;
  });

  it('step 3: user registers on IdP', async () => {
    const body = { email: userEmail, password: TEST_PASSWORD, displayName: 'Flow A User' };
    const res = await flow.step<{ token: string; verificationToken: string }>(
      'User registers',
      () => api.post('/api/auth/register', { body }),
      { method: 'POST', path: '/api/auth/register', body },
    );
    expect(res.status).toBe(201);
    userToken = res.data.token;
    verificationToken = res.data.verificationToken;
  });

  it('step 4: user verifies email', async () => {
    const body = { token: verificationToken };
    const res = await flow.step(
      'Verify email',
      () => api.post('/api/auth/verify-email', { body }),
      { method: 'POST', path: '/api/auth/verify-email', body },
    );
    expect(res.status).toBe(200);
  });

  it('step 5: user logs in (gets session for authorize)', async () => {
    const body = { email: userEmail, password: TEST_PASSWORD };
    const res = await flow.step<{ token: string }>(
      'User logs in',
      () => api.post('/api/auth/login', { body }),
      { method: 'POST', path: '/api/auth/login', body },
    );
    expect(res.status).toBe(200);
    userToken = res.data.token;
  });

  it('step 6: third-party app generates PKCE pair and redirects to authorize', async () => {
    const pkce = pkcePair();
    codeVerifier = pkce.codeVerifier;
    codeChallenge = pkce.codeChallenge;
    state = `state-${Date.now()}`;
    nonce = `nonce-${Date.now()}`;

    flow.note(
      'Third-party app generates code_verifier + S256 challenge, state, and nonce client-side',
    );

    const query = {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      scope: SCOPE,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      nonce,
    };
    const res = await flow.step<{ type: string }>(
      'Authorize request (expect consent required)',
      () => api.get('/oauth/authorize', { query, token: userToken }),
      { method: 'GET', path: '/oauth/authorize', body: query },
    );
    expect(res.status).toBe(200);
    expect(res.data.type).toBe('consent_required');
  });

  it('step 7: user approves consent on IdP page', async () => {
    const body = {
      client_id: clientId,
      scope: SCOPE,
      decision: 'approve',
      state,
      redirect_uri: REDIRECT_URI,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      nonce,
    };
    const res = await flow.step(
      'User approves consent',
      () => api.post('/oauth/consent', { body, token: userToken }),
      { method: 'POST', path: '/oauth/consent', body },
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toContain('thirdparty.example.com/callback');
    expect(location).toContain(`state=${state}`);
    authorizationCode = codeFromLocation(location);
  });

  it('step 8: third-party server exchanges code for tokens', async () => {
    const body = {
      grant_type: 'authorization_code',
      code: authorizationCode,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const res = await flow.step<{
      access_token: string;
      refresh_token: string;
      id_token: string;
      token_type: string;
      expires_in: number;
      scope: string;
    }>(
      'Exchange authorization code for tokens',
      () => api.post('/oauth/token', { body, headers }),
      { method: 'POST', path: '/oauth/token', body, headers },
    );
    expect(res.status).toBe(200);
    expect(res.data.token_type).toBe('Bearer');
    expect(res.data.scope).toBe(SCOPE);
    accessToken = res.data.access_token;
    refreshToken = res.data.refresh_token;
    idToken = res.data.id_token;
  });

  it('step 9: verify access_token JWT via JWKS', async () => {
    const jwksRes = await flow.step<jose.JSONWebKeySet>(
      'Fetch JWKS public keys',
      () => api.get('/.well-known/jwks.json'),
      { method: 'GET', path: '/.well-known/jwks.json' },
    );
    const jwks = jose.createLocalJWKSet(jwksRes.data);
    const { payload } = await jose.jwtVerify(accessToken, jwks, {
      issuer: 'http://localhost:3001',
      audience: clientId,
    });
    expect(payload.sub).toBeDefined();
    expect(payload.scope).toBe(SCOPE);
    flow.note(`Access token verified: sub=${payload.sub}, scope=${payload.scope}`);
  });

  it('step 10: verify id_token claims', async () => {
    const decoded = jose.decodeJwt(idToken);
    expect(decoded.nonce).toBe(nonce);
    expect(decoded.aud).toBe(clientId);
    expect(decoded.sub).toBeDefined();
    flow.note(`ID token: nonce=${decoded.nonce}, aud=${decoded.aud}, sub=${decoded.sub}`);
  });

  it('step 11: fetch userinfo with access token', async () => {
    const headers = { authorization: `Bearer ${accessToken}` };
    const res = await flow.step<{ sub: string; email: string; name: string }>(
      'Get userinfo',
      () => api.get('/oauth/userinfo', { headers }),
      { method: 'GET', path: '/oauth/userinfo', headers },
    );
    expect(res.status).toBe(200);
    expect(res.data.sub).toBeDefined();
    expect(res.data.email).toBe(userEmail);
  });

  it('step 12: introspect access token (active)', async () => {
    const body = { token: accessToken };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const res = await flow.step<{ active: boolean; sub: string }>(
      'Introspect access token',
      () => api.post('/oauth/introspect', { body, headers }),
      { method: 'POST', path: '/oauth/introspect', body, headers },
    );
    expect(res.status).toBe(200);
    expect(res.data.active).toBe(true);
  });

  it('step 13: refresh token rotation', async () => {
    const body = { grant_type: 'refresh_token', refresh_token: refreshToken };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const res = await flow.step<{ access_token: string; refresh_token: string }>(
      'Refresh token (rotation)',
      () => api.post('/oauth/token', { body, headers }),
      { method: 'POST', path: '/oauth/token', body, headers },
    );
    expect(res.status).toBe(200);
    expect(res.data.access_token).not.toBe(accessToken);
    expect(res.data.refresh_token).not.toBe(refreshToken);
    flow.note('Both access_token and refresh_token rotated — old tokens replaced');
    accessToken = res.data.access_token;
    refreshToken = res.data.refresh_token;
  });

  it('step 14: revoke refresh token', async () => {
    const body = { token: refreshToken, token_type_hint: 'refresh_token' };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const res = await flow.step(
      'Revoke refresh token',
      () => api.post('/oauth/revoke', { body, headers }),
      { method: 'POST', path: '/oauth/revoke', body, headers },
    );
    expect(res.status).toBe(200);
  });

  it('step 15: verify revoked token is inactive', async () => {
    const body = { token: refreshToken, token_type_hint: 'refresh_token' };
    const headers = { authorization: basicAuth(clientId, clientSecret) };
    const res = await flow.step<{ active: boolean }>(
      'Introspect revoked token (expect inactive)',
      () => api.post('/oauth/introspect', { body, headers }),
      { method: 'POST', path: '/oauth/introspect', body, headers },
    );
    expect(res.status).toBe(200);
    expect(res.data.active).toBe(false);
  });

  it('step 16: RP-initiated logout', async () => {
    const query = {
      id_token_hint: idToken,
      post_logout_redirect_uri: REDIRECT_URI,
    };
    const res = await flow.step(
      'End session (RP-initiated logout)',
      () => api.get('/oauth/end-session', { query }),
      { method: 'GET', path: '/oauth/end-session', body: query },
    );
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toContain('thirdparty.example.com/callback');
  });
});
