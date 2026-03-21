import { UnauthorizedError } from '@identity-starter/core';
import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Session } from '../../modules/session/session.schemas.js';
import { validateSession } from '../../modules/session/session.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    session: Session;
    userId: string;
  }

  interface FastifyInstance {
    requireSession: (request: FastifyRequest) => Promise<void>;
  }
}

export const authPlugin = fp(async (fastify) => {
  const { db } = fastify.container;

  fastify.decorateRequest('session', null as unknown as Session);
  fastify.decorateRequest('userId', '');

  fastify.decorate('requireSession', async (request: FastifyRequest) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing or invalid Authorization header');
    }

    const token = authHeader.slice(7);
    const session = await validateSession(db, token);
    if (!session) {
      throw new UnauthorizedError('Invalid or expired session');
    }

    request.session = session;
    request.userId = session.userId;
  });
});
