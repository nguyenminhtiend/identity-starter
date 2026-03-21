import { UnauthorizedError } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

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

export const authPlugin = fp(async (fastify, opts: AuthPluginOptions) => {
  const { db } = fastify.container;

  fastify.decorateRequest('session', null as unknown as SessionLike);
  fastify.decorateRequest('userId', '');

  fastify.decorate('requireSession', async (request: FastifyRequest) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or invalid Authorization header');
    }

    const rawToken = authHeader.slice(7);
    const session = await opts.validateSession(db, rawToken);
    if (!session) {
      throw new UnauthorizedError('Invalid or expired session');
    }

    request.session = session;
    request.userId = session.userId;
  });
});
