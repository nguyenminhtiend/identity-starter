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
  authorizeWithPar: vi.fn(),
  createParRequest: vi.fn(),
  submitConsent: vi.fn(),
  exchangeToken: vi.fn(),
  revokeToken: vi.fn(),
  endSession: vi.fn(),
  getUserInfo: vi.fn(),
  introspectToken: vi.fn(),
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
    PAR_TTL_SECONDS: 60,
  },
}));

vi.mock('../oauth.service.js', () => ({
  createOAuthService: vi.fn(() => ({
    authorize: mocks.authorize,
    authorizeWithPar: mocks.authorizeWithPar,
    createParRequest: mocks.createParRequest,
    submitConsent: mocks.submitConsent,
    exchangeToken: mocks.exchangeToken,
    revokeToken: mocks.revokeToken,
    endSession: mocks.endSession,
    getUserInfo: mocks.getUserInfo,
    introspectToken: mocks.introspectToken,
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

vi.mock('../../session/session.service.js', () => ({
  validateSession: vi.fn().mockResolvedValue(null),
  revokeSession: vi.fn().mockResolvedValue(undefined),
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
    mocks.authorizeWithPar.mockReset();
    mocks.createParRequest.mockReset();
    mocks.submitConsent.mockReset();
    mocks.exchangeToken.mockReset();
    mocks.revokeToken.mockReset();
    mocks.endSession.mockReset();
    mocks.endSession.mockResolvedValue({ redirectUri: 'http://localhost:3000' });
    mocks.getUserInfo.mockReset();
    mocks.introspectToken.mockReset();
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

    it('uses authorizeWithPar when request_uri is present', async () => {
      const requestUri = 'urn:ietf:params:oauth:request_uri:xyz';
      const clientId = 'par-client';
      mocks.authorizeWithPar.mockResolvedValue({
        type: 'redirect',
        redirectUri: 'https://example.com/callback?code=par',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/oauth/authorize',
        headers: sessionHeaders,
        query: { request_uri: requestUri, client_id: clientId },
      });

      expect(response.statusCode).toBe(302);
      expect(mocks.authorizeWithPar).toHaveBeenCalledWith(mockSession.userId, requestUri, clientId);
      expect(mocks.authorize).not.toHaveBeenCalled();
    });
  });

  describe('POST /oauth/par', () => {
    const parBody = {
      response_type: 'code' as const,
      client_id: 'cid-1',
      client_secret: 'secret',
      redirect_uri: 'https://example.com/callback',
      scope: 'openid',
      code_challenge: 'a'.repeat(43),
      code_challenge_method: 'S256' as const,
    };

    it('returns 401 when client is not authenticated', async () => {
      mocks.authenticateClient.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/oauth/par',
        headers: { 'content-type': 'application/json' },
        payload: parBody,
      });

      expect(response.statusCode).toBe(401);
      expect(mocks.createParRequest).not.toHaveBeenCalled();
    });

    it('returns 201 with request_uri when client authenticates', async () => {
      mocks.authenticateClient.mockResolvedValue({
        id: '00000000-0000-7000-8000-000000000099',
        clientId: 'cid-1',
        clientName: 'P',
        description: null,
        redirectUris: ['https://example.com/callback'],
        grantTypes: ['authorization_code', 'refresh_token'],
        responseTypes: ['code'],
        scope: 'openid profile',
        tokenEndpointAuthMethod: 'client_secret_basic',
        isConfidential: true,
        logoUri: null,
        tosUri: null,
        policyUri: null,
        applicationType: 'web',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mocks.createParRequest.mockResolvedValue({
        request_uri: 'urn:ietf:params:oauth:request_uri:test',
        expires_in: 60,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/oauth/par',
        headers: { 'content-type': 'application/json' },
        payload: parBody,
      });

      expect(response.statusCode).toBe(201);
      expect(JSON.parse(response.body)).toEqual({
        request_uri: 'urn:ietf:params:oauth:request_uri:test',
        expires_in: 60,
      });
      expect(mocks.createParRequest).toHaveBeenCalled();
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
      const origin = 'https://client.example';

      const response = await app.inject({
        method: 'POST',
        url: '/oauth/token',
        headers: { 'content-type': 'application/json', origin },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toMatchObject(tokenResponse);
      expect(mocks.exchangeToken).toHaveBeenCalledWith(body, null);
      expect(response.headers['access-control-allow-origin']).toBe(origin);
      expect(response.headers['access-control-allow-methods']).toBe('POST');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
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

  describe('POST /oauth/introspect', () => {
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

    it('returns 200 with introspection response when client auth is valid', async () => {
      mocks.authenticateClient.mockResolvedValue(authed);
      const introspection = {
        active: true,
        sub: mockSession.userId,
        client_id: 'cid',
        scope: 'openid profile',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        iss: 'http://localhost:3000',
        token_type: 'access_token',
      };
      mocks.introspectToken.mockResolvedValue(introspection);

      const basic = Buffer.from('cid:secret').toString('base64');
      const origin = 'https://introspect-client.example';
      const response = await app.inject({
        method: 'POST',
        url: '/oauth/introspect',
        headers: {
          'content-type': 'application/json',
          authorization: `Basic ${basic}`,
          origin,
        },
        payload: { token: 'opaque-at' },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body)).toEqual(introspection);
      expect(mocks.authenticateClient).toHaveBeenCalledWith(expect.anything(), 'cid', 'secret');
      expect(mocks.introspectToken).toHaveBeenCalledWith('opaque-at', undefined);
      expect(response.headers['access-control-allow-origin']).toBe(origin);
    });

    it('returns 401 when client authentication is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/oauth/introspect',
        headers: { 'content-type': 'application/json' },
        payload: { token: 'opaque-at' },
      });

      expect(response.statusCode).toBe(401);
      expect(mocks.introspectToken).not.toHaveBeenCalled();
    });

    it('returns 400 when token is missing', async () => {
      const basic = Buffer.from('cid:secret').toString('base64');
      const response = await app.inject({
        method: 'POST',
        url: '/oauth/introspect',
        headers: {
          'content-type': 'application/json',
          authorization: `Basic ${basic}`,
        },
        payload: { client_id: 'cid', client_secret: 'secret' },
      });

      expect(response.statusCode).toBe(400);
      expect(mocks.introspectToken).not.toHaveBeenCalled();
    });
  });

  describe('POST /oauth/revoke', () => {
    it('returns 200', async () => {
      mocks.revokeToken.mockResolvedValue(undefined);
      const origin = 'https://revoke-client.example';

      const response = await app.inject({
        method: 'POST',
        url: '/oauth/revoke',
        headers: { 'content-type': 'application/json', origin },
        payload: { token: 'tok' },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.revokeToken).toHaveBeenCalledWith({ token: 'tok' });
      expect(response.headers['access-control-allow-origin']).toBe(origin);
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

  describe('GET /oauth/end-session', () => {
    it('returns 302 when id_token_hint is present', async () => {
      mocks.endSession.mockResolvedValue({
        redirectUri: 'https://example.com/logout?state=s',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/oauth/end-session',
        query: { id_token_hint: 'header.payload.sig' },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('https://example.com/logout?state=s');
      expect(mocks.endSession).toHaveBeenCalledWith(
        expect.objectContaining({ id_token_hint: 'header.payload.sig' }),
      );
    });

    it('returns 302 redirect to issuer when id_token_hint is omitted', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/oauth/end-session',
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('http://localhost:3000');
      expect(mocks.endSession).toHaveBeenCalledWith({});
    });

    it('passes post_logout_redirect_uri and reflects it in the redirect location', async () => {
      const target = 'https://client.example/after-logout?state=st';
      mocks.endSession.mockResolvedValue({ redirectUri: target });

      const response = await app.inject({
        method: 'GET',
        url: '/oauth/end-session',
        query: { post_logout_redirect_uri: 'https://client.example/after-logout', state: 'st' },
      });

      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe(target);
      expect(mocks.endSession).toHaveBeenCalledWith(
        expect.objectContaining({
          post_logout_redirect_uri: 'https://client.example/after-logout',
          state: 'st',
        }),
      );
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
