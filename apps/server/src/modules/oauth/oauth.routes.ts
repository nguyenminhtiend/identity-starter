import rateLimit from '@fastify/rate-limit';
import { UnauthorizedError, ValidationError } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import * as jose from 'jose';

import { env } from '../../core/env.js';
import { clearSessionCookie, getSessionCookieName } from '../../core/plugins/auth.js';
import type { ClientResponse } from '../client/client.schemas.js';
import { authenticateClient } from '../client/client.service.js';
import { revokeSession, validateSession } from '../session/session.service.js';
import { validateDpopProof } from '../token/dpop.service.js';
import { verifyAccessToken } from '../token/jwt.service.js';
import { createRefreshTokenService } from '../token/refresh-token.service.js';
import { createSigningKeyService } from '../token/signing-key.service.js';
import {
  authorizeQuerySchema,
  consentClientIdParamSchema,
  consentSchema,
  endSessionQuerySchema,
  introspectRequestSchema,
  introspectResponseSchema,
  parRequestSchema,
  parResponseSchema,
  revokeBodySchema,
  tokenRequestSchema,
  tokenResponseSchema,
  userinfoResponseSchema,
} from './oauth.schemas.js';
import { createOAuthService } from './oauth.service.js';

const ALLOWED_ORIGINS = new Set(env.CORS_ORIGINS.split(',').map((s) => s.trim()));

function extractClientCredentials(
  request: FastifyRequest,
): { clientId: string; clientSecret: string } | null {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
    const colonIndex = decoded.indexOf(':');
    if (colonIndex !== -1) {
      return {
        clientId: decoded.slice(0, colonIndex),
        clientSecret: decoded.slice(colonIndex + 1),
      };
    }
  }
  return null;
}

function tokenEndpointRateLimitKey(request: FastifyRequest): string {
  const creds = extractClientCredentials(request);
  if (creds !== null) {
    return `client:${creds.clientId}`;
  }
  const raw = request.body;
  if (
    raw !== null &&
    typeof raw === 'object' &&
    'client_id' in raw &&
    typeof (raw as { client_id?: unknown }).client_id === 'string'
  ) {
    return `client:${(raw as { client_id: string }).client_id}`;
  }
  return `ip:${request.ip}`;
}

async function resolveAuthenticatedClient(
  db: Database,
  request: FastifyRequest,
  body: { client_id?: string; client_secret?: string },
): Promise<ClientResponse | null> {
  if (request.headers.authorization?.startsWith('Basic ')) {
    const creds = extractClientCredentials(request);
    if (creds === null) {
      return null;
    }
    return authenticateClient(db, creds.clientId, creds.clientSecret);
  }
  if (body.client_id !== undefined && body.client_secret !== undefined) {
    return authenticateClient(db, body.client_id, body.client_secret);
  }
  return null;
}

async function setOAuthTokenEndpointCors(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const origin = request.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Access-Control-Allow-Methods', 'POST');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, DPoP');
    reply.header('Access-Control-Allow-Credentials', 'true');
  }
}

