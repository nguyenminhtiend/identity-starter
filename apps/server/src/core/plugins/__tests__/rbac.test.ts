import { ForbiddenError, UnauthorizedError } from '@identity-starter/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import { createMockDb } from '../../../test/mock-db.js';
import type { Container } from '../../container-plugin.js';
import { containerPlugin } from '../../container-plugin.js';
import { errorHandlerPlugin } from '../error-handler.js';
import { rbacPlugin } from '../rbac.js';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
}));

vi.mock('../../../modules/rbac/rbac.service.js', () => ({
  hasPermission: mocks.hasPermission,
}));

describe('rbacPlugin requirePermission', () => {
  const userId = '550e8400-e29b-41d4-a716-446655440000';
  const dummyDb = createMockDb({});

  function bearerRequest(): FastifyRequest {
    return {
      headers: { authorization: 'Bearer t' },
    } as unknown as FastifyRequest;
  }

  describe('when user has matching permission', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      mocks.hasPermission.mockResolvedValue(true);

      app = Fastify({ logger: false });
      await app.register(containerPlugin, {
        container: {
          db: dummyDb,
          eventBus: new InMemoryEventBus(),
          redis: null,
        } satisfies Container,
      });

      app.decorateRequest('session', null as unknown as { id: string; userId: string });
      app.decorateRequest('userId', '');

      app.decorate('requireSession', async (request: FastifyRequest) => {
        const authHeader = request.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
          throw new UnauthorizedError('Missing or invalid Authorization header');
        }
        request.session = { id: 'sess-1', userId };
        request.userId = userId;
      });

      await app.register(errorHandlerPlugin);
      await app.register(rbacPlugin);
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it('allows the request when hasPermission returns true', async () => {
      const request = bearerRequest();
      await expect(app.requirePermission('users', 'read')(request)).resolves.toBeUndefined();
      expect(mocks.hasPermission).toHaveBeenCalledWith(dummyDb, userId, 'users', 'read');
    });
  });

  describe('when user lacks permission', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      mocks.hasPermission.mockResolvedValue(false);

      app = Fastify({ logger: false });
      await app.register(containerPlugin, {
        container: {
          db: dummyDb,
          eventBus: new InMemoryEventBus(),
          redis: null,
        } satisfies Container,
      });

      app.decorateRequest('session', null as unknown as { id: string; userId: string });
      app.decorateRequest('userId', '');

      app.decorate('requireSession', async (request: FastifyRequest) => {
        const authHeader = request.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
          throw new UnauthorizedError('Missing or invalid Authorization header');
        }
        request.session = { id: 'sess-1', userId };
        request.userId = userId;
      });

      await app.register(errorHandlerPlugin);
      await app.register(rbacPlugin);
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it('throws ForbiddenError', async () => {
      const request = bearerRequest();
      await expect(app.requirePermission('users', 'read')(request)).rejects.toThrow(ForbiddenError);
      await expect(app.requirePermission('users', 'read')(request)).rejects.toThrow(
        'Missing permission: users:read',
      );
    });
  });

  describe('when requireSession rejects (no Bearer token)', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      mocks.hasPermission.mockResolvedValue(true);

      app = Fastify({ logger: false });
      await app.register(containerPlugin, {
        container: {
          db: dummyDb,
          eventBus: new InMemoryEventBus(),
          redis: null,
        } satisfies Container,
      });

      app.decorateRequest('session', null as unknown as { id: string; userId: string });
      app.decorateRequest('userId', '');

      app.decorate('requireSession', async (request: FastifyRequest) => {
        const authHeader = request.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
          throw new UnauthorizedError('Missing or invalid Authorization header');
        }
        request.session = { id: 'sess-1', userId };
        request.userId = userId;
      });

      await app.register(errorHandlerPlugin);
      await app.register(rbacPlugin);
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it('throws UnauthorizedError and does not call hasPermission', async () => {
      const request = { headers: {} } as unknown as FastifyRequest;
      mocks.hasPermission.mockClear();

      await expect(app.requirePermission('users', 'read')(request)).rejects.toThrow(
        UnauthorizedError,
      );
      expect(mocks.hasPermission).not.toHaveBeenCalled();
    });
  });

  describe('when user is super_admin (hasPermission allows any resource)', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      mocks.hasPermission.mockResolvedValue(true);

      app = Fastify({ logger: false });
      await app.register(containerPlugin, {
        container: {
          db: dummyDb,
          eventBus: new InMemoryEventBus(),
          redis: null,
        } satisfies Container,
      });

      app.decorateRequest('session', null as unknown as { id: string; userId: string });
      app.decorateRequest('userId', '');

      app.decorate('requireSession', async (request: FastifyRequest) => {
        const authHeader = request.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
          throw new UnauthorizedError('Missing or invalid Authorization header');
        }
        request.session = { id: 'sess-1', userId };
        request.userId = userId;
      });

      await app.register(errorHandlerPlugin);
      await app.register(rbacPlugin);
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it('allows arbitrary resource:action', async () => {
      const request = bearerRequest();
      await expect(app.requirePermission('anything', 'anything')(request)).resolves.toBeUndefined();
      expect(mocks.hasPermission).toHaveBeenCalledWith(dummyDb, userId, 'anything', 'anything');
    });
  });
});
