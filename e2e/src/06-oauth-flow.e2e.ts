import * as jose from 'jose';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './helpers/constants.js';
import { basicAuth, codeFromLocation, pkcePair } from './helpers/crypto.js';
import { api } from './helpers/http-client.js';

const REDIRECT_URI = 'https://example.com/callback';
const SCOPE = 'openid profile email';

async function approveConsent(
  token: string,
  clientId: string,
  state: string,
  codeChallenge: string,
  nonce?: string,
): Promise<string> {
  const res = await api.post('/oauth/consent', {
    body: {
      client_id: clientId,
      scope: SCOPE,
      decision: 'approve',
      state,
      redirect_uri: REDIRECT_URI,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      ...(nonce ? { nonce } : {}),
    },
    token,
  });
  expect(res.status).toBe(302);
  const location = res.headers.get('location');
  if (!location) {
    throw new Error('expected Location header from consent');
  }
  return codeFromLocation(location);
}

describe('OAuth2/OIDC Flow', () => {
  let adminToken: string;
  let clientId: string;
  let clientSecret: string;

  it('admin logs in and creates OAuth client', async () => {
    const loginRes = await api.post<{ token: string }>('/api/auth/login', {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.data.token;

    const clientRes = await api.post<{ clientId: string; clientSecret: string }>(
      '/api/admin/clients',
      {
        body: {
          clientName: 'E2E OAuth App',
          redirectUris: [REDIRECT_URI],
          grantTypes: ['authorization_code', 'refresh_token', 'client_credentials'],
          scope: SCOPE,
          tokenEndpointAuthMethod: 'client_secret_basic',
          isConfidential: true,
        },
        token: adminToken,
      },
    );
    expect(clientRes.status).toBe(201);
    clientId = clientRes.data.clientId;
    clientSecret = clientRes.data.clientSecret;
  });

  it('full authorization code flow with PKCE + JWTs + userinfo', async () => {
    const { codeVerifier, codeChallenge } = pkcePair();
    const state = `state-${Date.now()}`;
    const nonce = `nonce-${Date.now()}`;

    const authRes = await api.get<{ type: string }>('/oauth/authorize', {
      query: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        nonce,
      },
      token: adminToken,
    });
    expect(authRes.status).toBe(200);
    expect(authRes.data.type).toBe('consent_required');

    const code = await approveConsent(adminToken, clientId, state, codeChallenge, nonce);

    const tokenRes = await api.post<{
      access_token: string;
      refresh_token: string;
      id_token: string;
      token_type: string;
      expires_in: number;
      scope: string;
    }>('/oauth/token', {
      body: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
      },
      headers: { authorization: basicAuth(clientId, clientSecret) },
    });
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.data.token_type).toBe('Bearer');
    expect(tokenRes.data.refresh_token).toBeDefined();
    expect(tokenRes.data.id_token).toBeDefined();
    expect(tokenRes.data.scope).toBe(SCOPE);

    const jwksRes = await api.get<jose.JSONWebKeySet>('/.well-known/jwks.json');
    const jwks = jose.createLocalJWKSet(jwksRes.data);
    const { payload } = await jose.jwtVerify(tokenRes.data.access_token, jwks, {
      issuer: 'http://localhost:3001',
      audience: clientId,
    });
    expect(payload.sub).toBeDefined();
    expect(payload.scope).toBe(SCOPE);

    const idDecoded = jose.decodeJwt(tokenRes.data.id_token);
    expect(idDecoded.nonce).toBe(nonce);
    expect(idDecoded.aud).toBe(clientId);

    const userinfoRes = await api.get<{ sub: string; name: string; email: string }>(
      '/oauth/userinfo',
      { headers: { authorization: `Bearer ${tokenRes.data.access_token}` } },
    );
    expect(userinfoRes.status).toBe(200);
    expect(userinfoRes.data.sub).toBe(payload.sub);
  });

  it('refresh token rotation: new token issued, old and new both distinct', async () => {
    const { codeVerifier, codeChallenge } = pkcePair();
    const state = `state-rotate-${Date.now()}`;

    await api.get('/oauth/authorize', {
      query: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      },
      token: adminToken,
    });

    const code = await approveConsent(adminToken, clientId, state, codeChallenge);

    const tokenRes = await api.post<{ access_token: string; refresh_token: string }>(
      '/oauth/token',
      {
        body: {
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          code_verifier: codeVerifier,
        },
        headers: { authorization: basicAuth(clientId, clientSecret) },
      },
    );
    const firstRefresh = tokenRes.data.refresh_token;

    const refreshRes = await api.post<{ access_token: string; refresh_token: string }>(
      '/oauth/token',
      {
        body: { grant_type: 'refresh_token', refresh_token: firstRefresh },
        headers: { authorization: basicAuth(clientId, clientSecret) },
      },
    );
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.data.access_token).not.toBe(tokenRes.data.access_token);
    expect(refreshRes.data.refresh_token).not.toBe(firstRefresh);

    const secondRefresh = await api.post<{ access_token: string; refresh_token: string }>(
      '/oauth/token',
      {
        body: { grant_type: 'refresh_token', refresh_token: refreshRes.data.refresh_token },
        headers: { authorization: basicAuth(clientId, clientSecret) },
      },
    );
    expect(secondRefresh.status).toBe(200);
    expect(secondRefresh.data.access_token).not.toBe(refreshRes.data.access_token);
    expect(secondRefresh.data.refresh_token).not.toBe(refreshRes.data.refresh_token);
  });

  it('PKCE: wrong code_verifier fails token exchange', async () => {
    const { codeChallenge } = pkcePair();
    const state = `state-pkce-${Date.now()}`;

    await api.get('/oauth/authorize', {
      query: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      },
      token: adminToken,
    });

    const code = await approveConsent(adminToken, clientId, state, codeChallenge);
    const wrongVerifier = 'this-is-definitely-not-the-right-verifier-value-at-all';

    const tokenRes = await api.post('/oauth/token', {
      body: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: wrongVerifier,
      },
      headers: { authorization: basicAuth(clientId, clientSecret) },
    });

    expect(tokenRes.status).toBe(401);
  });

  it('token introspection: active vs revoked', async () => {
    const { codeVerifier, codeChallenge } = pkcePair();
    const state = `state-intro-${Date.now()}`;

    await api.get('/oauth/authorize', {
      query: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      },
      token: adminToken,
    });

    const code = await approveConsent(adminToken, clientId, state, codeChallenge);

    const tokenRes = await api.post<{ access_token: string; refresh_token: string }>(
      '/oauth/token',
      {
        body: {
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          code_verifier: codeVerifier,
        },
        headers: { authorization: basicAuth(clientId, clientSecret) },
      },
    );

    const activeRes = await api.post<{ active: boolean; sub: string }>('/oauth/introspect', {
      body: { token: tokenRes.data.access_token },
      headers: { authorization: basicAuth(clientId, clientSecret) },
    });
    expect(activeRes.status).toBe(200);
    expect(activeRes.data.active).toBe(true);

    await api.post('/oauth/revoke', {
      body: { token: tokenRes.data.refresh_token },
      headers: { authorization: basicAuth(clientId, clientSecret) },
    });

    const revokedRes = await api.post<{ active: boolean }>('/oauth/introspect', {
      body: { token: tokenRes.data.refresh_token, token_type_hint: 'refresh_token' },
      headers: { authorization: basicAuth(clientId, clientSecret) },
    });
    expect(revokedRes.status).toBe(200);
    expect(revokedRes.data.active).toBe(false);
  });

  it('PAR flow: push request → authorize with request_uri → exchange', async () => {
    const { codeVerifier, codeChallenge } = pkcePair();
    const state = `state-par-${Date.now()}`;

    const parRes = await api.post<{ request_uri: string; expires_in: number }>('/oauth/par', {
      body: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
      },
      headers: { authorization: basicAuth(clientId, clientSecret) },
    });
    expect(parRes.status).toBe(201);
    expect(parRes.data.request_uri).toMatch(/^urn:ietf:params:oauth:request_uri:/);

    const authRes = await api.get<{ type: string }>('/oauth/authorize', {
      query: { request_uri: parRes.data.request_uri, client_id: clientId },
      token: adminToken,
    });

    let code: string;
    if (authRes.status === 302) {
      const location = authRes.headers.get('location');
      if (!location) {
        throw new Error('expected Location header');
      }
      code = codeFromLocation(location);
    } else {
      expect(authRes.status).toBe(200);
      expect(authRes.data.type).toBe('consent_required');
      code = await approveConsent(adminToken, clientId, state, codeChallenge);
    }

    const tokenRes = await api.post<{ access_token: string }>('/oauth/token', {
      body: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
      },
      headers: { authorization: basicAuth(clientId, clientSecret) },
    });
    expect(tokenRes.status).toBe(200);
    expect(tokenRes.data.access_token).toBeDefined();
  });

  it('client credentials flow', async () => {
    const tokenRes = await api.post<{
      access_token: string;
      token_type: string;
      refresh_token?: string;
      id_token?: string;
    }>('/oauth/token', {
      body: { grant_type: 'client_credentials' },
      headers: { authorization: basicAuth(clientId, clientSecret) },
    });

    expect(tokenRes.status).toBe(200);
    expect(tokenRes.data.token_type).toBe('Bearer');
    expect(tokenRes.data.refresh_token).toBeUndefined();
    expect(tokenRes.data.id_token).toBeUndefined();
  });

  it('consent revocation: DELETE /oauth/consent/:clientId', async () => {
    const { codeVerifier, codeChallenge } = pkcePair();
    const state = `state-consent-del-${Date.now()}`;

    await api.get('/oauth/authorize', {
      query: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      },
      token: adminToken,
    });

    const code = await approveConsent(adminToken, clientId, state, codeChallenge);

    const tokenRes = await api.post<{ refresh_token: string }>('/oauth/token', {
      body: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
      },
      headers: { authorization: basicAuth(clientId, clientSecret) },
    });

    const delRes = await api.delete(`/oauth/consent/${clientId}`, { token: adminToken });
    expect(delRes.status).toBe(204);

    const failRefresh = await api.post('/oauth/token', {
      body: { grant_type: 'refresh_token', refresh_token: tokenRes.data.refresh_token },
      headers: { authorization: basicAuth(clientId, clientSecret) },
    });
    expect(failRefresh.status).toBe(401);

    const reAuthRes = await api.get<{ type: string }>('/oauth/authorize', {
      query: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
        state: `state-re-${Date.now()}`,
        code_challenge: pkcePair().codeChallenge,
        code_challenge_method: 'S256',
      },
      token: adminToken,
    });
    expect(reAuthRes.status).toBe(200);
    expect(reAuthRes.data.type).toBe('consent_required');
  });
});