export const oauthRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const { db, eventBus } = fastify.container;

  const signingKeyService = createSigningKeyService({ db });
  const refreshTokenService = createRefreshTokenService({ db, eventBus });
  const oauthService = createOAuthService({
    db,
    eventBus,
    signingKeyService,
    refreshTokenService,
    env: {
      jwtIssuer: env.JWT_ISSUER,
      accessTokenTtl: env.ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTtl: env.REFRESH_TOKEN_TTL_SECONDS,
      authCodeTtl: env.AUTH_CODE_TTL_SECONDS,
      refreshGracePeriod: env.REFRESH_GRACE_PERIOD_SECONDS,
      parTtl: env.PAR_TTL_SECONDS,
    },
  });

  await fastify.register(rateLimit, { global: false });

  fastify.get(
    '/authorize',
    {
      preHandler: fastify.requireSession,
      schema: {
        querystring: authorizeQuerySchema,
      },
    },
    async (request, reply) => {
      const result = await oauthService.authorizeWithPar(
        request.userId,
        request.query.request_uri,
        request.query.client_id,
      );
      if (result.type === 'redirect') {
        return reply.redirect(result.redirectUri, 302);
      }
      return reply.status(200).send({
        type: 'consent_required' as const,
        client: result.client,
        requestedScope: result.requestedScope,
        state: result.state,
        redirectUri: result.redirectUri,
      });
    },
  );

  fastify.post(
    '/par',
    {
      onRequest: [setOAuthTokenEndpointCors],
      schema: {
        body: parRequestSchema,
        response: { 201: parResponseSchema },
      },
    },
    async (request, reply) => {
      const authenticatedClient = await resolveAuthenticatedClient(db, request, request.body);
      if (!authenticatedClient) {
        throw new UnauthorizedError('Client authentication required');
      }
      const result = await oauthService.createParRequest(authenticatedClient, request.body);
      return reply.status(201).send(result);
    },
  );

  fastify.post(
    '/token',
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
          hook: 'preHandler',
          keyGenerator: tokenEndpointRateLimitKey,
        },
      },
      onRequest: [setOAuthTokenEndpointCors],
      schema: {
        body: tokenRequestSchema,
        response: { 200: tokenResponseSchema },
      },
    },
    async (request, reply) => {
      const authenticatedClient = await resolveAuthenticatedClient(db, request, request.body);
      const dpopHeader = request.headers.dpop;
      const dpopProof = typeof dpopHeader === 'string' ? dpopHeader : undefined;
      if (!dpopProof) {
        throw new ValidationError('DPoP proof is required', { dpop: 'Required' });
      }
      const htu = `${request.protocol}://${request.host}${request.url.split('?')[0]}`;
      const dpopResult = await validateDpopProof(dpopProof, {
        htm: 'POST',
        htu,
      });
      const tokens = await oauthService.exchangeToken(
        request.body,
        authenticatedClient,
        dpopResult.jkt,
      );
      return reply.status(200).send(tokens);
    },
  );

  fastify.post(
    '/consent',
    {
      preHandler: fastify.requireSession,
      schema: {
        body: consentSchema,
      },
    },
    async (request, reply) => {
      const result = await oauthService.submitConsent(request.userId, request.body);
      return reply.redirect(result.redirectUri, 302);
    },
  );

  fastify.delete(
    '/consent/:clientId',
    {
      preHandler: fastify.requireSession,
      schema: {
        params: consentClientIdParamSchema,
      },
    },
    async (request, reply) => {
      await oauthService.revokeConsent(request.userId, request.params.clientId);
      return reply.status(204).send();
    },
  );

  fastify.post(
    '/introspect',
    {
      onRequest: [setOAuthTokenEndpointCors],
      schema: {
        body: introspectRequestSchema,
        response: { 200: introspectResponseSchema },
      },
    },
    async (request, reply) => {
      const authenticatedClient = await resolveAuthenticatedClient(db, request, request.body);
      if (!authenticatedClient) {
        throw new UnauthorizedError('Client authentication required');
      }
      const result = await oauthService.introspectToken(
        request.body.token,
        request.body.token_type_hint,
      );
      return reply.status(200).send(result);
    },
  );

  fastify.post(
    '/revoke',
    {
      onRequest: [setOAuthTokenEndpointCors],
      schema: {
        body: revokeBodySchema,
      },
    },
    async (request, reply) => {
      const { client_id: _cid, client_secret: _cs, ...revokeInput } = request.body;
      const hasBasic = request.headers.authorization?.startsWith('Basic ') ?? false;
      const hasPostSecret =
        request.body.client_id !== undefined && request.body.client_secret !== undefined;
      if (hasBasic || hasPostSecret) {
        const client = await resolveAuthenticatedClient(db, request, request.body);
        if (!client) {
          throw new UnauthorizedError('Invalid client');
        }
      }
      await oauthService.revokeToken(revokeInput);
      return reply.status(200).send();
    },
  );

  fastify.get(
    '/end-session',
    {
      schema: {
        querystring: endSessionQuerySchema,
      },
    },
    async (request, reply) => {
      const authHeader = request.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const sessionToken = authHeader.slice(7);
        try {
          const session = await validateSession(db, sessionToken);
          if (session) {
            await revokeSession(db, eventBus, session.id);
          }
        } catch {
          // Session may already be destroyed — ignore
        }
      }

      const cookieName = getSessionCookieName(request);
      const cookieValue = request.cookies?.[cookieName];
      if (cookieValue) {
        try {
          const session = await validateSession(db, cookieValue);
          if (session) {
            await revokeSession(db, eventBus, session.id);
          }
        } catch {
          // ignore
        }
        clearSessionCookie(reply, cookieName);
      }

      const result = await oauthService.endSession(request.query);
      return reply.redirect(result.redirectUri, 302);
    },
  );

  fastify.get(
    '/userinfo',
    {
      schema: {
        response: { 200: userinfoResponseSchema },
      },
    },
    async (request, reply) => {
      const authHeader = request.headers.authorization;
      let token: string;
      let isDpop = false;
      if (authHeader?.startsWith('DPoP ')) {
        token = authHeader.slice(5);
        isDpop = true;
      } else if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      } else {
        throw new UnauthorizedError('Missing or invalid Authorization header');
      }
      const jwks = await signingKeyService.getJwks();
      const localJwks = jose.createLocalJWKSet(jwks);
      const result = await verifyAccessToken(localJwks, token, env.JWT_ISSUER);
      if (!result) {
        throw new UnauthorizedError('Invalid access token');
      }
      if (isDpop) {
        const dpopHdr = request.headers.dpop;
        const dpopProof = typeof dpopHdr === 'string' ? dpopHdr : undefined;
        if (dpopProof === undefined) {
          throw new UnauthorizedError('DPoP proof required');
        }
        const issuerBase = env.JWT_ISSUER.replace(/\/$/, '');
        const dpopResult = await validateDpopProof(dpopProof, {
          htm: 'GET',
          htu: `${issuerBase}/oauth/userinfo`,
          accessToken: token,
        });
        const cnf = result.payload.cnf as { jkt?: string } | undefined;
        if (!cnf?.jkt || cnf.jkt !== dpopResult.jkt) {
          throw new UnauthorizedError('DPoP binding mismatch');
        }
      }
      const sub = result.payload.sub;
      const scope = typeof result.payload.scope === 'string' ? result.payload.scope : '';
      if (sub === undefined || sub === '') {
        throw new UnauthorizedError('Invalid access token');
      }
      const userinfo = await oauthService.getUserInfo(sub, scope);
      return reply.status(200).send(userinfo);
    },
  );
};
