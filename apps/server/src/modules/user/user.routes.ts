import type { FastifyPluginAsync } from 'fastify';
import { UserRepository } from './user.repository.js';
import {
  createUserSchema,
  paginationSchema,
  updateUserSchema,
  userIdParamSchema,
} from './user.schemas.js';
import { UserService } from './user.service.js';
import type { User } from './user.types.js';

function stripPasswordHash(user: User) {
  const { passwordHash, ...rest } = user;
  return rest;
}

export interface UserRouteOptions {
  service?: UserService;
}

export const userRoutes: FastifyPluginAsync<UserRouteOptions> = async (fastify, opts) => {
  const service =
    opts.service ?? new UserService(new UserRepository(fastify.container.db), fastify.eventBus);

  fastify.post('/', { schema: { body: createUserSchema } }, async (request, reply) => {
    const data = createUserSchema.parse(request.body);
    const result = await service.create(data);
    if (!result.ok) {
      return reply.status(409).send({ error: result.error.message });
    }
    return reply.status(201).send(stripPasswordHash(result.value));
  });

  fastify.get('/:id', { schema: { params: userIdParamSchema } }, async (request, reply) => {
    const { id } = userIdParamSchema.parse(request.params);
    const result = await service.findById(id);
    if (!result.ok) {
      return reply.status(404).send({ error: result.error.message });
    }
    return reply.send(stripPasswordHash(result.value));
  });

  fastify.get('/', { schema: { querystring: paginationSchema } }, async (request, reply) => {
    const query = paginationSchema.parse(request.query);
    const result = await service.list(query);
    if (!result.ok) {
      return reply.status(500).send({ error: 'Internal server error' });
    }
    const { data, ...pagination } = result.value;
    return reply.send({
      data: data.map(stripPasswordHash),
      ...pagination,
    });
  });

  fastify.patch(
    '/:id',
    { schema: { params: userIdParamSchema, body: updateUserSchema } },
    async (request, reply) => {
      const { id } = userIdParamSchema.parse(request.params);
      const data = updateUserSchema.parse(request.body);
      const result = await service.update(id, data);
      if (!result.ok) {
        const status = result.error.code === 'CONFLICT' ? 409 : 404;
        return reply.status(status).send({ error: result.error.message });
      }
      return reply.send(stripPasswordHash(result.value));
    },
  );

  fastify.delete('/:id', { schema: { params: userIdParamSchema } }, async (request, reply) => {
    const { id } = userIdParamSchema.parse(request.params);
    const result = await service.delete(id);
    if (!result.ok) {
      return reply.status(404).send({ error: result.error.message });
    }
    return reply.status(204).send();
  });

  fastify.post(
    '/:id/suspend',
    { schema: { params: userIdParamSchema } },
    async (request, reply) => {
      const { id } = userIdParamSchema.parse(request.params);
      const result = await service.suspend(id);
      if (!result.ok) {
        return reply.status(404).send({ error: result.error.message });
      }
      return reply.send({ message: 'User suspended' });
    },
  );

  fastify.post(
    '/:id/activate',
    { schema: { params: userIdParamSchema } },
    async (request, reply) => {
      const { id } = userIdParamSchema.parse(request.params);
      const result = await service.activate(id);
      if (!result.ok) {
        return reply.status(404).send({ error: result.error.message });
      }
      return reply.send({ message: 'User activated' });
    },
  );
};
