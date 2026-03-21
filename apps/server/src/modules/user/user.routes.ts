import { ConflictError } from '@identity-starter/core';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  createUserSchema,
  paginationSchema,
  updateUserSchema,
  userIdParamSchema,
} from './user.schemas.js';
import type { UserService } from './user.service.js';
import type { User } from './user.types.js';

function stripPasswordHash(user: User) {
  const { passwordHash, ...rest } = user;
  return rest;
}

export function registerUserRoutes(app: FastifyInstance, service: UserService) {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.post(
    '/users',
    {
      schema: {
        body: createUserSchema,
      },
    },
    async (request, reply) => {
      const result = await service.create(request.body);
      if (!result.ok) {
        return reply.status(409).send({ error: result.error.message });
      }
      return reply.status(201).send(stripPasswordHash(result.value));
    },
  );

  typedApp.get(
    '/users/:id',
    {
      schema: {
        params: userIdParamSchema,
      },
    },
    async (request, reply) => {
      const result = await service.findById(request.params.id);
      if (!result.ok) {
        return reply.status(404).send({ error: result.error.message });
      }
      return reply.send(stripPasswordHash(result.value));
    },
  );

  typedApp.get(
    '/users',
    {
      schema: {
        querystring: paginationSchema,
      },
    },
    async (request, reply) => {
      const result = await service.list(request.query);
      if (!result.ok) {
        return reply.status(500).send({ error: 'Internal server error' });
      }
      const { data, ...pagination } = result.value;
      return reply.send({
        data: data.map(stripPasswordHash),
        ...pagination,
      });
    },
  );

  typedApp.patch(
    '/users/:id',
    {
      schema: {
        params: userIdParamSchema,
        body: updateUserSchema,
      },
    },
    async (request, reply) => {
      const result = await service.update(request.params.id, request.body);
      if (!result.ok) {
        if (result.error instanceof ConflictError) {
          return reply.status(409).send({ error: result.error.message });
        }
        return reply.status(404).send({ error: result.error.message });
      }
      return reply.send(stripPasswordHash(result.value));
    },
  );

  typedApp.delete(
    '/users/:id',
    {
      schema: {
        params: userIdParamSchema,
      },
    },
    async (request, reply) => {
      const result = await service.delete(request.params.id);
      if (!result.ok) {
        return reply.status(404).send({ error: result.error.message });
      }
      return reply.status(204).send();
    },
  );

  typedApp.post(
    '/users/:id/suspend',
    {
      schema: {
        params: userIdParamSchema,
      },
    },
    async (request, reply) => {
      const result = await service.suspend(request.params.id);
      if (!result.ok) {
        return reply.status(404).send({ error: result.error.message });
      }
      return reply.send({ message: 'User suspended' });
    },
  );

  typedApp.post(
    '/users/:id/activate',
    {
      schema: {
        params: userIdParamSchema,
      },
    },
    async (request, reply) => {
      const result = await service.activate(request.params.id);
      if (!result.ok) {
        return reply.status(404).send({ error: result.error.message });
      }
      return reply.send({ message: 'User activated' });
    },
  );
}
