import { createHash, randomBytes } from 'node:crypto';
import { users } from '@identity-starter/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import * as jose from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../../core/env.js';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import { buildTestApp } from '../../../test/app-builder.js';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';

const redirectUri = 'https://example.com/callback';
const scope = 'openid profile email';

function pkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

function codeFromLocation(location: string): string {
  const url = new URL(location);
  const code = url.searchParams.get('code');
  if (!code) {
    throw new Error('expected code in redirect Location');
  }
  return code;
}

async function registerAdminAndCreateClient(
  app: FastifyInstance,
  testDb: TestDb,
  label: string,
): Promise<{
  sessionToken: string;
  user: { id: string; email: string; displayName: string };
  clientId: string;
  clientSecret: string;
}> {
  const email = `oauth-${label}-${randomBytes(4).toString('hex')}@example.com`;
  const registerRes = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      email,
      password: 'Password123!',
      displayName: 'Test User',
    },
  });
  expect(registerRes.statusCode).toBe(201);
  const reg = registerRes.json() as {
    token: string;
    user: { id: string; email: string; displayName: string };
  };
  const { token: sessionToken, user } = reg;

  await testDb.db
    .update(users)
    .set({ isAdmin: true, status: 'active' })
    .where(eq(users.id, user.id));

  const clientRes = await app.inject({
    method: 'POST',
    url: '/api/admin/clients',
    headers: { authorization: `Bearer ${sessionToken}` },
    payload: {
      clientName: `Test App ${label}`,
      redirectUris: [redirectUri],
      grantTypes: ['authorization_code', 'refresh_token'],
      scope,
      tokenEndpointAuthMethod: 'client_secret_basic',
      isConfidential: true,
    },
  });
  expect(clientRes.statusCode).toBe(201);
  const client = clientRes.json() as { clientId: string; clientSecret: string };
  return { sessionToken, user, clientId: client.clientId, clientSecret: client.clientSecret };
}

async function approveConsentAndGetCode(
  app: FastifyInstance,
  sessionToken: string,
  clientId: string,
  state: string,
  codeChallenge: string,
  nonce?: string,
): Promise<string> {
  const consentRes = await app.inject({
    method: 'POST',
    url: '/oauth/consent',
    headers: { authorization: `Bearer ${sessionToken}` },
    payload: {
      client_id: clientId,
      scope,
      decision: 'approve',
      state,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      ...(nonce !== undefined ? { nonce } : {}),
    },
  });
  expect(consentRes.statusCode).toBe(302);
  const location = consentRes.headers.location;
  if (!location) {
    throw new Error('expected Location header from consent');
  }
  return codeFromLocation(location);
}

