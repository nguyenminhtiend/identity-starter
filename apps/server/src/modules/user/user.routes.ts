import type { FastifyPluginAsync } from 'fastify';
import { validate } from '../../infra/validate.js';
import type { CreateUserInput } from './user.schemas.js';
import { createUserSchema, userIdParamSchema } from './user.schemas.js';
import { createUser, findUserById, stripPasswordHash } from './user.service.js';

export const userRoutes: FastifyPluginAsync = async (fastify) => {
  const { db } = fastify.container;
  const { eventBus } = fastify;

  fastify.post(
    '/',
    { preHandler: validate({ body: createUserSchema }) },
    async (request, reply) => {
      const result = await createUser(db, eventBus, request.body as CreateUserInput);
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
      const result = await findUserById(db, id);
      if (!result.ok) {
        return reply.status(404).send({ error: result.error.message });
      }
      return reply.send(stripPasswordHash(result.value));
    },
  );
};
