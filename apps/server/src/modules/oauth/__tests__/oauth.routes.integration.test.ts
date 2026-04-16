import { createHash, randomBytes, randomUUID } from 'node:crypto';
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

const TOKEN_HTU = 'http://localhost:80/oauth/token';

const issuerBase = env.JWT_ISSUER.replace(/\/$/, '');
const USERINFO_HTU = `${issuerBase}/oauth/userinfo`;

async function generateDpopKeyPair() {
  const { privateKey, publicKey } = await jose.generateKeyPair('ES256', { extractable: true });
  const publicJwk = await jose.exportJWK(publicKey);
  return { privateKey, publicJwk };
}

async function createDpopProof(
  privateKey: jose.CryptoKey,
  publicJwk: jose.JWK,
  method: string,
  url: string,
  accessTokenForAth?: string,
): Promise<string> {
  const payload: Record<string, string | number> = {
    jti: randomUUID(),
    htm: method,
    htu: url,
    iat: Math.floor(Date.now() / 1000),
  };
  if (accessTokenForAth !== undefined) {
    payload.ath = createHash('sha256').update(accessTokenForAth, 'utf8').digest('base64url');
  }
  return new jose.SignJWT(payload)
    .setProtectedHeader({ typ: 'dpop+jwt', alg: 'ES256', jwk: publicJwk })
    .sign(privateKey);
}

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
  grantTypes: string[] = ['authorization_code', 'refresh_token'],
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
      grantTypes,
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

async function parAuthorize(
  app: FastifyInstance,
  sessionToken: string,
  clientId: string,
  clientSecret: string,
  codeChallenge: string,
  state: string,
  nonce?: string,
): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
  const parRes = await app.inject({
    method: 'POST',
    url: '/oauth/par',
    headers: {
      'content-type': 'application/json',
      authorization: basicAuthHeader(clientId, clientSecret),
    },
    payload: {
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      ...(nonce !== undefined ? { nonce } : {}),
    },
  });
  expect(parRes.statusCode).toBe(201);
  const par = parRes.json() as { request_uri: string };

  return app.inject({
    method: 'GET',
    url: '/oauth/authorize',
    headers: { authorization: `Bearer ${sessionToken}` },
    query: { request_uri: par.request_uri, client_id: clientId },
  });
}

