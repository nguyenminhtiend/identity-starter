import { ConflictError, NotFoundError } from '@identity-starter/core';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandlerPlugin } from '../../../core/plugins/error-handler.js';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import { makeUser } from '../../../test/factory.js';

vi.mock('../user.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../user.service.js')>();
  return {
    ...actual,
    createUser: vi.fn(),
    findUserById: vi.fn(),
  };
});

import { userRoutes } from '../user.routes.js';
import { createUser, findUserById } from '../user.service.js';

describe('user routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    app.decorate('container', { db: {} });
    app.decorate('eventBus', new InMemoryEventBus());

    await app.register(errorHandlerPlugin);
    await app.register(userRoutes, { prefix: '/api/users' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.mocked(createUser).mockReset();
    vi.mocked(findUserById).mockReset();
  });

  describe('POST /api/users', () => {
    const validBody = {
      email: 'test@example.com',
      displayName: 'Test User',
    };

    it('returns 201 with created user on success', async () => {
      const user = makeUser({ email: 'test@example.com', displayName: 'Test User' });
      vi.mocked(createUser).mockResolvedValue(user);

      const response = await app.inject({
        method: 'POST',
        url: '/api/users',
        payload: validBody,
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.email).toBe('test@example.com');
      expect(body.displayName).toBe('Test User');
      expect(body).not.toHaveProperty('passwordHash');
    });

    it('returns 409 on duplicate email', async () => {
      vi.mocked(createUser).mockRejectedValue(
        new ConflictError('User', 'email', 'test@example.com'),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/users',
        payload: validBody,
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toHaveProperty('error');
    });

    it('returns 400 on missing email', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/users',
        payload: { displayName: 'Test' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 on invalid email format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/users',
        payload: { ...validBody, email: 'not-an-email' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 on missing displayName', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/users',
        payload: { email: 'test@example.com' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 on empty displayName', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/users',
        payload: { ...validBody, displayName: '' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('calls createUser with db, eventBus, and parsed input', async () => {
      const user = makeUser();
      vi.mocked(createUser).mockResolvedValue(user);

      await app.inject({
        method: 'POST',
        url: '/api/users',
        payload: validBody,
      });

      expect(createUser).toHaveBeenCalledWith(
        expect.anything(), // db
        expect.anything(), // eventBus
        expect.objectContaining({
          email: 'test@example.com',
          displayName: 'Test User',
        }),
      );
    });
  });

  describe('GET /api/users/:id', () => {
    const validId = '550e8400-e29b-41d4-a716-446655440000';

    it('returns 200 with user on success', async () => {
      const user = makeUser({ id: validId });
      vi.mocked(findUserById).mockResolvedValue(user);

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
      vi.mocked(findUserById).mockRejectedValue(new NotFoundError('User', validId));

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

    it('calls findUserById with db and parsed id', async () => {
      const user = makeUser({ id: validId });
      vi.mocked(findUserById).mockResolvedValue(user);

      await app.inject({
        method: 'GET',
        url: `/api/users/${validId}`,
      });

      expect(findUserById).toHaveBeenCalledWith(
        expect.anything(), // db
        validId,
      );
    });
  });
});
