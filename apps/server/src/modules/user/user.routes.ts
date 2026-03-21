import type { FastifyPluginAsync } from 'fastify';
import { validate } from '../../core/validate.js';
import type { CreateUserInput } from './user.schemas.js';
import { createUserSchema, userIdParamSchema } from './user.schemas.js';
import { createUser, findUserById } from './user.service.js';

export const userRoutes: FastifyPluginAsync = async (fastify) => {
  const { db } = fastify.container;
  const { eventBus } = fastify;

  fastify.post(
    '/',
    { preHandler: validate({ body: createUserSchema }) },
    async (request, reply) => {
      const user = await createUser(db, eventBus, request.body as CreateUserInput);
      return reply.status(201).send(user);
    },
  );

  fastify.get('/:id', { preHandler: validate({ params: userIdParamSchema }) }, async (request) => {
    const { id } = request.params as { id: string };
    return findUserById(db, id);
  });
};
