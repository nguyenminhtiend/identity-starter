import type { FastifyPluginAsync } from 'fastify';
import { validate } from '../../infra/validate.js';
import type { CreateUserInput } from './user.schemas.js';
import { createUserSchema, userIdParamSchema } from './user.schemas.js';
import { createUserService, stripPasswordHash, type UserService } from './user.service.js';

export interface UserRouteOptions {
  service?: UserService;
}

export const userRoutes: FastifyPluginAsync<UserRouteOptions> = async (fastify, opts) => {
  const service = opts.service ?? createUserService(fastify.container.db, fastify.eventBus);

  fastify.post(
    '/',
    { preHandler: validate({ body: createUserSchema }) },
    async (request, reply) => {
      const result = await service.create(request.body as CreateUserInput);
      if (!result.ok) {
        return reply.status(409).send({ error: result.error.message });
      }
      return reply.status(201).send(stripPasswordHash(result.value));
    },
  );

  fastify.get(
    '/:id',
    { preHandler: validate({ params: userIdParamSchema }) },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await service.findById(id);
      if (!result.ok) {
        return reply.status(404).send({ error: result.error.message });
      }
      return reply.send(stripPasswordHash(result.value));
    },
  );
};
