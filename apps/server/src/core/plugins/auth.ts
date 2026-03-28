import { UnauthorizedError } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

const DEFAULT_COOKIE_NAME = 'session';

const VALID_COOKIE_NAMES = new Set([DEFAULT_COOKIE_NAME, 'admin_session']);

export interface SessionLike {
  id: string;
  userId: string;
}

export type ValidateSessionFn = (db: Database, token: string) => Promise<SessionLike | null>;

export interface AuthPluginOptions {
  validateSession: ValidateSessionFn;
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

export function getSessionCookieName(request: FastifyRequest): string {
  const header = request.headers['x-session-cookie'];
  if (typeof header === 'string' && VALID_COOKIE_NAMES.has(header)) {
    return header;
  }
  return DEFAULT_COOKIE_NAME;
}

export const authPlugin = fp(async (fastify, opts: AuthPluginOptions) => {
  const { db } = fastify.container;

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
