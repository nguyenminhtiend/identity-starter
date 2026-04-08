import { UnauthorizedError } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { validateDpopProof } from '../../modules/token/dpop.service.js';
import { verifyAccessToken } from '../../modules/token/jwt.service.js';
import { createSigningKeyService } from '../../modules/token/signing-key.service.js';

const DEFAULT_COOKIE_NAME = 'session';

export interface SessionLike {
  id: string;
  userId: string;
}

export type ValidateSessionFn = (db: Database, token: string) => Promise<SessionLike | null>;

export interface AuthPluginOptions {
  validateSession: ValidateSessionFn;
  jwtIssuer?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    session: SessionLike;
    userId: string;
  }

  interface FastifyInstance {
    requireSession: (request: FastifyRequest) => Promise<void>;
  }
}

function looksLikeJwt(token: string): boolean {
  const parts = token.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

export function getSessionCookieName(_request: FastifyRequest): string {
  return DEFAULT_COOKIE_NAME;
}

interface ExtractedToken {
  token: string;
  scheme: 'bearer' | 'dpop' | 'cookie';
}

function extractToken(request: FastifyRequest): ExtractedToken | null {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('DPoP ')) {
    return { token: authHeader.slice(5), scheme: 'dpop' };
  }
  if (authHeader?.startsWith('Bearer ')) {
    return { token: authHeader.slice(7), scheme: 'bearer' };
  }
  const cookieName = getSessionCookieName(request);
  const cookieValue = request.cookies?.[cookieName];
  if (cookieValue) {
    return { token: cookieValue, scheme: 'cookie' };
  }
  return null;
}

function buildHtu(request: FastifyRequest): string {
  const proto = request.protocol;
  const host = request.host;
  const path = request.url.split('?')[0];
  return `${proto}://${host}${path}`;
}

export const authPlugin = fp(async (fastify, opts: AuthPluginOptions) => {
  const { db } = fastify.container;
  const signingKeyService = createSigningKeyService({ db });
  const jwtIssuer = opts.jwtIssuer;

  fastify.decorateRequest('session', null as unknown as SessionLike);
  fastify.decorateRequest('userId', '');

  fastify.decorate('requireSession', async (request: FastifyRequest) => {
    const extracted = extractToken(request);
    if (!extracted) {
      throw new UnauthorizedError('Missing or invalid authentication credentials');
    }

    const { token, scheme } = extracted;

    if (jwtIssuer && looksLikeJwt(token)) {
      const jwks = await signingKeyService.getJwks();
      const { createLocalJWKSet } = await import('jose');
      const localJwks = createLocalJWKSet(jwks);
      const result = await verifyAccessToken(localJwks, token, jwtIssuer);

      if (result) {
        const sub = result.payload.sub;
        if (typeof sub === 'string' && sub !== '') {
          const cnf = result.payload.cnf as { jkt?: string } | undefined;

          if (cnf?.jkt) {
            if (scheme !== 'dpop') {
              throw new UnauthorizedError('DPoP-bound token requires DPoP authorization scheme');
            }

            const dpopHeader = request.headers.dpop;
            const dpopProof = typeof dpopHeader === 'string' ? dpopHeader : undefined;
            if (!dpopProof) {
              throw new UnauthorizedError('DPoP proof required for sender-constrained token');
            }

            const dpopResult = await validateDpopProof(dpopProof, {
              htm: request.method,
              htu: buildHtu(request),
              accessToken: token,
            });

            if (dpopResult.jkt !== cnf.jkt) {
              throw new UnauthorizedError('DPoP binding mismatch');
            }
          }

          request.session = { id: `jwt:${result.payload.jti ?? sub}`, userId: sub };
          request.userId = sub;
          return;
        }
      }
    }

    const session = await opts.validateSession(db, token);
    if (!session) {
      throw new UnauthorizedError('Invalid or expired session');
    }

    request.session = session;
    request.userId = session.userId;
  });
});

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  maxAge: number,
  cookieName: string = DEFAULT_COOKIE_NAME,
): void {
  reply.setCookie(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}

export function clearSessionCookie(
  reply: FastifyReply,
  cookieName: string = DEFAULT_COOKIE_NAME,
): void {
  reply.clearCookie(cookieName, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}
