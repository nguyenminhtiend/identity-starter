import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { userIdParamSchema, userResponseSchema } from './user.schemas.js';
import { createUserService } from './user.service.js';

export const userRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const { db, eventBus } = fastify.container;
  const userService = createUserService({ db, eventBus });

  fastify.addHook('onRequest', fastify.requireSession);

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
