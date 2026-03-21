import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { createUserSchema, userIdParamSchema, userResponseSchema } from './user.schemas.js';
import { createUser, findUserById } from './user.service.js';

export const userRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const { db } = fastify.container;
  const { eventBus } = fastify;

  fastify.addHook('onRequest', fastify.requireSession);

  fastify.post(
    '/',
    {
      schema: {
        body: createUserSchema,
        response: { 201: userResponseSchema },
      },
    },
    async (request, reply) => {
      const user = await createUser(db, eventBus, request.body);
      return reply.status(201).send(user);
    },
  );

  fastify.get(
    '/:id',
    {
      schema: {
        params: userIdParamSchema,
        response: { 200: userResponseSchema },
      },
    },
    async (request) => {
      return findUserById(db, request.params.id);
    },
  );
};
