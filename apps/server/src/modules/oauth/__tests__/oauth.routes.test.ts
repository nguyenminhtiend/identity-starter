import type { FastifyInstance, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Container } from '../../../core/container-plugin.js';
import { errorHandlerPlugin } from '../../../core/plugins/error-handler.js';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import { makeSession } from '../../session/__tests__/session.factory.js';
import {
  buildAuthorizeQuery,
  buildConsentApprove,
  buildTokenRequestAuthCode,
  buildTokenRequestRefresh,
} from './oauth.factory.js';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  submitConsent: vi.fn(),
  exchangeToken: vi.fn(),
  revokeToken: vi.fn(),
  getUserInfo: vi.fn(),
  getJwks: vi.fn(),
  verifyAccessToken: vi.fn(),
  authenticateClient: vi.fn(),
}));

vi.mock('../../../core/env.js', () => ({
  env: {
    JWT_ISSUER: 'http://localhost:3000',
    ACCESS_TOKEN_TTL_SECONDS: 3600,
    REFRESH_TOKEN_TTL_SECONDS: 2_592_000,
    AUTH_CODE_TTL_SECONDS: 600,
    REFRESH_GRACE_PERIOD_SECONDS: 10,
  },
}));

vi.mock('../oauth.service.js', () => ({
  createOAuthService: vi.fn(() => ({
    authorize: mocks.authorize,
    submitConsent: mocks.submitConsent,
    exchangeToken: mocks.exchangeToken,
    revokeToken: mocks.revokeToken,
    getUserInfo: mocks.getUserInfo,
  })),
}));

vi.mock('../../token/signing-key.service.js', () => ({
  createSigningKeyService: vi.fn(() => ({
    getJwks: mocks.getJwks,
    getActiveSigningKey: vi.fn(),
  })),
}));

vi.mock('../../token/refresh-token.service.js', () => ({
  createRefreshTokenService: vi.fn(() => ({})),
}));

vi.mock('../../token/jwt.service.js', () => ({
  verifyAccessToken: mocks.verifyAccessToken,
}));

vi.mock('../../client/client.service.js', () => ({
  authenticateClient: mocks.authenticateClient,
}));

import { oauthRoutes } from '../oauth.routes.js';

