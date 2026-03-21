import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { createUserSchema, userIdParamSchema, userResponseSchema } from './user.schemas.js';
import { createUserService } from './user.service.js';

export const userRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const { db, eventBus } = fastify.container;
  const userService = createUserService({ db, eventBus });

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
      const user = await userService.create(request.body);
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
      return userService.findById(request.params.id);
    },
  );
};
