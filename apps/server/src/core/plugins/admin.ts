import { ForbiddenError } from '@identity-starter/core';
import { users } from '@identity-starter/db';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyInstance {
    requireAdmin: (request: FastifyRequest) => Promise<void>;
  }
}

export const adminPlugin = fp(async (fastify) => {
  const { db } = fastify.container;

  fastify.decorate('requireAdmin', async (request: FastifyRequest) => {
    await fastify.requireSession(request);

    const [user] = await db
      .select({ isAdmin: users.isAdmin })
      .from(users)
      .where(eq(users.id, request.userId))
      .limit(1);

    if (!user?.isAdmin) {
      throw new ForbiddenError('Admin access required');
    }
  });
});
