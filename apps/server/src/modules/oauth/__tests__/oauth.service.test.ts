import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '@identity-starter/core';
import * as jose from 'jose';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import type { ClientResponse } from '../../client/client.schemas.js';
import { issueAccessToken, issueIdToken } from '../../token/jwt.service.js';
import type { ActiveSigningKeyResult } from '../../token/signing-key.service.js';
import { TOKEN_EVENTS } from '../../token/token.events.js';
import { OAUTH_EVENTS } from '../oauth.events.js';
import { createOAuthService } from '../oauth.service.js';
import {
  buildAuthorizeQuery,
  buildConsentApprove,
  buildConsentDeny,
  buildTokenRequestAuthCode,
  buildTokenRequestClientCredentials,
  buildTokenRequestRefresh,
} from './oauth.factory.js';

const mocks = vi.hoisted(() => ({
  getClientByClientId: vi.fn(),
  getClient: vi.fn(),
  authenticateClient: vi.fn(),
}));

vi.mock('../../client/client.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../client/client.service.js')>();
  return {
    ...actual,
    getClientByClientId: mocks.getClientByClientId,
    getClient: mocks.getClient,
    authenticateClient: mocks.authenticateClient,
  };
});

const INTERNAL_CLIENT_ID = '10000000-0000-7000-8000-000000000001';
const PUBLIC_CLIENT_ID = 'public-client-id-hex';
const USER_ID = '20000000-0000-7000-8000-000000000002';

