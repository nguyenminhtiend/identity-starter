import type { FastifyPluginAsync } from 'fastify';
import { validate } from '../../core/validate.js';
import type { ChangePasswordInput, LoginInput, RegisterInput } from './auth.schemas.js';
import { changePasswordSchema, loginSchema, registerSchema } from './auth.schemas.js';
import { changePassword, login, logout, register } from './auth.service.js';

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  const { db } = fastify.container;
  const { eventBus } = fastify;

  fastify.post(
    '/register',
    { preHandler: validate({ body: registerSchema }) },
    async (request, reply) => {
      const result = await register(db, eventBus, request.body as RegisterInput);
      return reply.status(201).send(result);
    },
  );

  fastify.post(
    '/login',
    { preHandler: validate({ body: loginSchema }) },
    async (request, reply) => {
      const result = await login(db, eventBus, request.body as LoginInput, {
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
    { preHandler: [fastify.requireSession, validate({ body: changePasswordSchema })] },
    async (request, reply) => {
      await changePassword(db, eventBus, request.userId, request.body as ChangePasswordInput);
      return reply.status(204).send();
    },
  );
};
