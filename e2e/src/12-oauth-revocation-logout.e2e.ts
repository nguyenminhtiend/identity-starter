import { ADMIN_EMAIL, ADMIN_PASSWORD } from './helpers/constants.js';
import { basicAuth, codeFromLocation, pkcePair } from './helpers/crypto.js';
import { api } from './helpers/http-client.js';

const REDIRECT_URI = 'https://example.com/callback';
const SCOPE = 'openid profile email';

describe('OAuth Token Revocation & RP-Initiated Logout', () => {
  let adminToken: string;
  let clientId: string;
  let clientSecret: string;

  it('sets up OAuth client', async () => {
    const loginRes = await api.post<{ token: string }>('/api/auth/login', {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    adminToken = loginRes.data.token;

    const clientRes = await api.post<{ clientId: string; clientSecret: string }>(
      '/api/admin/clients',
      {
        body: {
          clientName: 'E2E Revocation Client',
          redirectUris: [REDIRECT_URI],
          grantTypes: ['authorization_code', 'refresh_token'],
          scope: SCOPE,
          tokenEndpointAuthMethod: 'client_secret_basic',
          isConfidential: true,
        },
        token: adminToken,
      },
    );
    clientId = clientRes.data.clientId;
    clientSecret = clientRes.data.clientSecret;
  });

  async function obtainTokens(): Promise<{
    accessToken: string;
    refreshToken: string;
    idToken: string;
  }> {
    const { codeVerifier, codeChallenge } = pkcePair();
    const state = `state-${Date.now()}-${Math.random()}`;
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

    let code: string;
    if (authRes.status === 302) {
      const location = authRes.headers.get('location');
      if (!location) {
        throw new Error('expected Location header');
      }
      code = codeFromLocation(location);
    } else {
      const consentRes = await api.post('/oauth/consent', {
        body: {
          client_id: clientId,
          scope: SCOPE,
          decision: 'approve',
          state,
          redirect_uri: REDIRECT_URI,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          nonce,
        },
        token: adminToken,
      });
      const location = consentRes.headers.get('location');
      if (!location) {
        throw new Error('expected Location header from consent');
      }
      code = codeFromLocation(location);
    }

    const tokenRes = await api.post<{
      access_token: string;
      refresh_token: string;
      id_token: string;
    }>('/oauth/token', {
      body: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: codeVerifier,
      },
      headers: { authorization: basicAuth(clientId, clientSecret) },
    });

    return {
      accessToken: tokenRes.data.access_token,
      refreshToken: tokenRes.data.refresh_token,
      idToken: tokenRes.data.id_token,
    };
  }

  it('access token introspection shows active for valid JWT', async () => {
    const tokens = await obtainTokens();

    const activeRes = await api.post<{ active: boolean; sub: string }>('/oauth/introspect', {
      body: { token: tokens.accessToken },
      headers: { authorization: basicAuth(clientId, clientSecret) },
    });
    expect(activeRes.status).toBe(200);
    expect(activeRes.data.active).toBe(true);
    expect(activeRes.data.sub).toBeDefined();
  });

  it('revoke refresh token → introspection shows inactive', async () => {
    const tokens = await obtainTokens();

    const activeRes = await api.post<{ active: boolean }>('/oauth/introspect', {
      body: { token: tokens.refreshToken, token_type_hint: 'refresh_token' },
      headers: { authorization: basicAuth(clientId, clientSecret) },
    });
    expect(activeRes.data.active).toBe(true);

    await api.post('/oauth/revoke', {
      body: { token: tokens.refreshToken, token_type_hint: 'refresh_token' },
      headers: { authorization: basicAuth(clientId, clientSecret) },
    });

    const inactiveRes = await api.post<{ active: boolean }>('/oauth/introspect', {
      body: { token: tokens.refreshToken, token_type_hint: 'refresh_token' },
      headers: { authorization: basicAuth(clientId, clientSecret) },
    });
    expect(inactiveRes.data.active).toBe(false);
  });

  it('revoke refresh token → cannot refresh anymore', async () => {
    const tokens = await obtainTokens();

    const revokeRes = await api.post('/oauth/revoke', {
      body: { token: tokens.refreshToken, token_type_hint: 'refresh_token' },
      headers: { authorization: basicAuth(clientId, clientSecret) },
    });
    expect(revokeRes.status).toBe(200);

    const refreshRes = await api.post('/oauth/token', {
      body: { grant_type: 'refresh_token', refresh_token: tokens.refreshToken },
      headers: { authorization: basicAuth(clientId, clientSecret) },
    });
    expect(refreshRes.status).toBe(401);
  });

  it('revoke unknown token returns 200 (RFC 7009 requires no error)', async () => {
    const revokeRes = await api.post('/oauth/revoke', {
      body: { token: 'completely-invalid-token-value' },
      headers: { authorization: basicAuth(clientId, clientSecret) },
    });
    expect(revokeRes.status).toBe(200);
  });

  it('RP-Initiated Logout: end-session with id_token_hint redirects', async () => {
    const tokens = await obtainTokens();

    const endSessionRes = await api.get('/oauth/end-session', {
      query: {
        id_token_hint: tokens.idToken,
        post_logout_redirect_uri: REDIRECT_URI,
      },
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(endSessionRes.status).toBe(302);
    const location = endSessionRes.headers.get('location');
    expect(location).toBeDefined();
    expect(location).toContain('example.com/callback');
  });

  it('RP-Initiated Logout: end-session without params redirects to issuer', async () => {
    const endSessionRes = await api.get('/oauth/end-session');

    expect(endSessionRes.status).toBe(302);
    const location = endSessionRes.headers.get('location');
    expect(location).toBeDefined();
    expect(location).toContain('localhost:3001');
  });
});
