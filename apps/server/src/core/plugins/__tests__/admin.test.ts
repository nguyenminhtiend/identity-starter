import { ForbiddenError } from '@identity-starter/core';
import type { Database } from '@identity-starter/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import type { Container } from '../../container-plugin.js';
import { containerPlugin } from '../../container-plugin.js';
import { adminPlugin } from '../admin.js';
import { errorHandlerPlugin } from '../error-handler.js';

function makeMockDbForAdmin(isAdmin: boolean): Database {
  const limit = vi.fn().mockResolvedValue([{ isAdmin }]);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  return {
    select: vi.fn().mockReturnValue({ from }),
  } as unknown as Database;
}

describe('adminPlugin requireAdmin', () => {
  const userId = '550e8400-e29b-41d4-a716-446655440000';

  describe('when user is not admin', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = Fastify({ logger: false });
      await app.register(containerPlugin, {
        container: {
          db: makeMockDbForAdmin(false),
          eventBus: new InMemoryEventBus(),
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

  describe('when user is admin', () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = Fastify({ logger: false });
      await app.register(containerPlugin, {
        container: {
          db: makeMockDbForAdmin(true),
          eventBus: new InMemoryEventBus(),
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

  describe('session before admin check', () => {
    let app: FastifyInstance;
    const callOrder: string[] = [];

    beforeAll(async () => {
      app = Fastify({ logger: false });

      const limit = vi.fn().mockImplementation(async () => {
        callOrder.push('db');
        return [{ isAdmin: true }];
      });
      const where = vi.fn().mockReturnValue({ limit });
      const from = vi.fn().mockReturnValue({ where });
      const db = {
        select: vi.fn().mockReturnValue({ from }),
      } as unknown as Database;

      await app.register(containerPlugin, {
        container: {
          db,
          eventBus: new InMemoryEventBus(),
        } satisfies Container,
      });

      app.decorateRequest('session', null as unknown as { id: string; userId: string });
      app.decorateRequest('userId', '');

      app.decorate(
        'requireSession',
        vi.fn(async (request: FastifyRequest) => {
          callOrder.push('session');
          request.session = { id: 'sess-1', userId };
          request.userId = userId;
        }),
      );

      await app.register(errorHandlerPlugin);
      await app.register(adminPlugin);
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it('calls requireSession before querying the database', async () => {
      callOrder.length = 0;
      const request = {
        headers: { authorization: 'Bearer t' },
      } as unknown as FastifyRequest;

      await app.requireAdmin(request);

      expect(callOrder).toEqual(['session', 'db']);
      expect(app.requireSession).toHaveBeenCalled();
    });
  });
});
