import { NotFoundError } from '@identity-starter/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Container } from '../../../core/container-plugin.js';
import { errorHandlerPlugin } from '../../../core/plugins/error-handler.js';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import { makeSession } from '../../session/__tests__/session.factory.js';
import { makeUser } from './user.factory.js';

const mockFindUserById = vi.fn();

vi.mock('../user.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../user.service.js')>();
  return {
    ...actual,
    createUserService: vi.fn(() => ({
      findById: mockFindUserById,
    })),
  };
});

import { userRoutes } from '../user.routes.js';

describe('user routes', () => {
  let app: FastifyInstance;
  const mockSession = makeSession();

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    app.decorate('container', {
      db: {} as unknown as Container['db'],
      eventBus: new InMemoryEventBus(),
    });

    app.decorate('requireSession', async (request: FastifyRequest) => {
      request.session = mockSession;
      request.userId = mockSession.userId;
    });
    app.decorateRequest('session', null as unknown as typeof mockSession);
    app.decorateRequest('userId', '');

    await app.register(errorHandlerPlugin);
    await app.register(userRoutes, { prefix: '/api/users' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockFindUserById.mockReset();
  });

  describe('GET /api/users/:id', () => {
    const validId = '550e8400-e29b-41d4-a716-446655440000';

    it('returns 200 with user on success', async () => {
      const user = makeUser({ id: validId });
      mockFindUserById.mockResolvedValue(user);

      const response = await app.inject({
        method: 'GET',
        url: `/api/users/${validId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe(validId);
      expect(body).not.toHaveProperty('passwordHash');
    });

    it('returns 404 when user not found', async () => {
      mockFindUserById.mockRejectedValue(new NotFoundError('User', validId));

      const response = await app.inject({
        method: 'GET',
        url: `/api/users/${validId}`,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toHaveProperty('error');
    });

    it('returns 400 on invalid UUID', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/users/not-a-uuid',
      });

      expect(response.statusCode).toBe(400);
    });

    it('calls userService.findById with parsed id', async () => {
      const user = makeUser({ id: validId });
      mockFindUserById.mockResolvedValue(user);

      await app.inject({
        method: 'GET',
        url: `/api/users/${validId}`,
      });

      expect(mockFindUserById).toHaveBeenCalledWith(validId);
    });
  });
});
