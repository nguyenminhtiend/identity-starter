import { createHash, randomBytes } from 'node:crypto';
import { oauthClients, users } from '@identity-starter/db';
import * as jose from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import { createTestDb, type TestDb } from '../../../test/db-helper.js';
import { createRefreshTokenService, hashToken } from '../../token/refresh-token.service.js';
import { createSigningKeyService } from '../../token/signing-key.service.js';
import { createOAuthService } from '../oauth.service.js';

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.teardown();
});

function pkcePair() {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

describe('oauth.service integration', () => {
  it('full lifecycle: client → user → authorize → consent → exchange → refresh → userinfo', async () => {
    const eventBus = new InMemoryEventBus();
    const signingKeyService = createSigningKeyService({ db: testDb.db });
    await signingKeyService.generateKeyPair();
    const refreshTokenService = createRefreshTokenService({ db: testDb.db, eventBus });

    const env = {
      jwtIssuer: 'https://id.example.com',
      accessTokenTtl: 3600,
      refreshTokenTtl: 7200,
      authCodeTtl: 600,
      refreshGracePeriod: 10,
    };

    const oauth = createOAuthService({
      db: testDb.db,
      eventBus,
      signingKeyService,
      refreshTokenService,
      env,
    });

    const [user] = await testDb.db
      .insert(users)
      .values({
        email: 'oauth-int-user@example.com',
        displayName: 'OAuth Int User',
        passwordHash: 'fake',
        status: 'active',
      })
      .returning();

    const publicClientId = `pub-${randomBytes(8).toString('hex')}`;

    const [client] = await testDb.db
      .insert(oauthClients)
      .values({
        clientId: publicClientId,
        clientSecretHash: 'fake',
        clientName: 'Integration RP',
        redirectUris: ['https://client.example/oauth/callback'],
        grantTypes: ['authorization_code', 'refresh_token'],
        responseTypes: ['code'],
        scope: 'openid profile email',
        tokenEndpointAuthMethod: 'none',
        isConfidential: false,
      })
      .returning();

    if (!user || !client) {
      throw new Error('fixture insert failed');
    }

    const { codeVerifier, codeChallenge } = pkcePair();
    const redirectUri = 'https://client.example/oauth/callback';
    const scope = 'openid profile email';

    const authzQuery = {
      response_type: 'code' as const,
      client_id: publicClientId,
      redirect_uri: redirectUri,
      scope,
      state: 'csrf-1',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256' as const,
    };

    const step1 = await oauth.authorize(user.id, authzQuery);
    expect(step1.type).toBe('consent_required');

    const consent = await oauth.submitConsent(user.id, {
      client_id: publicClientId,
      scope,
      decision: 'approve',
      state: 'csrf-1',
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const redirectUrl = new URL(consent.redirectUri);
    const code = redirectUrl.searchParams.get('code');
    expect(code).toBeTruthy();

    const tokens = await oauth.exchangeToken(
      {
        grant_type: 'authorization_code',
        code: code ?? '',
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
        client_id: publicClientId,
      },
      null,
    );

    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.access_token.length).toBeGreaterThan(10);
    expect(tokens.refresh_token).toBeTruthy();
    expect(tokens.id_token).toBeTruthy();
    expect(tokens.scope).toBe(scope);

    const jwks = jose.createLocalJWKSet({
      keys: (await signingKeyService.getJwks()).keys,
    });
    const { payload: accessPayload } = await jose.jwtVerify(tokens.access_token, jwks, {
      issuer: env.jwtIssuer,
      algorithms: ['RS256'],
    });
    expect(accessPayload.sub).toBe(user.id);
    expect(accessPayload.scope).toBe(scope);

    const refreshed = await oauth.exchangeToken(
      {
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token ?? '',
        client_id: publicClientId,
      },
      null,
    );

    expect(refreshed.access_token).not.toBe(tokens.access_token);
    expect(refreshed.refresh_token).toBeTruthy();

    const userinfo = await oauth.getUserInfo(user.id, 'openid profile email');
    expect(userinfo.sub).toBe(user.id);
    expect(userinfo.name).toBe('OAuth Int User');
    expect(userinfo.email).toBe('oauth-int-user@example.com');
    expect(userinfo.email_verified).toBe(false);
  });

  it('revokeToken is a no-op for unknown refresh token', async () => {
    const eventBus = new InMemoryEventBus();
    const signingKeyService = createSigningKeyService({ db: testDb.db });
    await signingKeyService.generateKeyPair();
    const refreshTokenService = createRefreshTokenService({ db: testDb.db, eventBus });

    const oauth = createOAuthService({
      db: testDb.db,
      eventBus,
      signingKeyService,
      refreshTokenService,
      env: {
        jwtIssuer: 'https://id.example.com',
        accessTokenTtl: 3600,
        refreshTokenTtl: 7200,
        authCodeTtl: 600,
        refreshGracePeriod: 10,
      },
    });

    await expect(oauth.revokeToken({ token: 'totally-unknown-token' })).resolves.toBeUndefined();
  });

  it('revokeToken revokes a valid refresh token', async () => {
    const eventBus = new InMemoryEventBus();
    const signingKeyService = createSigningKeyService({ db: testDb.db });
    await signingKeyService.generateKeyPair();
    const refreshTokenService = createRefreshTokenService({ db: testDb.db, eventBus });

    const oauth = createOAuthService({
      db: testDb.db,
      eventBus,
      signingKeyService,
      refreshTokenService,
      env: {
        jwtIssuer: 'https://id.example.com',
        accessTokenTtl: 3600,
        refreshTokenTtl: 7200,
        authCodeTtl: 600,
        refreshGracePeriod: 10,
      },
    });

    const [user] = await testDb.db
      .insert(users)
      .values({
        email: 'revoke-rt@example.com',
        displayName: 'Revoke',
        passwordHash: 'fake',
        status: 'active',
      })
      .returning();

    const cid = `pub-${randomBytes(8).toString('hex')}`;

    const [client] = await testDb.db
      .insert(oauthClients)
      .values({
        clientId: cid,
        clientSecretHash: 'fake',
        clientName: 'Revoke Client',
        redirectUris: ['https://a.example/cb'],
        grantTypes: ['refresh_token'],
        responseTypes: ['code'],
        scope: 'openid',
        tokenEndpointAuthMethod: 'none',
        isConfidential: false,
      })
      .returning();

    if (!user || !client) {
      throw new Error('fixture insert failed');
    }

    const { plaintext } = await refreshTokenService.createRefreshToken({
      clientId: client.id,
      userId: user.id,
      scope: 'openid',
      expiresInSeconds: 3600,
    });

    await oauth.revokeToken({ token: plaintext });

    const { refreshTokens } = await import('@identity-starter/db');
    const { eq } = await import('drizzle-orm');
    const rows = await testDb.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.token, hashToken(plaintext)));
    expect(rows[0]?.revokedAt).not.toBeNull();
  });
});