describe('OAuth2/OIDC routes integration', () => {
  let testDb: TestDb;
  let app: FastifyInstance;

  beforeAll(async () => {
    testDb = await createTestDb();
    app = await buildTestApp({ db: testDb.db, eventBus: new InMemoryEventBus() });
  });

  afterAll(async () => {
    await app.close();
    await testDb.teardown();
  });

  it('full authorization code flow: register → client → authorize → consent → token → userinfo + JWTs', async () => {
    const { sessionToken, user, clientId, clientSecret } = await registerAdminAndCreateClient(
      app,
      testDb,
      'full',
    );
    const { codeVerifier, codeChallenge } = pkcePair();
    const state = 'state-full';
    const nonce = 'test-nonce';

    const authorizeRes = await app.inject({
      method: 'GET',
      url: '/oauth/authorize',
      headers: { authorization: `Bearer ${sessionToken}` },
      query: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        nonce,
      },
    });
    expect(authorizeRes.statusCode).toBe(200);
    expect((authorizeRes.json() as { type: string }).type).toBe('consent_required');

    const code = await approveConsentAndGetCode(
      app,
      sessionToken,
      clientId,
      state,
      codeChallenge,
      nonce,
    );

    const tokenRes = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuthHeader(clientId, clientSecret),
      },
      payload: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      },
    });
    expect(tokenRes.statusCode).toBe(200);
    const tokens = tokenRes.json() as {
      access_token: string;
      refresh_token: string;
      id_token: string;
      token_type: string;
      expires_in: number;
      scope: string;
    };
    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.refresh_token).toBeDefined();
    expect(tokens.scope).toBe(scope);
    expect(tokens.expires_in).toBe(env.ACCESS_TOKEN_TTL_SECONDS);

    const jwksRes = await app.inject({ method: 'GET', url: '/.well-known/jwks.json' });
    expect(jwksRes.statusCode).toBe(200);
    const jwks = jose.createLocalJWKSet(jwksRes.json() as jose.JSONWebKeySet);

    const { payload: accessPayload } = await jose.jwtVerify(tokens.access_token, jwks, {
      issuer: env.JWT_ISSUER,
      audience: clientId,
      algorithms: ['RS256'],
    });
    expect(accessPayload.sub).toBe(user.id);
    expect(accessPayload.scope).toBe(scope);

    const idDecoded = jose.decodeJwt(tokens.id_token);
    expect(idDecoded.sub).toBe(user.id);
    expect(idDecoded.aud).toBe(clientId);
    expect(idDecoded.nonce).toBe(nonce);
    expect(idDecoded.at_hash).toBeDefined();
    expect(idDecoded.acr).toBe('0');
    expect(idDecoded.amr).toEqual(['pwd']);

    const userinfoRes = await app.inject({
      method: 'GET',
      url: '/oauth/userinfo',
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    expect(userinfoRes.statusCode).toBe(200);
    const userinfo = userinfoRes.json() as {
      sub: string;
      name?: string;
      email?: string;
      email_verified?: boolean;
    };
    expect(userinfo.sub).toBe(user.id);
    expect(userinfo.name).toBe('Test User');
    expect(userinfo.email).toBe(user.email);
    expect(userinfo.email_verified).toBe(false);
  });

  it('refresh token rotation: new refresh token works; old token fails after grace', async () => {
    const { sessionToken, clientId, clientSecret } = await registerAdminAndCreateClient(
      app,
      testDb,
      'rotate',
    );
    const { codeVerifier, codeChallenge } = pkcePair();
    const state = 'state-rotate';

    await app.inject({
      method: 'GET',
      url: '/oauth/authorize',
      headers: { authorization: `Bearer ${sessionToken}` },
      query: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      },
    });
    const code = await approveConsentAndGetCode(app, sessionToken, clientId, state, codeChallenge);

    const tokenRes = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuthHeader(clientId, clientSecret),
      },
      payload: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      },
    });
    expect(tokenRes.statusCode).toBe(200);
    const first = tokenRes.json() as { refresh_token: string; access_token: string };

    const refreshRes = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuthHeader(clientId, clientSecret),
      },
      payload: {
        grant_type: 'refresh_token',
        refresh_token: first.refresh_token,
      },
    });
    expect(refreshRes.statusCode).toBe(200);
    const second = refreshRes.json() as { refresh_token: string; access_token: string };
    expect(second.access_token).not.toBe(first.access_token);
    expect(second.refresh_token).not.toBe(first.refresh_token);

    await sleep(env.REFRESH_GRACE_PERIOD_SECONDS * 1000 + 500);

    const oldReplay = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuthHeader(clientId, clientSecret),
      },
      payload: {
        grant_type: 'refresh_token',
        refresh_token: first.refresh_token,
      },
    });
    expect(oldReplay.statusCode).toBe(401);
  });

  it('PKCE: wrong code_verifier fails token exchange', async () => {
    const { sessionToken, clientId, clientSecret } = await registerAdminAndCreateClient(
      app,
      testDb,
      'pkce',
    );
    const { codeChallenge } = pkcePair();
    const wrongVerifier = randomBytes(32).toString('base64url');
    const state = 'state-pkce';

    await app.inject({
      method: 'GET',
      url: '/oauth/authorize',
      headers: { authorization: `Bearer ${sessionToken}` },
      query: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      },
    });
    const code = await approveConsentAndGetCode(app, sessionToken, clientId, state, codeChallenge);

    const tokenRes = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuthHeader(clientId, clientSecret),
      },
      payload: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: wrongVerifier,
      },
    });
    expect(tokenRes.statusCode).toBe(401);
  });

  it('skips consent screen when scopes already granted', async () => {
    const { sessionToken, clientId } = await registerAdminAndCreateClient(app, testDb, 'skip');
    const { codeChallenge: c1 } = pkcePair();
    const state1 = 'state-skip-1';

    const firstAuthz = await app.inject({
      method: 'GET',
      url: '/oauth/authorize',
      headers: { authorization: `Bearer ${sessionToken}` },
      query: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
        state: state1,
        code_challenge: c1,
        code_challenge_method: 'S256',
      },
    });
    expect(firstAuthz.statusCode).toBe(200);

    await approveConsentAndGetCode(app, sessionToken, clientId, state1, c1);

    const { codeChallenge: c2 } = pkcePair();
    const state2 = 'state-skip-2';

    const secondAuthz = await app.inject({
      method: 'GET',
      url: '/oauth/authorize',
      headers: { authorization: `Bearer ${sessionToken}` },
      query: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
        state: state2,
        code_challenge: c2,
        code_challenge_method: 'S256',
      },
    });
    expect(secondAuthz.statusCode).toBe(302);
    const loc = secondAuthz.headers.location;
    if (!loc) {
      throw new Error('expected redirect');
    }
    expect(loc).toContain(redirectUri);
    const url = new URL(loc);
    expect(url.searchParams.get('state')).toBe(state2);
    expect(url.searchParams.get('code')).toBeTruthy();
  });

  it('revoking refresh token prevents further refresh', async () => {
    const { sessionToken, clientId, clientSecret } = await registerAdminAndCreateClient(
      app,
      testDb,
      'revoke',
    );
    const { codeVerifier, codeChallenge } = pkcePair();
    const state = 'state-revoke';

    await app.inject({
      method: 'GET',
      url: '/oauth/authorize',
      headers: { authorization: `Bearer ${sessionToken}` },
      query: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      },
    });
    const code = await approveConsentAndGetCode(app, sessionToken, clientId, state, codeChallenge);

    const tokenRes = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuthHeader(clientId, clientSecret),
      },
      payload: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      },
    });
    expect(tokenRes.statusCode).toBe(200);
    const first = tokenRes.json() as { refresh_token: string };

    const refreshRes = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuthHeader(clientId, clientSecret),
      },
      payload: {
        grant_type: 'refresh_token',
        refresh_token: first.refresh_token,
      },
    });
    expect(refreshRes.statusCode).toBe(200);
    const refreshed = refreshRes.json() as { refresh_token: string };

    const revokeRes = await app.inject({
      method: 'POST',
      url: '/oauth/revoke',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuthHeader(clientId, clientSecret),
      },
      payload: { token: refreshed.refresh_token },
    });
    expect(revokeRes.statusCode).toBe(200);

    const failedRefresh = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuthHeader(clientId, clientSecret),
      },
      payload: {
        grant_type: 'refresh_token',
        refresh_token: refreshed.refresh_token,
      },
    });
    expect(failedRefresh.statusCode).toBe(401);
  });

  it('replay after grace revokes refresh token family', async () => {
    const { sessionToken, clientId, clientSecret } = await registerAdminAndCreateClient(
      app,
      testDb,
      'replay',
    );
    const { codeVerifier, codeChallenge } = pkcePair();
    const state = 'state-replay';

    await app.inject({
      method: 'GET',
      url: '/oauth/authorize',
      headers: { authorization: `Bearer ${sessionToken}` },
      query: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      },
    });
    const code = await approveConsentAndGetCode(app, sessionToken, clientId, state, codeChallenge);

    const tokenRes = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuthHeader(clientId, clientSecret),
      },
      payload: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      },
    });
    expect(tokenRes.statusCode).toBe(200);
    const rt1 = tokenRes.json() as { refresh_token: string };

    const refresh1 = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuthHeader(clientId, clientSecret),
      },
      payload: {
        grant_type: 'refresh_token',
        refresh_token: rt1.refresh_token,
      },
    });
    expect(refresh1.statusCode).toBe(200);
    const rt2 = refresh1.json() as { refresh_token: string };

    await sleep(env.REFRESH_GRACE_PERIOD_SECONDS * 1000 + 500);

    const reuseOld = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuthHeader(clientId, clientSecret),
      },
      payload: {
        grant_type: 'refresh_token',
        refresh_token: rt1.refresh_token,
      },
    });
    expect(reuseOld.statusCode).toBe(401);
    expect((reuseOld.json() as { error?: string }).error).toContain('reuse');

    const reuseNew = await app.inject({
      method: 'POST',
      url: '/oauth/token',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuthHeader(clientId, clientSecret),
      },
      payload: {
        grant_type: 'refresh_token',
        refresh_token: rt2.refresh_token,
      },
    });
    expect(reuseNew.statusCode).toBe(401);
  });

  it('discovery: OpenID metadata and JWKS', async () => {
    const configRes = await app.inject({
      method: 'GET',
      url: '/.well-known/openid-configuration',
    });
    expect(configRes.statusCode).toBe(200);
    const config = configRes.json() as {
      issuer: string;
      response_types_supported: string[];
      grant_types_supported: string[];
      jwks_uri: string;
    };
    expect(config.issuer).toBe(env.JWT_ISSUER);
    expect(config.response_types_supported).toEqual(['code']);
    expect(config.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);

    const jwksRes = await app.inject({ method: 'GET', url: '/.well-known/jwks.json' });
    expect(jwksRes.statusCode).toBe(200);
    const jwksBody = jwksRes.json() as { keys: jose.JWK[] };
    expect(jwksBody.keys.length).toBeGreaterThan(0);
    const rsa = jwksBody.keys.find((k) => k.kty === 'RSA');
    expect(rsa).toBeDefined();
    expect(rsa?.n).toBeDefined();
    expect(rsa?.e).toBeDefined();
    expect(rsa?.kid).toBeDefined();
  });
});
