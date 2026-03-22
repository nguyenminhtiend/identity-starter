import { ForbiddenError } from '@identity-starter/core';
import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { hasPermission } from '../../modules/rbac/rbac.service.js';

declare module 'fastify' {
  interface FastifyInstance {
    requirePermission: (
      resource: string,
      action: string,
    ) => (request: FastifyRequest) => Promise<void>;
  }
}

export const rbacPlugin = fp(async (fastify) => {
  const { db } = fastify.container;

  fastify.decorate(
    'requirePermission',
    (resource: string, action: string) => async (request: FastifyRequest) => {
      await fastify.requireSession(request);

      const allowed = await hasPermission(db, request.userId, resource, action);
      if (!allowed) {
        throw new ForbiddenError(`Missing permission: ${resource}:${action}`);
      }
    },
  );
});
