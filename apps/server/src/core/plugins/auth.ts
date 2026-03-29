import { UnauthorizedError } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

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

export const authPlugin = fp(async (fastify, opts: AuthPluginOptions) => {
  const { db } = fastify.container;
  const signingKeyService = createSigningKeyService({ db });
  const jwtIssuer = opts.jwtIssuer;

  fastify.decorateRequest('session', null as unknown as SessionLike);
  fastify.decorateRequest('userId', '');

  fastify.decorate('requireSession', async (request: FastifyRequest) => {
    let rawToken: string | undefined;

    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      rawToken = authHeader.slice(7);
    } else {
      const cookieName = getSessionCookieName(request);
      const cookieValue = request.cookies?.[cookieName];
      if (cookieValue) {
        rawToken = cookieValue;
      }
    }

    if (!rawToken) {
      throw new UnauthorizedError('Missing or invalid authentication credentials');
    }

    if (jwtIssuer && looksLikeJwt(rawToken)) {
      const jwks = await signingKeyService.getJwks();
      const { createLocalJWKSet } = await import('jose');
      const localJwks = createLocalJWKSet(jwks);
      const result = await verifyAccessToken(localJwks, rawToken, jwtIssuer);

      if (result) {
        const sub = result.payload.sub;
        if (typeof sub === 'string' && sub !== '') {
          request.session = { id: `jwt:${result.payload.jti ?? sub}`, userId: sub };
          request.userId = sub;
          return;
        }
      }
    }

    const session = await opts.validateSession(db, rawToken);
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