function baseClient(overrides: Partial<ClientResponse> = {}): ClientResponse {
  return {
    id: INTERNAL_CLIENT_ID,
    clientId: PUBLIC_CLIENT_ID,
    clientName: 'Example RP',
    description: null,
    redirectUris: ['https://example.com/callback'],
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
    scope: 'openid profile email',
    tokenEndpointAuthMethod: 'client_secret_basic',
    isConfidential: true,
    logoUri: null,
    tosUri: null,
    policyUri: null,
    applicationType: 'web',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

let testSigningKey: ActiveSigningKeyResult;

function createSelectThenable(rows: unknown[]) {
  const chain: {
    from: ReturnType<typeof vi.fn>;
    where: ReturnType<typeof vi.fn>;
    limit?: ReturnType<typeof vi.fn>;
  } = {
    from: vi.fn(),
    where: vi.fn(),
  };
  const promise = Promise.resolve(rows);
  chain.from.mockReturnValue(chain);
  chain.where.mockImplementation(() => promise);
  return chain;
}

function createSelectWithLimit(rows: unknown[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.limit.mockResolvedValue(rows);
  return chain;
}

function createRefreshIntrospectDb(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const innerJoin = vi.fn().mockReturnValue({ where });
  const from = vi.fn().mockReturnValue({ innerJoin });
  return {
    select: vi.fn().mockReturnValue({ from }),
  } as never;
}

describe('oauth.service', () => {
  beforeAll(async () => {
    const { publicKey, privateKey } = await jose.generateKeyPair('RS256', { extractable: true });
    const kid = 'test-signing-kid';
    const publicKeyJwk = await jose.exportJWK(publicKey);
    publicKeyJwk.kid = kid;
    publicKeyJwk.alg = 'RS256';
    publicKeyJwk.use = 'sig';
    testSigningKey = { kid, privateKey, publicKeyJwk };
  });

  const eventBus = new InMemoryEventBus();
  const signingKeyService = {
    getActiveSigningKey: vi.fn(),
    getJwks: vi.fn(),
  };
  const refreshTokenService = {
    createRefreshToken: vi.fn(),
    rotateRefreshToken: vi.fn(),
    revokeRefreshToken: vi.fn(),
    revokeAllForClient: vi.fn(),
  };

  const env = {
    jwtIssuer: 'https://id.example.com',
    accessTokenTtl: 3600,
    refreshTokenTtl: 86_400,
    authCodeTtl: 600,
    refreshGracePeriod: 10,
    parTtl: 60,
  };

  beforeEach(() => {
    signingKeyService.getActiveSigningKey.mockResolvedValue(testSigningKey);
    signingKeyService.getJwks.mockResolvedValue({ keys: [testSigningKey.publicKeyJwk] });
    refreshTokenService.createRefreshToken.mockReset();
    refreshTokenService.createRefreshToken.mockResolvedValue({
      plaintext: 'new-refresh-plain',
      familyId: '30000000-0000-7000-8000-000000000003',
    });
    refreshTokenService.rotateRefreshToken.mockReset();
    refreshTokenService.rotateRefreshToken.mockResolvedValue('rotated-refresh-plain');
    refreshTokenService.revokeAllForClient.mockReset();
    refreshTokenService.revokeAllForClient.mockResolvedValue(undefined);
    mocks.getClientByClientId.mockReset();
    mocks.getClient.mockReset();
    mocks.authenticateClient.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('authorize', () => {
    it('with existing consent issues auth code and returns redirect with code, state, iss', async () => {
      mocks.getClientByClientId.mockResolvedValue(baseClient());

      const insertValues = vi.fn().mockResolvedValue(undefined);
      const insert = vi.fn().mockReturnValue({ values: insertValues });

      const consentSelect = createSelectThenable([{ scope: 'openid profile email' }]);
      const db = {
        insert,
        select: vi.fn(() => consentSelect),
      } as never;

      const publishSpy = vi.spyOn(eventBus, 'publish');
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      const query = buildAuthorizeQuery({ client_id: PUBLIC_CLIENT_ID });
      const result = await service.authorize(USER_ID, query);

      expect(result.type).toBe('redirect');
      if (result.type === 'redirect') {
        const url = new URL(result.redirectUri);
        expect(url.searchParams.get('state')).toBe(query.state);
        expect(url.searchParams.get('iss')).toBe(env.jwtIssuer);
        expect(url.searchParams.get('code')).toBeTruthy();
      }

      expect(insert).toHaveBeenCalled();
      expect(publishSpy).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: OAUTH_EVENTS.AUTHORIZATION_CODE_ISSUED }),
      );
    });

    it('without consent returns consent_required with client info', async () => {
      mocks.getClientByClientId.mockResolvedValue(baseClient());

      const consentSelect = createSelectThenable([]);
      const db = {
        insert: vi.fn(),
        select: vi.fn(() => consentSelect),
      } as never;

      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      const query = buildAuthorizeQuery({ client_id: PUBLIC_CLIENT_ID });
      const result = await service.authorize(USER_ID, query);

      expect(result).toEqual({
        type: 'consent_required',
        client: {
          clientId: PUBLIC_CLIENT_ID,
          clientName: 'Example RP',
          scope: 'openid profile email',
          logoUri: null,
          policyUri: null,
          tosUri: null,
        },
        requestedScope: query.scope,
        state: query.state,
        redirectUri: query.redirect_uri,
      });
    });

    it('throws NotFoundError for invalid client_id', async () => {
      mocks.getClientByClientId.mockRejectedValue(new NotFoundError('Client', 'x'));

      const db = { select: vi.fn(), insert: vi.fn() } as never;
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      await expect(
        service.authorize(USER_ID, buildAuthorizeQuery({ client_id: 'missing' })),
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ValidationError when redirect_uri is not registered', async () => {
      mocks.getClientByClientId.mockResolvedValue(baseClient());

      const db = { select: vi.fn(() => createSelectThenable([])), insert: vi.fn() } as never;
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      await expect(
        service.authorize(
          USER_ID,
          buildAuthorizeQuery({
            client_id: PUBLIC_CLIENT_ID,
            redirect_uri: 'https://evil.com/cb',
          }),
        ),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when code_challenge is missing', async () => {
      mocks.getClientByClientId.mockResolvedValue(baseClient());

      const db = {
        select: vi.fn(() => createSelectThenable([{ scope: 'openid' }])),
        insert: vi.fn(),
      } as never;
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      const q = buildAuthorizeQuery({
        client_id: PUBLIC_CLIENT_ID,
        code_challenge: 'x'.repeat(43),
      });
      const bad = { ...q, code_challenge: '   ' };

      await expect(service.authorize(USER_ID, bad as typeof q)).rejects.toThrow(ValidationError);
    });

    it('throws ForbiddenError when client is suspended', async () => {
      mocks.getClientByClientId.mockResolvedValue(baseClient({ status: 'suspended' }));

      const db = { select: vi.fn(), insert: vi.fn() } as never;
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      await expect(
        service.authorize(USER_ID, buildAuthorizeQuery({ client_id: PUBLIC_CLIENT_ID })),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('submitConsent', () => {
    it('approve stores consent, issues code, returns redirect', async () => {
      mocks.getClientByClientId.mockResolvedValue(baseClient());

      const insertValues = vi.fn().mockResolvedValue(undefined);
      const insert = vi.fn().mockReturnValue({ values: insertValues });
      const publishSpy = vi.spyOn(eventBus, 'publish');

      const db = { insert, select: vi.fn() } as never;

      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      const input = buildConsentApprove({ client_id: PUBLIC_CLIENT_ID });
      const result = await service.submitConsent(USER_ID, input);

      expect(result.redirectUri).toContain('code=');
      expect(insert).toHaveBeenCalledTimes(2);
      expect(publishSpy).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: OAUTH_EVENTS.CONSENT_GRANTED }),
      );
      expect(publishSpy).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: OAUTH_EVENTS.AUTHORIZATION_CODE_ISSUED }),
      );
    });

    it('deny returns redirect with access_denied', async () => {
      mocks.getClientByClientId.mockResolvedValue(baseClient({ isConfidential: false }));

      const insert = vi.fn();
      const db = { insert, select: vi.fn() } as never;
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      const input = buildConsentDeny({ client_id: PUBLIC_CLIENT_ID, state: 'st-1' });
      const result = await service.submitConsent(USER_ID, input);

      const url = new URL(result.redirectUri);
      expect(url.searchParams.get('error')).toBe('access_denied');
      expect(url.searchParams.get('state')).toBe('st-1');
      expect(insert).not.toHaveBeenCalled();
    });
  });

  describe('revokeConsent', () => {
    it('marks consent grant revoked, revokes refresh tokens for user+client, publishes event', async () => {
      mocks.getClientByClientId.mockResolvedValue(baseClient());

      const grantRow = {
        id: '70000000-0000-7000-8000-000000000007',
        userId: USER_ID,
        clientId: INTERNAL_CLIENT_ID,
        scope: 'openid',
        revokedAt: null as Date | null,
        createdAt: new Date(),
      };

      const consentSelect = createSelectWithLimit([grantRow]);
      const updateWhere = vi.fn().mockResolvedValue(undefined);
      const update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: updateWhere }),
      });

      const db = {
        select: vi.fn(() => consentSelect),
        update,
      } as never;

      const publishSpy = vi.spyOn(eventBus, 'publish');
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      await service.revokeConsent(USER_ID, PUBLIC_CLIENT_ID);

      expect(update).toHaveBeenCalled();
      expect(updateWhere).toHaveBeenCalled();
      expect(refreshTokenService.revokeAllForClient).toHaveBeenCalledWith(
        INTERNAL_CLIENT_ID,
        USER_ID,
      );
      expect(publishSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: OAUTH_EVENTS.CONSENT_REVOKED,
          payload: { userId: USER_ID, clientId: PUBLIC_CLIENT_ID },
        }),
      );
    });

    it('throws NotFoundError when no active consent exists for user+client', async () => {
      mocks.getClientByClientId.mockResolvedValue(baseClient());

      const consentSelect = createSelectWithLimit([]);
      const db = {
        select: vi.fn(() => consentSelect),
        update: vi.fn(),
      } as never;

      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      await expect(service.revokeConsent(USER_ID, PUBLIC_CLIENT_ID)).rejects.toThrow(NotFoundError);
      expect(refreshTokenService.revokeAllForClient).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when consent was already revoked', async () => {
      mocks.getClientByClientId.mockResolvedValue(baseClient());

      const consentSelect = createSelectWithLimit([]);
      const db = {
        select: vi.fn(() => consentSelect),
        update: vi.fn(),
      } as never;

      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      await expect(service.revokeConsent(USER_ID, PUBLIC_CLIENT_ID)).rejects.toThrow(NotFoundError);
      expect(refreshTokenService.revokeAllForClient).not.toHaveBeenCalled();
    });
  });

  describe('exchangeToken authorization_code', () => {
    it('valid code + verifier returns tokens', async () => {
      const verifier = 'b'.repeat(43);
      const challenge = await import('node:crypto').then((c) =>
        c.createHash('sha256').update(verifier).digest('base64url'),
      );

      const codeRow = {
        id: '40000000-0000-7000-8000-000000000004',
        code: 'hash',
        clientId: INTERNAL_CLIENT_ID,
        userId: USER_ID,
        redirectUri: 'https://example.com/callback',
        scope: 'openid profile',
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
        nonce: null as string | null,
        state: 's',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null as Date | null,
        createdAt: new Date(),
      };

      const clientRow = {
        id: INTERNAL_CLIENT_ID,
        clientId: PUBLIC_CLIENT_ID,
        clientName: 'RP',
        description: null,
        redirectUris: ['https://example.com/callback'],
        grantTypes: ['authorization_code'],
        responseTypes: ['code'],
        scope: 'openid profile email',
        tokenEndpointAuthMethod: 'client_secret_basic',
        isConfidential: true,
        logoUri: null,
        tosUri: null,
        policyUri: null,
        applicationType: 'web',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const codeSelect = createSelectWithLimit([codeRow]);
      const clientSelect = createSelectWithLimit([clientRow]);
      const updateWhere = vi.fn().mockResolvedValue(undefined);
      const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
      const update = vi.fn().mockReturnValue({ set: updateSet });

      let txSelectCount = 0;
      const tx = {
        select: vi.fn(() => {
          txSelectCount += 1;
          if (txSelectCount === 1) {
            return codeSelect;
          }
          return clientSelect;
        }),
        update,
      };

      const db = {
        transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      } as never;

      mocks.authenticateClient.mockResolvedValue(baseClient());

      const publishSpy = vi.spyOn(eventBus, 'publish');
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      const { hashToken } = await import('../../token/refresh-token.service.js');
      const plaintext = 'plain-auth-code';
      const request = buildTokenRequestAuthCode({
        code: plaintext,
        redirect_uri: 'https://example.com/callback',
        code_verifier: verifier,
        client_id: PUBLIC_CLIENT_ID,
        client_secret: 'secret',
      });

      codeRow.code = hashToken(plaintext);

      const tokens = await service.exchangeToken(request, null);

      expect(tokens.access_token).toBeTruthy();
      expect(tokens.refresh_token).toBe('new-refresh-plain');
      expect(tokens.scope).toBe('openid profile');
      expect(publishSpy).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: OAUTH_EVENTS.TOKEN_EXCHANGED }),
      );
    });

    it('throws for invalid, expired, used code, bad verifier, bad redirect, bad client', async () => {
      const verifier = 'b'.repeat(43);
      const challenge = await import('node:crypto').then((c) =>
        c.createHash('sha256').update(verifier).digest('base64url'),
      );
      const { hashToken } = await import('../../token/refresh-token.service.js');
      const plaintext = 'code-1';

      const mkTx = (codeRow: Record<string, unknown> | null) => {
        const codeSelect = createSelectWithLimit(codeRow ? [codeRow] : []);
        const clientSelect = createSelectWithLimit([baseClient({ isConfidential: false })]);
        let n = 0;
        const tx = {
          select: vi.fn(() => {
            n += 1;
            return n === 1 ? codeSelect : clientSelect;
          }),
          update: vi.fn(() => ({ set: vi.fn().mockReturnValue({ where: vi.fn() }) })),
        };
        return tx;
      };

      const baseRow = {
        id: '40000000-0000-7000-8000-000000000004',
        code: hashToken(plaintext),
        clientId: INTERNAL_CLIENT_ID,
        userId: USER_ID,
        redirectUri: 'https://example.com/callback',
        scope: 'openid',
        codeChallenge: challenge,
        codeChallengeMethod: 'S256',
        nonce: null,
        state: 's',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
        createdAt: new Date(),
      };

      const serviceFactory = (tx: ReturnType<typeof mkTx>) =>
        createOAuthService({
          db: {
            transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
          } as never,
          eventBus,
          signingKeyService: signingKeyService as never,
          refreshTokenService: refreshTokenService as never,
          env,
        });

      await expect(
        serviceFactory(mkTx(null)).exchangeToken(
          buildTokenRequestAuthCode({ code: 'nope', code_verifier: verifier }),
          null,
        ),
      ).rejects.toThrow(UnauthorizedError);

      await expect(
        serviceFactory(mkTx({ ...baseRow, expiresAt: new Date(Date.now() - 1000) })).exchangeToken(
          buildTokenRequestAuthCode({ code: plaintext, code_verifier: verifier }),
          null,
        ),
      ).rejects.toThrow(UnauthorizedError);

      await expect(
        serviceFactory(mkTx({ ...baseRow, usedAt: new Date() })).exchangeToken(
          buildTokenRequestAuthCode({ code: plaintext, code_verifier: verifier }),
          null,
        ),
      ).rejects.toThrow(UnauthorizedError);

      await expect(
        serviceFactory(mkTx(baseRow)).exchangeToken(
          buildTokenRequestAuthCode({
            code: plaintext,
            code_verifier: 'c'.repeat(43),
            redirect_uri: 'https://example.com/callback',
          }),
          null,
        ),
      ).rejects.toThrow(UnauthorizedError);

      await expect(
        serviceFactory(mkTx(baseRow)).exchangeToken(
          buildTokenRequestAuthCode({
            code: plaintext,
            code_verifier: verifier,
            redirect_uri: 'https://other.com/cb',
          }),
          null,
        ),
      ).rejects.toThrow(UnauthorizedError);

      await expect(
        serviceFactory(mkTx(baseRow)).exchangeToken(
          buildTokenRequestAuthCode({
            code: plaintext,
            code_verifier: verifier,
            client_id: 'wrong',
          }),
          null,
        ),
      ).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('exchangeToken refresh_token', () => {
    it('valid refresh rotates and returns new tokens', async () => {
      const { hashToken } = await import('../../token/refresh-token.service.js');
      const plain = 'refresh-plain-1';
      const hash = hashToken(plain);

      const rtRow = {
        id: '50000000-0000-7000-8000-000000000005',
        token: hash,
        clientId: INTERNAL_CLIENT_ID,
        userId: USER_ID,
        scope: 'openid email',
        expiresAt: new Date(Date.now() + 3600_000),
        revokedAt: null,
        rotationGracePlaintext: null,
        familyId: '60000000-0000-7000-8000-000000000006',
        createdAt: new Date(),
      };

      const newHash = hashToken('rotated-refresh-plain');
      const newRow = { ...rtRow, token: newHash, userId: USER_ID };

      let selectCall = 0;
      const selectChain = {
        from: vi.fn(),
        where: vi.fn(),
        limit: vi.fn(),
      };
      selectChain.from.mockReturnValue(selectChain);
      selectChain.where.mockReturnValue(selectChain);
      selectChain.limit.mockImplementation(() => {
        selectCall += 1;
        if (selectCall === 1) {
          return Promise.resolve([rtRow]);
        }
        return Promise.resolve([newRow]);
      });

      const db = { select: vi.fn(() => selectChain) } as never;

      mocks.getClient.mockResolvedValue(baseClient());
      mocks.authenticateClient.mockResolvedValue(baseClient());

      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      const tokens = await service.exchangeToken(
        buildTokenRequestRefresh({
          refresh_token: plain,
          client_id: PUBLIC_CLIENT_ID,
          client_secret: 's',
        }),
        null,
      );

      expect(tokens.refresh_token).toBe('rotated-refresh-plain');
      expect(refreshTokenService.rotateRefreshToken).toHaveBeenCalledWith(
        plain,
        env.refreshGracePeriod,
        undefined,
      );
    });

    it('revoked outside grace revokes family and throws', async () => {
      const { hashToken } = await import('../../token/refresh-token.service.js');
      const plain = 'refresh-plain-2';
      refreshTokenService.rotateRefreshToken.mockRejectedValue(
        new UnauthorizedError('Refresh token reuse detected'),
      );

      const selectChain = createSelectWithLimit([
        {
          token: hashToken(plain),
          clientId: INTERNAL_CLIENT_ID,
          userId: USER_ID,
          scope: 'openid',
          expiresAt: new Date(Date.now() + 3600_000),
          revokedAt: new Date(Date.now() - 20_000),
          rotationGracePlaintext: null,
          familyId: 'f1',
          createdAt: new Date(),
        },
      ]);

      const db = {
        select: vi.fn(() => selectChain),
      } as never;

      mocks.getClient.mockResolvedValue(baseClient());

      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      await expect(
        service.exchangeToken(
          buildTokenRequestRefresh({ refresh_token: plain, client_id: PUBLIC_CLIENT_ID }),
          baseClient(),
        ),
      ).rejects.toThrow(UnauthorizedError);
    });

    it('revoked within grace returns same successor from rotate', async () => {
      const { hashToken } = await import('../../token/refresh-token.service.js');
      const plain = 'refresh-plain-3';
      refreshTokenService.rotateRefreshToken.mockResolvedValue('grace-successor');

      const newHash = hashToken('grace-successor');
      const newRow = {
        token: newHash,
        clientId: INTERNAL_CLIENT_ID,
        userId: USER_ID,
        scope: 'openid',
        expiresAt: new Date(Date.now() + 3600_000),
        revokedAt: null,
        rotationGracePlaintext: null,
        familyId: 'f2',
        createdAt: new Date(),
      };

      let call = 0;
      const select = vi.fn(() => {
        const chain = {
          from: vi.fn(),
          where: vi.fn(),
          limit: vi.fn(),
        };
        chain.from.mockReturnValue(chain);
        chain.where.mockReturnValue(chain);
        chain.limit.mockImplementation(() => {
          call += 1;
          if (call === 1) {
            return Promise.resolve([
              {
                token: hashToken(plain),
                clientId: INTERNAL_CLIENT_ID,
                userId: USER_ID,
                scope: 'openid',
                expiresAt: new Date(Date.now() + 3600_000),
                revokedAt: new Date(Date.now() - 1000),
                rotationGracePlaintext: 'grace-successor',
                familyId: 'f2',
                createdAt: new Date(),
              },
            ]);
          }
          return Promise.resolve([newRow]);
        });
        return chain;
      });

      const db = { select } as never;
      mocks.getClient.mockResolvedValue(baseClient());

      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      const tokens = await service.exchangeToken(
        buildTokenRequestRefresh({ refresh_token: plain, client_id: PUBLIC_CLIENT_ID }),
        baseClient(),
      );

      expect(tokens.refresh_token).toBe('grace-successor');
    });
  });

  describe('exchangeToken client_credentials', () => {
    function m2mClient(overrides: Partial<ClientResponse> = {}): ClientResponse {
      return baseClient({
        grantTypes: ['client_credentials'],
        isConfidential: true,
        ...overrides,
      });
    }

    it('issues access token only (no id_token, no refresh_token) for valid confidential client', async () => {
      const db = {} as never;
      const publishSpy = vi.spyOn(eventBus, 'publish');
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      const client = m2mClient();
      const tokens = await service.exchangeToken(buildTokenRequestClientCredentials(), client);

      expect(tokens.access_token).toBeTruthy();
      expect(tokens.token_type).toBe('Bearer');
      expect(tokens.expires_in).toBe(env.accessTokenTtl);
      expect(tokens.scope).toBe(client.scope);
      expect(tokens.refresh_token).toBeUndefined();
      expect(tokens.id_token).toBeUndefined();
      expect(refreshTokenService.createRefreshToken).not.toHaveBeenCalled();
      expect(publishSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: OAUTH_EVENTS.TOKEN_EXCHANGED,
          payload: expect.objectContaining({ grantType: 'client_credentials' }),
        }),
      );
    });

    it('uses requested scope when it is a subset of client allowed scopes', async () => {
      const db = {} as never;
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      const client = m2mClient({ scope: 'openid profile email' });
      const tokens = await service.exchangeToken(
        buildTokenRequestClientCredentials({ scope: 'profile email' }),
        client,
      );

      expect(tokens.scope).toBe('profile email');
    });

    it('uses full client scope when no scope is requested', async () => {
      const db = {} as never;
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      const client = m2mClient({ scope: 'api.read api.write' });
      const tokens = await service.exchangeToken(buildTokenRequestClientCredentials(), client);

      expect(tokens.scope).toBe('api.read api.write');
    });

    it('throws ValidationError when client lacks client_credentials grant type', async () => {
      const db = {} as never;
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      const client = m2mClient({ grantTypes: ['authorization_code'] });

      await expect(
        service.exchangeToken(buildTokenRequestClientCredentials(), client),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for public (non-confidential) client', async () => {
      const db = {} as never;
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      const client = m2mClient({ isConfidential: false });

      await expect(
        service.exchangeToken(buildTokenRequestClientCredentials(), client),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ForbiddenError when client is suspended', async () => {
      const db = {} as never;
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      const client = m2mClient({ status: 'suspended' });

      await expect(
        service.exchangeToken(buildTokenRequestClientCredentials(), client),
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws UnauthorizedError when client is not authenticated', async () => {
      const db = {} as never;
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      await expect(
        service.exchangeToken(buildTokenRequestClientCredentials(), null),
      ).rejects.toThrow(UnauthorizedError);
    });

    it('access token sub is the OAuth client_id (M2M)', async () => {
      const db = {} as never;
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      const client = m2mClient({ clientId: 'm2m-service-client' });
      const tokens = await service.exchangeToken(buildTokenRequestClientCredentials(), client);

      const { payload } = await jose.jwtVerify(tokens.access_token, testSigningKey.publicKeyJwk, {
        issuer: env.jwtIssuer,
        audience: 'm2m-service-client',
      });

      expect(payload.sub).toBe('m2m-service-client');
    });
  });

  describe('revokeToken', () => {
    it('revokes valid refresh token via db update', async () => {
      const plain = 'to-revoke';
      const updateWhere = vi.fn().mockResolvedValue([{ id: '1' }]);
      const update = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({ where: updateWhere }),
      });
      const db = { update } as never;

      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      await service.revokeToken({ token: plain });

      expect(update).toHaveBeenCalled();
      expect(updateWhere).toHaveBeenCalled();
    });

    it('invalid token is no-op', async () => {
      const updateWhere = vi.fn().mockResolvedValue([]);
      const db = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({ where: updateWhere }),
        }),
      } as never;

      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      await expect(service.revokeToken({ token: 'unknown' })).resolves.toBeUndefined();
    });
  });

  describe('getUserInfo', () => {
    it('returns sub for openid; profile adds name; email adds email fields', async () => {
      const userRow = {
        id: USER_ID,
        email: 'u@example.com',
        emailVerified: true,
        displayName: 'Pat',
        status: 'active' as const,
        isAdmin: false,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const selectChain = createSelectWithLimit([userRow]);
      const db = { select: vi.fn(() => selectChain) } as never;

      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      expect(await service.getUserInfo(USER_ID, 'openid')).toEqual({ sub: USER_ID });

      expect(await service.getUserInfo(USER_ID, 'openid profile')).toEqual({
        sub: USER_ID,
        name: 'Pat',
      });

      expect(await service.getUserInfo(USER_ID, 'openid email')).toEqual({
        sub: USER_ID,
        email: 'u@example.com',
        email_verified: true,
      });
    });
  });

  describe('endSession', () => {
    async function mintIdToken(overrides: { expiresInSeconds?: number } = {}): Promise<string> {
      const expiresInSeconds = overrides.expiresInSeconds ?? 3600;
      const accessToken = await issueAccessToken(testSigningKey, {
        issuer: env.jwtIssuer,
        subject: USER_ID,
        audience: PUBLIC_CLIENT_ID,
        scope: 'openid',
        clientId: PUBLIC_CLIENT_ID,
        expiresInSeconds,
      });
      return issueIdToken(testSigningKey, {
        issuer: env.jwtIssuer,
        subject: USER_ID,
        audience: PUBLIC_CLIENT_ID,
        nonce: 'n1',
        authTime: Math.floor(Date.now() / 1000),
        acr: '0',
        amr: ['pwd'],
        accessToken,
        expiresInSeconds,
      });
    }

    it('returns post_logout_redirect_uri with state when id_token_hint is valid and URI is registered', async () => {
      const postLogout = 'https://example.com/logout';
      mocks.getClientByClientId.mockResolvedValue(
        baseClient({ redirectUris: ['https://example.com/callback', postLogout] }),
      );

      const db = {} as never;
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      const idToken = await mintIdToken();
      const result = await service.endSession({
        id_token_hint: idToken,
        post_logout_redirect_uri: postLogout,
        state: 'logout-state',
      });

      const url = new URL(result.redirectUri);
      expect(url.origin + url.pathname).toBe('https://example.com/logout');
      expect(url.searchParams.get('state')).toBe('logout-state');
      expect(mocks.getClientByClientId).toHaveBeenCalledWith(db, PUBLIC_CLIENT_ID);
    });

    it('throws ValidationError when post_logout_redirect_uri is not registered for hinted client', async () => {
      mocks.getClientByClientId.mockResolvedValue(baseClient());

      const db = {} as never;
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      const idToken = await mintIdToken();

      await expect(
        service.endSession({
          id_token_hint: idToken,
          post_logout_redirect_uri: 'https://evil.com/after-logout',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('returns registered post_logout_redirect_uri when id_token_hint is valid', async () => {
      const postLogout = 'https://example.com/logout';
      mocks.getClientByClientId.mockResolvedValue(
        baseClient({ redirectUris: ['https://example.com/callback', postLogout] }),
      );

      const db = {} as never;
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      const idToken = await mintIdToken();
      const result = await service.endSession({
        id_token_hint: idToken,
        post_logout_redirect_uri: postLogout,
      });

      expect(result.redirectUri).toBe(postLogout);
    });

    it('redirects to issuer when id_token_hint is omitted', async () => {
      const db = {} as never;
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      const result = await service.endSession({
        post_logout_redirect_uri: 'https://example.com/logout',
      });

      expect(result.redirectUri).toBe(env.jwtIssuer);
      expect(mocks.getClientByClientId).not.toHaveBeenCalled();
    });

    it('redirects to issuer when id_token_hint is invalid or expired (ignores post_logout_redirect_uri)', async () => {
      mocks.getClientByClientId.mockResolvedValue(
        baseClient({
          redirectUris: ['https://example.com/callback', 'https://example.com/logout'],
        }),
      );

      const db = {} as never;
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      const expiredJwt = await mintIdToken({ expiresInSeconds: -3600 });

      await expect(
        service.endSession({
          id_token_hint: 'not.a.valid.jwt',
          post_logout_redirect_uri: 'https://example.com/logout',
        }),
      ).resolves.toEqual({ redirectUri: env.jwtIssuer });

      await expect(
        service.endSession({
          id_token_hint: expiredJwt,
          post_logout_redirect_uri: 'https://example.com/logout',
        }),
      ).resolves.toEqual({ redirectUri: env.jwtIssuer });

      expect(mocks.getClientByClientId).not.toHaveBeenCalled();
    });

    it('returns the same redirect when invoked repeatedly with the same parameters', async () => {
      const postLogout = 'https://example.com/logout';
      mocks.getClientByClientId.mockResolvedValue(
        baseClient({ redirectUris: ['https://example.com/callback', postLogout] }),
      );

      const db = {} as never;
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      const idToken = await mintIdToken();
      const params = {
        id_token_hint: idToken,
        post_logout_redirect_uri: postLogout,
        state: 's',
      };

      const first = await service.endSession(params);
      const second = await service.endSession(params);

      expect(first).toEqual(second);
      expect(second.redirectUri).toContain('state=s');
    });
  });

  describe('introspectToken', () => {
    it('returns active access_token claims for valid JWT', async () => {
      const db = {} as never;
      const publishSpy = vi.spyOn(eventBus, 'publish');
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      const accessToken = await issueAccessToken(testSigningKey, {
        issuer: env.jwtIssuer,
        subject: USER_ID,
        audience: PUBLIC_CLIENT_ID,
        scope: 'openid profile',
        clientId: PUBLIC_CLIENT_ID,
        expiresInSeconds: 3600,
      });

      const result = await service.introspectToken(accessToken);

      expect(result).toMatchObject({
        active: true,
        sub: USER_ID,
        client_id: PUBLIC_CLIENT_ID,
        scope: 'openid profile',
        token_type: 'access_token',
        iss: env.jwtIssuer,
      });
      expect(result.exp).toBeTypeOf('number');
      expect(result.iat).toBeTypeOf('number');
      expect(publishSpy).toHaveBeenCalledWith(
        expect.objectContaining({ eventName: TOKEN_EVENTS.TOKEN_INTROSPECTED }),
      );
    });

    it('returns active: false for expired access token', async () => {
      const db = createRefreshIntrospectDb([]);
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      const now = Math.floor(Date.now() / 1000);
      const expiredJwt = await new jose.SignJWT({
        scope: 'openid',
        client_id: PUBLIC_CLIENT_ID,
      })
        .setProtectedHeader({ alg: 'RS256', kid: testSigningKey.kid })
        .setIssuer(env.jwtIssuer)
        .setSubject(USER_ID)
        .setAudience(PUBLIC_CLIENT_ID)
        .setIssuedAt(now - 7200)
        .setExpirationTime(now - 3600)
        .sign(testSigningKey.privateKey);

      await expect(service.introspectToken(expiredJwt)).resolves.toEqual({ active: false });
    });

    it('returns active: false for invalid access token (bad signature)', async () => {
      const db = createRefreshIntrospectDb([]);
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      await expect(service.introspectToken('not.a.valid.jwt')).resolves.toEqual({ active: false });
    });

    it('returns active refresh_token metadata from DB', async () => {
      const plain = 'opaque-refresh-1';
      const createdAt = new Date('2024-06-01T12:00:00.000Z');
      const expiresAt = new Date(Date.now() + 3600_000);

      const row = {
        scope: 'openid email',
        userId: USER_ID,
        expiresAt,
        revokedAt: null,
        createdAt,
        dpopJkt: null,
        oauthClientId: PUBLIC_CLIENT_ID,
      };

      const db = createRefreshIntrospectDb([row]);
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      const result = await service.introspectToken(plain);

      expect(result).toEqual({
        active: true,
        sub: USER_ID,
        client_id: PUBLIC_CLIENT_ID,
        scope: 'openid email',
        exp: Math.floor(expiresAt.getTime() / 1000),
        iat: Math.floor(createdAt.getTime() / 1000),
        iss: env.jwtIssuer,
        token_type: 'refresh_token',
      });
    });

    it('returns active: false for revoked refresh token', async () => {
      const plain = 'opaque-refresh-revoked';
      const row = {
        scope: 'openid',
        userId: USER_ID,
        expiresAt: new Date(Date.now() + 3600_000),
        revokedAt: new Date(),
        createdAt: new Date(),
        dpopJkt: null,
        oauthClientId: PUBLIC_CLIENT_ID,
      };

      const db = createRefreshIntrospectDb([row]);
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      await expect(service.introspectToken(plain)).resolves.toEqual({ active: false });
    });

    it('includes cnf.jkt and DPoP+access_token for DPoP-bound access token', async () => {
      const db = {} as never;
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      const accessToken = await issueAccessToken(testSigningKey, {
        issuer: env.jwtIssuer,
        subject: USER_ID,
        audience: PUBLIC_CLIENT_ID,
        scope: 'openid',
        clientId: PUBLIC_CLIENT_ID,
        expiresInSeconds: 3600,
        dpopJkt: 'dpop-jkt-thumbprint',
      });

      const result = await service.introspectToken(accessToken);

      expect(result).toMatchObject({
        active: true,
        token_type: 'DPoP+access_token',
        cnf: { jkt: 'dpop-jkt-thumbprint' },
      });
    });

    it('returns active: false for unknown token', async () => {
      const db = createRefreshIntrospectDb([]);
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      await expect(service.introspectToken('totally-unknown')).resolves.toEqual({ active: false });
    });

    it('uses token_type_hint to order lookups without changing the result', async () => {
      const plain = 'opaque-refresh-hint';
      const createdAt = new Date('2024-06-01T12:00:00.000Z');
      const expiresAt = new Date(Date.now() + 3600_000);

      const row = {
        scope: 'openid',
        userId: USER_ID,
        expiresAt,
        revokedAt: null,
        createdAt,
        dpopJkt: null,
        oauthClientId: PUBLIC_CLIENT_ID,
      };

      const db = createRefreshIntrospectDb([row]);
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      signingKeyService.getJwks.mockClear();

      const withoutHint = await service.introspectToken(plain);
      expect(signingKeyService.getJwks).toHaveBeenCalled();

      signingKeyService.getJwks.mockClear();

      const withHint = await service.introspectToken(plain, 'refresh_token');
      expect(signingKeyService.getJwks).not.toHaveBeenCalled();

      expect(withHint).toEqual(withoutHint);
      expect(withHint.active).toBe(true);
    });

    it('includes cnf.jkt on refresh token row when dpopJkt is set', async () => {
      const plain = 'opaque-refresh-dpop';
      const row = {
        scope: 'openid',
        userId: USER_ID,
        expiresAt: new Date(Date.now() + 3600_000),
        revokedAt: null,
        createdAt: new Date('2024-06-01T12:00:00.000Z'),
        dpopJkt: 'refresh-bound-jkt',
        oauthClientId: PUBLIC_CLIENT_ID,
      };

      const db = createRefreshIntrospectDb([row]);
      const service = createOAuthService({
        db,
        eventBus,
        signingKeyService: signingKeyService as never,
        refreshTokenService: refreshTokenService as never,
        env,
      });

      const result = await service.introspectToken(plain, 'refresh_token');

      expect(result).toMatchObject({
        active: true,
        token_type: 'refresh_token',
        cnf: { jkt: 'refresh-bound-jkt' },
      });
    });
  });
});
