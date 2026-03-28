import { ForbiddenError } from '@identity-starter/core';
import { users } from '@identity-starter/db';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { hasPermission } from '../../modules/rbac/rbac.service.js';

declare module 'fastify' {
  interface FastifyInstance {
    requireAdmin: (request: FastifyRequest) => Promise<void>;
  }
}

export const adminPlugin = fp(async (fastify) => {
  const { db } = fastify.container;

  fastify.decorate('requireAdmin', async (request: FastifyRequest) => {
    await fastify.requireSession(request);

    const allowed = await hasPermission(db, request.userId, 'admin', 'access');
    if (allowed) {
      return;
    }

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
