import { ForbiddenError } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import { createMockDb } from '../../../test/mock-db.js';
import type { Container } from '../../container-plugin.js';
import { containerPlugin } from '../../container-plugin.js';
import { adminPlugin } from '../admin.js';
import { errorHandlerPlugin } from '../error-handler.js';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn<() => Promise<boolean>>(),
}));

vi.mock('../../../modules/rbac/rbac.service.js', () => ({
  hasPermission: mocks.hasPermission,
}));

function makeMockDb(isAdmin: boolean): Database {
  const select = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(isAdmin ? [{ isAdmin: true }] : []),
      }),
    }),
  });
  return createMockDb({ select });
}

describe('adminPlugin requireAdmin', () => {
  const userId = '550e8400-e29b-41d4-a716-446655440000';

  describe('when user has RBAC permission', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      mocks.hasPermission.mockResolvedValue(true);

      app = Fastify({ logger: false });
      await app.register(containerPlugin, {
        container: {
          db: makeMockDb(false),
          eventBus: new InMemoryEventBus(),
          redis: null,
        } satisfies Container,
      });

      app.decorateRequest('session', null as unknown as { id: string; userId: string });
      app.decorateRequest('userId', '');

      app.decorate('requireSession', async (request: FastifyRequest) => {
        request.session = { id: 'sess-1', userId };
        request.userId = userId;
      });

      await app.register(errorHandlerPlugin);
      await app.register(adminPlugin);
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it('resolves without error', async () => {
      const request = {
        headers: { authorization: 'Bearer t' },
      } as unknown as FastifyRequest;

      await expect(app.requireAdmin(request)).resolves.toBeUndefined();
    });
  });

  describe('when user has legacy isAdmin flag', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      mocks.hasPermission.mockResolvedValue(false);

      app = Fastify({ logger: false });
      await app.register(containerPlugin, {
        container: {
          db: makeMockDb(true),
          eventBus: new InMemoryEventBus(),
          redis: null,
        } satisfies Container,
      });

      app.decorateRequest('session', null as unknown as { id: string; userId: string });
      app.decorateRequest('userId', '');

      app.decorate('requireSession', async (request: FastifyRequest) => {
        request.session = { id: 'sess-1', userId };
        request.userId = userId;
      });

      await app.register(errorHandlerPlugin);
      await app.register(adminPlugin);
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it('resolves without error via isAdmin fallback', async () => {
      const request = {
        headers: { authorization: 'Bearer t' },
      } as unknown as FastifyRequest;

      await expect(app.requireAdmin(request)).resolves.toBeUndefined();
    });
  });

  describe('when user has neither RBAC nor isAdmin', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      mocks.hasPermission.mockResolvedValue(false);

      app = Fastify({ logger: false });
      await app.register(containerPlugin, {
        container: {
          db: makeMockDb(false),
          eventBus: new InMemoryEventBus(),
          redis: null,
        } satisfies Container,
      });

      app.decorateRequest('session', null as unknown as { id: string; userId: string });
      app.decorateRequest('userId', '');

      app.decorate('requireSession', async (request: FastifyRequest) => {
        request.session = { id: 'sess-1', userId };
        request.userId = userId;
      });

      await app.register(errorHandlerPlugin);
      await app.register(adminPlugin);
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it('throws ForbiddenError', async () => {
      const request = {
        headers: { authorization: 'Bearer t' },
      } as unknown as FastifyRequest;

      await expect(app.requireAdmin(request)).rejects.toThrow(ForbiddenError);
      await expect(app.requireAdmin(request)).rejects.toThrow('Admin access required');
    });
  });
});
