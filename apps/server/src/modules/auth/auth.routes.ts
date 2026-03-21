import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  authResponseSchema,
  changePasswordSchema,
  loginSchema,
  registerSchema,
} from './auth.schemas.js';
import { changePassword, login, logout, register } from './auth.service.js';

export const authRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const { db } = fastify.container;
  const { eventBus } = fastify;

  fastify.post(
    '/register',
    {
      schema: {
        body: registerSchema,
        response: { 201: authResponseSchema },
      },
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      const result = await register(db, eventBus, request.body);
      return reply.status(201).send(result);
    },
  );

  fastify.post(
    '/login',
    {
      schema: {
        body: loginSchema,
        response: { 200: authResponseSchema },
      },
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      const result = await login(db, eventBus, request.body, {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });
      return reply.status(200).send(result);
    },
  );

  fastify.post('/logout', { preHandler: fastify.requireSession }, async (request, reply) => {
    await logout(db, eventBus, request.session.id, request.userId);
    return reply.status(204).send();
  });

  fastify.post(
    '/change-password',
    {
      preHandler: fastify.requireSession,
      schema: { body: changePasswordSchema },
    },
    async (request, reply) => {
      await changePassword(db, eventBus, request.userId, request.session.id, request.body);
      return reply.status(204).send();
    },
  );
};