async function tokenExchange(
  app: FastifyInstance,
  dpopPrivateKey: jose.CryptoKey,
  dpopPublicJwk: jose.JWK,
  clientId: string,
  clientSecret: string,
  payload: Record<string, string>,
): Promise<Awaited<ReturnType<FastifyInstance['inject']>>> {
  const dpop = await createDpopProof(dpopPrivateKey, dpopPublicJwk, 'POST', TOKEN_HTU);
  return app.inject({
    method: 'POST',
    url: '/oauth/token',
    headers: {
      'content-type': 'application/json',
      authorization: basicAuthHeader(clientId, clientSecret),
      dpop,
    },
    payload,
  });
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
    const { privateKey: dpopPrivateKey, publicJwk: dpopPublicJwk } = await generateDpopKeyPair();
    const { sessionToken, user, clientId, clientSecret } = await registerAdminAndCreateClient(
      app,
      testDb,
      'full',
    );
    const { codeVerifier, codeChallenge } = pkcePair();
    const state = 'state-full';
    const nonce = 'test-nonce';

    const authorizeRes = await parAuthorize(
      app,
      sessionToken,
      clientId,
      clientSecret,
      codeChallenge,
      state,
      nonce,
    );
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

    const tokenRes = await tokenExchange(
      app,
      dpopPrivateKey,
      dpopPublicJwk,
      clientId,
      clientSecret,
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      },
    );
    expect(tokenRes.statusCode).toBe(200);
    const tokens = tokenRes.json() as {
      access_token: string;
      refresh_token: string;
      id_token: string;
      token_type: string;
      expires_in: number;
      scope: string;
    };
    expect(tokens.token_type).toBe('DPoP');
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

    const userinfoDpop = await createDpopProof(
      dpopPrivateKey,
      dpopPublicJwk,
      'GET',
      USERINFO_HTU,
      tokens.access_token,
    );
    const userinfoRes = await app.inject({
      method: 'GET',
      url: '/oauth/userinfo',
      headers: { authorization: `DPoP ${tokens.access_token}`, dpop: userinfoDpop },
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
    const { privateKey: dpopPrivateKey, publicJwk: dpopPublicJwk } = await generateDpopKeyPair();
    const { sessionToken, clientId, clientSecret } = await registerAdminAndCreateClient(
      app,
      testDb,
      'rotate',
    );
    const { codeVerifier, codeChallenge } = pkcePair();
    const state = 'state-rotate';

    await parAuthorize(app, sessionToken, clientId, clientSecret, codeChallenge, state);
    const code = await approveConsentAndGetCode(app, sessionToken, clientId, state, codeChallenge);

    const tokenRes = await tokenExchange(
      app,
      dpopPrivateKey,
      dpopPublicJwk,
      clientId,
      clientSecret,
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      },
    );
    expect(tokenRes.statusCode).toBe(200);
    const first = tokenRes.json() as { refresh_token: string; access_token: string };

    const refreshRes = await tokenExchange(
      app,
      dpopPrivateKey,
      dpopPublicJwk,
      clientId,
      clientSecret,
      {
        grant_type: 'refresh_token',
        refresh_token: first.refresh_token,
      },
    );
    expect(refreshRes.statusCode).toBe(200);
    const second = refreshRes.json() as { refresh_token: string; access_token: string };
    expect(second.access_token).not.toBe(first.access_token);
    expect(second.refresh_token).not.toBe(first.refresh_token);

    await sleep(env.REFRESH_GRACE_PERIOD_SECONDS * 1000 + 500);

    const oldReplay = await tokenExchange(
      app,
      dpopPrivateKey,
      dpopPublicJwk,
      clientId,
      clientSecret,
      {
        grant_type: 'refresh_token',
        refresh_token: first.refresh_token,
      },
    );
    expect(oldReplay.statusCode).toBe(401);
  });

  it('PKCE: wrong code_verifier fails token exchange', async () => {
    const { privateKey: dpopPrivateKey, publicJwk: dpopPublicJwk } = await generateDpopKeyPair();
    const { sessionToken, clientId, clientSecret } = await registerAdminAndCreateClient(
      app,
      testDb,
      'pkce',
    );
    const { codeChallenge } = pkcePair();
    const wrongVerifier = randomBytes(32).toString('base64url');
    const state = 'state-pkce';

    await parAuthorize(app, sessionToken, clientId, clientSecret, codeChallenge, state);
    const code = await approveConsentAndGetCode(app, sessionToken, clientId, state, codeChallenge);

    const tokenRes = await tokenExchange(
      app,
      dpopPrivateKey,
      dpopPublicJwk,
      clientId,
      clientSecret,
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: wrongVerifier,
      },
    );
    expect(tokenRes.statusCode).toBe(401);
  });

  it('skips consent screen when scopes already granted', async () => {
    const { sessionToken, clientId, clientSecret } = await registerAdminAndCreateClient(
      app,
      testDb,
      'skip',
    );
    const { codeChallenge: c1 } = pkcePair();
    const state1 = 'state-skip-1';

    const firstAuthz = await parAuthorize(app, sessionToken, clientId, clientSecret, c1, state1);
    expect(firstAuthz.statusCode).toBe(200);

    await approveConsentAndGetCode(app, sessionToken, clientId, state1, c1);

    const { codeChallenge: c2 } = pkcePair();
    const state2 = 'state-skip-2';

    const secondAuthz = await parAuthorize(app, sessionToken, clientId, clientSecret, c2, state2);
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
    const { privateKey: dpopPrivateKey, publicJwk: dpopPublicJwk } = await generateDpopKeyPair();
    const { sessionToken, clientId, clientSecret } = await registerAdminAndCreateClient(
      app,
      testDb,
      'revoke',
    );
    const { codeVerifier, codeChallenge } = pkcePair();
    const state = 'state-revoke';

    await parAuthorize(app, sessionToken, clientId, clientSecret, codeChallenge, state);
    const code = await approveConsentAndGetCode(app, sessionToken, clientId, state, codeChallenge);

    const tokenRes = await tokenExchange(
      app,
      dpopPrivateKey,
      dpopPublicJwk,
      clientId,
      clientSecret,
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      },
    );
    expect(tokenRes.statusCode).toBe(200);
    const first = tokenRes.json() as { refresh_token: string };

    const refreshRes = await tokenExchange(
      app,
      dpopPrivateKey,
      dpopPublicJwk,
      clientId,
      clientSecret,
      {
        grant_type: 'refresh_token',
        refresh_token: first.refresh_token,
      },
    );
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

    const failedRefresh = await tokenExchange(
      app,
      dpopPrivateKey,
      dpopPublicJwk,
      clientId,
      clientSecret,
      {
        grant_type: 'refresh_token',
        refresh_token: refreshed.refresh_token,
      },
    );
    expect(failedRefresh.statusCode).toBe(401);
  });

  it('replay after grace revokes refresh token family', async () => {
    const { privateKey: dpopPrivateKey, publicJwk: dpopPublicJwk } = await generateDpopKeyPair();
    const { sessionToken, clientId, clientSecret } = await registerAdminAndCreateClient(
      app,
      testDb,
      'replay',
    );
    const { codeVerifier, codeChallenge } = pkcePair();
    const state = 'state-replay';

    await parAuthorize(app, sessionToken, clientId, clientSecret, codeChallenge, state);
    const code = await approveConsentAndGetCode(app, sessionToken, clientId, state, codeChallenge);

    const tokenRes = await tokenExchange(
      app,
      dpopPrivateKey,
      dpopPublicJwk,
      clientId,
      clientSecret,
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      },
    );
    expect(tokenRes.statusCode).toBe(200);
    const rt1 = tokenRes.json() as { refresh_token: string };

    const refresh1 = await tokenExchange(
      app,
      dpopPrivateKey,
      dpopPublicJwk,
      clientId,
      clientSecret,
      {
        grant_type: 'refresh_token',
        refresh_token: rt1.refresh_token,
      },
    );
    expect(refresh1.statusCode).toBe(200);
    const rt2 = refresh1.json() as { refresh_token: string };

    await sleep(env.REFRESH_GRACE_PERIOD_SECONDS * 1000 + 500);

    const reuseOld = await tokenExchange(
      app,
      dpopPrivateKey,
      dpopPublicJwk,
      clientId,
      clientSecret,
      {
        grant_type: 'refresh_token',
        refresh_token: rt1.refresh_token,
      },
    );
    expect(reuseOld.statusCode).toBe(401);
    expect((reuseOld.json() as { error?: string }).error).toContain('reuse');

    const reuseNew = await tokenExchange(
      app,
      dpopPrivateKey,
      dpopPublicJwk,
      clientId,
      clientSecret,
      {
        grant_type: 'refresh_token',
        refresh_token: rt2.refresh_token,
      },
    );
    expect(reuseNew.statusCode).toBe(401);
  });

  it('client credentials flow: confidential client gets access token without refresh/id token', async () => {
    const { privateKey: dpopPrivateKey, publicJwk: dpopPublicJwk } = await generateDpopKeyPair();
    const { clientId, clientSecret } = await registerAdminAndCreateClient(app, testDb, 'cc', [
      'authorization_code',
      'refresh_token',
      'client_credentials',
    ]);

    const tokenRes = await tokenExchange(
      app,
      dpopPrivateKey,
      dpopPublicJwk,
      clientId,
      clientSecret,
      {
        grant_type: 'client_credentials',
      },
    );
    expect(tokenRes.statusCode).toBe(200);
    const tokens = tokenRes.json() as {
      access_token: string;
      token_type: string;
      expires_in: number;
      scope: string;
      refresh_token?: string;
      id_token?: string;
    };
    expect(tokens.token_type).toBe('DPoP');
    expect(tokens.refresh_token).toBeUndefined();
    expect(tokens.id_token).toBeUndefined();
    expect(tokens.scope).toBe(scope);
    expect(tokens.expires_in).toBe(env.ACCESS_TOKEN_TTL_SECONDS);

    const jwksRes = await app.inject({ method: 'GET', url: '/.well-known/jwks.json' });
    expect(jwksRes.statusCode).toBe(200);
    const jwks = jose.createLocalJWKSet(jwksRes.json() as jose.JSONWebKeySet);
    const { payload } = await jose.jwtVerify(tokens.access_token, jwks, {
      issuer: env.JWT_ISSUER,
      audience: clientId,
      algorithms: ['RS256'],
    });
    expect(payload.sub).toBe(clientId);
    expect(payload.client_id).toBe(clientId);
  });

  it('token introspection: active tokens return claims, revoked refresh token returns inactive', async () => {
    const { privateKey: dpopPrivateKey, publicJwk: dpopPublicJwk } = await generateDpopKeyPair();
    const { sessionToken, user, clientId, clientSecret } = await registerAdminAndCreateClient(
      app,
      testDb,
      'intro',
    );
    const { codeVerifier, codeChallenge } = pkcePair();
    const state = 'state-intro';

    await parAuthorize(app, sessionToken, clientId, clientSecret, codeChallenge, state);
    const code = await approveConsentAndGetCode(app, sessionToken, clientId, state, codeChallenge);

    const tokenRes = await tokenExchange(
      app,
      dpopPrivateKey,
      dpopPublicJwk,
      clientId,
      clientSecret,
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      },
    );
    expect(tokenRes.statusCode).toBe(200);
    const bundle = tokenRes.json() as {
      access_token: string;
      refresh_token: string;
    };

    const accessIntro = await app.inject({
      method: 'POST',
      url: '/oauth/introspect',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuthHeader(clientId, clientSecret),
      },
      payload: { token: bundle.access_token },
    });
    expect(accessIntro.statusCode).toBe(200);
    const accessBody = accessIntro.json() as {
      active: boolean;
      sub?: string;
      scope?: string;
      client_id?: string;
      token_type?: string;
      iss?: string;
    };
    expect(accessBody.active).toBe(true);
    expect(accessBody.sub).toBe(user.id);
    expect(accessBody.scope).toBe(scope);
    expect(accessBody.client_id).toBe(clientId);
    expect(accessBody.token_type).toBe('DPoP+access_token');
    expect(accessBody.iss).toBe(env.JWT_ISSUER);

    const refreshIntro = await app.inject({
      method: 'POST',
      url: '/oauth/introspect',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuthHeader(clientId, clientSecret),
      },
      payload: { token: bundle.refresh_token, token_type_hint: 'refresh_token' },
    });
    expect(refreshIntro.statusCode).toBe(200);
    const refreshBody = refreshIntro.json() as {
      active: boolean;
      sub?: string;
      token_type?: string;
    };
    expect(refreshBody.active).toBe(true);
    expect(refreshBody.sub).toBe(user.id);
    expect(refreshBody.token_type).toBe('refresh_token');

    const revokeRes = await app.inject({
      method: 'POST',
      url: '/oauth/revoke',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuthHeader(clientId, clientSecret),
      },
      payload: { token: bundle.refresh_token, token_type_hint: 'refresh_token' },
    });
    expect(revokeRes.statusCode).toBe(200);

    const afterRevoke = await app.inject({
      method: 'POST',
      url: '/oauth/introspect',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuthHeader(clientId, clientSecret),
      },
      payload: { token: bundle.refresh_token, token_type_hint: 'refresh_token' },
    });
    expect(afterRevoke.statusCode).toBe(200);
    expect((afterRevoke.json() as { active: boolean }).active).toBe(false);
  });

  it('PAR flow: push auth request → authorize with request_uri → exchange code', async () => {
    const { privateKey: dpopPrivateKey, publicJwk: dpopPublicJwk } = await generateDpopKeyPair();
    const { sessionToken, user, clientId, clientSecret } = await registerAdminAndCreateClient(
      app,
      testDb,
      'par',
    );
    const { codeVerifier, codeChallenge } = pkcePair();
    const state = 'state-par';

    const parRes = await app.inject({
      method: 'POST',
      url: '/oauth/par',
      headers: {
        'content-type': 'application/json',
        authorization: basicAuthHeader(clientId, clientSecret),
      },
      payload: {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
      },
    });
    expect(parRes.statusCode).toBe(201);
    const par = parRes.json() as { request_uri: string; expires_in: number };
    expect(par.request_uri).toMatch(/^urn:ietf:params:oauth:request_uri:/);
    expect(par.expires_in).toBeGreaterThan(0);

    const authRes = await app.inject({
      method: 'GET',
      url: '/oauth/authorize',
      headers: { authorization: `Bearer ${sessionToken}` },
      query: {
        request_uri: par.request_uri,
        client_id: clientId,
      },
    });
    expect(authRes.statusCode).toBe(200);
    expect((authRes.json() as { type: string }).type).toBe('consent_required');

    const authCode = await approveConsentAndGetCode(
      app,
      sessionToken,
      clientId,
      state,
      codeChallenge,
    );

    const tokenRes = await tokenExchange(
      app,
      dpopPrivateKey,
      dpopPublicJwk,
      clientId,
      clientSecret,
      {
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      },
    );
    expect(tokenRes.statusCode).toBe(200);
    const tokens = tokenRes.json() as {
      access_token: string;
      refresh_token: string;
      id_token: string;
    };
    expect(tokens.refresh_token).toBeDefined();
    expect(tokens.id_token).toBeDefined();

    const jwksRes = await app.inject({ method: 'GET', url: '/.well-known/jwks.json' });
    const jwks = jose.createLocalJWKSet(jwksRes.json() as jose.JSONWebKeySet);
    const { payload: accessPayload } = await jose.jwtVerify(tokens.access_token, jwks, {
      issuer: env.JWT_ISSUER,
      audience: clientId,
      algorithms: ['RS256'],
    });
    expect(accessPayload.sub).toBe(user.id);
  });

  it('RP-Initiated Logout: end-session with id_token_hint redirects with state', async () => {
    const { privateKey: dpopPrivateKey, publicJwk: dpopPublicJwk } = await generateDpopKeyPair();
    const { sessionToken, clientId, clientSecret } = await registerAdminAndCreateClient(
      app,
      testDb,
      'logout',
    );
    const { codeVerifier, codeChallenge } = pkcePair();
    const state = 'state-logout';
    const nonce = 'nonce-logout';

    await parAuthorize(app, sessionToken, clientId, clientSecret, codeChallenge, state, nonce);
    const code = await approveConsentAndGetCode(
      app,
      sessionToken,
      clientId,
      state,
      codeChallenge,
      nonce,
    );

    const tokenRes = await tokenExchange(
      app,
      dpopPrivateKey,
      dpopPublicJwk,
      clientId,
      clientSecret,
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      },
    );
    expect(tokenRes.statusCode).toBe(200);
    const { id_token: idToken } = tokenRes.json() as { id_token: string };
    expect(idToken).toBeDefined();

    const logoutState = 'post-logout-state-xyz';
    const endSessionRes = await app.inject({
      method: 'GET',
      url: '/oauth/end-session',
      query: {
        id_token_hint: idToken,
        post_logout_redirect_uri: redirectUri,
        state: logoutState,
      },
    });
    expect(endSessionRes.statusCode).toBe(302);
    const loc = endSessionRes.headers.location;
    if (!loc) {
      throw new Error('expected Location header');
    }
    const out = new URL(loc);
    expect(out.origin + out.pathname).toBe(
      new URL(redirectUri).origin + new URL(redirectUri).pathname,
    );
    expect(out.searchParams.get('state')).toBe(logoutState);
  });

  it('consent revocation: DELETE /consent/:clientId revokes consent and refresh tokens', async () => {
    const { privateKey: dpopPrivateKey, publicJwk: dpopPublicJwk } = await generateDpopKeyPair();
    const { sessionToken, clientId, clientSecret } = await registerAdminAndCreateClient(
      app,
      testDb,
      'consent-del',
    );
    const { codeVerifier, codeChallenge } = pkcePair();
    const state = 'state-consent-del';

    await parAuthorize(app, sessionToken, clientId, clientSecret, codeChallenge, state);
    const code = await approveConsentAndGetCode(app, sessionToken, clientId, state, codeChallenge);

    const tokenRes = await tokenExchange(
      app,
      dpopPrivateKey,
      dpopPublicJwk,
      clientId,
      clientSecret,
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      },
    );
    expect(tokenRes.statusCode).toBe(200);
    const { refresh_token: refreshToken } = tokenRes.json() as { refresh_token: string };

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/oauth/consent/${clientId}`,
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(delRes.statusCode).toBe(204);

    const refreshFail = await tokenExchange(
      app,
      dpopPrivateKey,
      dpopPublicJwk,
      clientId,
      clientSecret,
      {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      },
    );
    expect(refreshFail.statusCode).toBe(401);

    const { codeChallenge: ch2 } = pkcePair();
    const state2 = 'state-after-revoke';
    const authAgain = await parAuthorize(app, sessionToken, clientId, clientSecret, ch2, state2);
    expect(authAgain.statusCode).toBe(200);
    expect((authAgain.json() as { type: string }).type).toBe('consent_required');
  });

  it('discovery: OpenID metadata and JWKS', async () => {
    const issuerBaseDiscovery = env.JWT_ISSUER.replace(/\/$/, '');
    const configRes = await app.inject({
      method: 'GET',
      url: '/.well-known/openid-configuration',
    });
    expect(configRes.statusCode).toBe(200);
    const config = configRes.json() as {
      issuer: string;
      authorization_endpoint: string;
      token_endpoint: string;
      userinfo_endpoint: string;
      revocation_endpoint: string;
      introspection_endpoint: string;
      end_session_endpoint: string;
      pushed_authorization_request_endpoint: string;
      require_pushed_authorization_requests: boolean;
      response_types_supported: string[];
      grant_types_supported: string[];
      jwks_uri: string;
      introspection_endpoint_auth_methods_supported: string[];
      revocation_endpoint_auth_methods_supported: string[];
      dpop_signing_alg_values_supported: string[];
    };
    expect(config.issuer).toBe(env.JWT_ISSUER);
    expect(config.response_types_supported).toEqual(['code']);
    expect(config.grant_types_supported).toEqual([
      'authorization_code',
      'refresh_token',
      'client_credentials',
    ]);
    expect(config.authorization_endpoint).toBe(`${issuerBaseDiscovery}/oauth/authorize`);
    expect(config.token_endpoint).toBe(`${issuerBaseDiscovery}/oauth/token`);
    expect(config.userinfo_endpoint).toBe(`${issuerBaseDiscovery}/oauth/userinfo`);
    expect(config.revocation_endpoint).toBe(`${issuerBaseDiscovery}/oauth/revoke`);
    expect(config.introspection_endpoint).toBe(`${issuerBaseDiscovery}/oauth/introspect`);
    expect(config.end_session_endpoint).toBe(`${issuerBaseDiscovery}/oauth/end-session`);
    expect(config.pushed_authorization_request_endpoint).toBe(`${issuerBaseDiscovery}/oauth/par`);
    expect(config.require_pushed_authorization_requests).toBe(true);
    expect(config.jwks_uri).toBe(`${issuerBaseDiscovery}/.well-known/jwks.json`);
    expect(config.introspection_endpoint_auth_methods_supported).toEqual([
      'client_secret_basic',
      'client_secret_post',
    ]);
    expect(config.revocation_endpoint_auth_methods_supported).toEqual([
      'client_secret_basic',
      'client_secret_post',
    ]);
    expect(config.dpop_signing_alg_values_supported).toEqual(['ES256', 'RS256']);

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