describe('oauth routes', () => {
  let app: FastifyInstance;
  const mockSession = makeSession();
  const sessionHeaders = { authorization: 'Bearer session-token' };

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    app.decorate('container', {
      db: {} as unknown as Container['db'],
      eventBus: new InMemoryEventBus(),
    });

    app.decorate('requireSession', async (request: FastifyRequest) => {
      request.session = mockSession;
      request.userId = mockSession.userId;
    });
    app.decorateRequest('session', null as unknown as typeof mockSession);
    app.decorateRequest('userId', '');

    await app.register(errorHandlerPlugin);
    await app.register(oauthRoutes, { prefix: '/oauth' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mocks.authorize.mockReset();
    mocks.submitConsent.mockReset();
    mocks.exchangeToken.mockReset();
    mocks.revokeToken.mockReset();
    mocks.getUserInfo.mockReset();
    mocks.getJwks.mockReset();
    mocks.verifyAccessToken.mockReset();
    mocks.authenticateClient.mockReset();
    mocks.getJwks.mockResolvedValue({ keys: [] });
  });

  describe('GET /oauth/authorize', () => {
    it('returns consent_required when authorize requires consent', async () => {
      const query = buildAuthorizeQuery();
      mocks.authorize.mockResolvedValue({
        type: 'consent_required',
        client: {
          clientId: 'c1',
          clientName: 'App',
          scope: 'openid',
          logoUri: null,
          policyUri: null,
          tosUri: null,
        },
        requestedScope: query.scope,
        state: query.state,
        redirectUri: query.redirect_uri,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/oauth/authorize',
        headers: sessionHeaders,
        query,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.type).toBe('consent_required');
      expect(body.client.clientId).toBe('c1');
      expect(mocks.authorize).toHaveBeenCalledWith(
        mockSession.userId,
        expect.objectContaining(query),
      );
    });

    it('redirects with code when authorize returns redirect', async () => {
      const query = buildAuthorizeQuery();
      mocks.authorize.mockResolvedValue({
        type: 'redirect',
        redirectUri: 'https://example.com/callback?code=abc&state=s',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/oauth/authorize',
        headers: sessionHeaders,
        query,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('https://example.com/callback?code=abc&state=s');
    });
  });

  describe('POST /oauth/token', () => {
    const tokenResponse = {
      access_token: 'at',
      token_type: 'Bearer' as const,
      expires_in: 3600,
      refresh_token: 'rt',
      scope: 'openid profile',
    };

    it('returns 200 for authorization_code grant', async () => {
      const body = buildTokenRequestAuthCode();
      mocks.authenticateClient.mockResolvedValue(null);
      mocks.exchangeToken.mockResolvedValue(tokenResponse);

      const response = await app.inject({
        method: 'POST',
        url: '/oauth/token',
        headers: { 'content-type': 'application/json' },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject(tokenResponse);
      expect(mocks.exchangeToken).toHaveBeenCalledWith(body, null);
    });

    it('returns 200 for refresh_token grant', async () => {
      const body = buildTokenRequestRefresh();
      mocks.authenticateClient.mockResolvedValue(null);
      mocks.exchangeToken.mockResolvedValue(tokenResponse);

      const response = await app.inject({
        method: 'POST',
        url: '/oauth/token',
        headers: { 'content-type': 'application/json' },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.exchangeToken).toHaveBeenCalledWith(body, null);
    });

    it('authenticates with client_secret_basic via Authorization header', async () => {
      const body = buildTokenRequestAuthCode();
      const authed = {
        id: 'internal',
        clientId: 'cid',
        clientName: 'C',
        description: null,
        redirectUris: ['https://example.com/callback'],
        grantTypes: ['authorization_code'] as const,
        responseTypes: ['code'] as const,
        scope: 'openid',
        tokenEndpointAuthMethod: 'client_secret_basic' as const,
        isConfidential: true,
        logoUri: null,
        tosUri: null,
        policyUri: null,
        applicationType: 'web' as const,
        status: 'active' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mocks.authenticateClient.mockResolvedValue(authed);
      mocks.exchangeToken.mockResolvedValue(tokenResponse);

      const basic = Buffer.from('cid:secret').toString('base64');
      const response = await app.inject({
        method: 'POST',
        url: '/oauth/token',
        headers: {
          'content-type': 'application/json',
          authorization: `Basic ${basic}`,
        },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.authenticateClient).toHaveBeenCalledWith(expect.anything(), 'cid', 'secret');
      expect(mocks.exchangeToken).toHaveBeenCalledWith(body, authed);
    });

    it('authenticates with client_secret_post via body', async () => {
      const body = {
        ...buildTokenRequestAuthCode(),
        client_id: 'post-cid',
        client_secret: 'post-secret',
      };
      const authed = {
        id: 'internal-2',
        clientId: 'post-cid',
        clientName: 'C',
        description: null,
        redirectUris: ['https://example.com/callback'],
        grantTypes: ['authorization_code'] as const,
        responseTypes: ['code'] as const,
        scope: 'openid',
        tokenEndpointAuthMethod: 'client_secret_post' as const,
        isConfidential: true,
        logoUri: null,
        tosUri: null,
        policyUri: null,
        applicationType: 'web' as const,
        status: 'active' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mocks.authenticateClient.mockResolvedValue(authed);
      mocks.exchangeToken.mockResolvedValue(tokenResponse);

      const response = await app.inject({
        method: 'POST',
        url: '/oauth/token',
        headers: { 'content-type': 'application/json' },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.authenticateClient).toHaveBeenCalledWith(
        expect.anything(),
        'post-cid',
        'post-secret',
      );
      expect(mocks.exchangeToken).toHaveBeenCalledWith(body, authed);
    });
  });

  describe('POST /oauth/consent', () => {
    it('returns redirect response', async () => {
      const payload = buildConsentApprove();
      mocks.submitConsent.mockResolvedValue({
        type: 'redirect',
        redirectUri: 'https://example.com/callback?code=x&state=y',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/oauth/consent',
        headers: sessionHeaders,
        payload,
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('https://example.com/callback?code=x&state=y');
    });
  });

  describe('POST /oauth/revoke', () => {
    it('returns 200', async () => {
      mocks.revokeToken.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/oauth/revoke',
        headers: { 'content-type': 'application/json' },
        payload: { token: 'tok' },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.revokeToken).toHaveBeenCalledWith({ token: 'tok' });
    });

    it('returns 401 when client auth is provided but invalid', async () => {
      mocks.authenticateClient.mockResolvedValue(null);

      const basic = Buffer.from('bad:creds').toString('base64');
      const response = await app.inject({
        method: 'POST',
        url: '/oauth/revoke',
        headers: {
          'content-type': 'application/json',
          authorization: `Basic ${basic}`,
        },
        payload: { token: 'tok' },
      });

      expect(response.statusCode).toBe(401);
      expect(mocks.revokeToken).not.toHaveBeenCalled();
    });
  });

  describe('GET /oauth/userinfo', () => {
    it('returns 200 with user claims when Bearer access token is valid', async () => {
      mocks.verifyAccessToken.mockResolvedValue({
        payload: { sub: mockSession.userId, scope: 'openid profile email' },
        protectedHeader: { alg: 'RS256' },
      });
      mocks.getUserInfo.mockResolvedValue({
        sub: mockSession.userId,
        email: 'u@example.com',
        email_verified: true,
        name: 'User',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/oauth/userinfo',
        headers: { authorization: 'Bearer access.jwt.token' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.sub).toBe(mockSession.userId);
      expect(body.email).toBe('u@example.com');
      expect(mocks.verifyAccessToken).toHaveBeenCalled();
      expect(mocks.getUserInfo).toHaveBeenCalledWith(mockSession.userId, 'openid profile email');
    });

    it('returns 401 without Bearer token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/oauth/userinfo',
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
