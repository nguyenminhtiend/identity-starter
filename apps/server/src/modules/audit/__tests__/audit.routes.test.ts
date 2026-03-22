import type { FastifyInstance, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Container } from '../../../core/container-plugin.js';
import { errorHandlerPlugin } from '../../../core/plugins/error-handler.js';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import { makeSession } from '../../session/__tests__/session.factory.js';

const mocks = vi.hoisted(() => ({
  queryAuditLogs: vi.fn(),
  exportAuditLogs: vi.fn(),
}));

vi.mock('../audit.service.js', () => ({
  queryAuditLogs: mocks.queryAuditLogs,
  exportAuditLogs: mocks.exportAuditLogs,
}));

import { auditRoutes } from '../audit.routes.js';

describe('audit routes', () => {
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

    app.decorate('requirePermission', (_resource: string, _action: string) => {
      return async (request: FastifyRequest) => {
        request.session = mockSession;
        request.userId = mockSession.userId;
      };
    });
    app.decorate('requireSession', async (request: FastifyRequest) => {
      request.session = mockSession;
      request.userId = mockSession.userId;
    });
    app.decorateRequest('session', null as unknown as typeof mockSession);
    app.decorateRequest('userId', '');

    await app.register(errorHandlerPlugin);
    await app.register(auditRoutes, { prefix: '/api/admin/audit-logs' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mocks.queryAuditLogs.mockReset();
    mocks.exportAuditLogs.mockReset();
  });

  const authHeaders = { authorization: 'Bearer test-token' };

  describe('GET /api/admin/audit-logs', () => {
    it('returns 200 with paginated audit logs', async () => {
      const now = new Date();
      mocks.queryAuditLogs.mockResolvedValue({
        data: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            actorId: null,
            action: 'auth.login',
            resourceType: 'session',
            resourceId: null,
            details: {},
            ipAddress: null,
            createdAt: now,
            prevHash: null,
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/audit-logs',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.queryAuditLogs).toHaveBeenCalledWith(expect.anything(), expect.anything());
    });

    it('passes query filters to service', async () => {
      mocks.queryAuditLogs.mockResolvedValue({ data: [], total: 0, page: 1, limit: 10 });

      await app.inject({
        method: 'GET',
        url: '/api/admin/audit-logs?page=2&limit=10&action=auth.login',
        headers: authHeaders,
      });

      expect(mocks.queryAuditLogs).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ page: 2, limit: 10, action: 'auth.login' }),
      );
    });
  });

  describe('GET /api/admin/audit-logs/export', () => {
    it('returns 200 with ndjson content type', async () => {
      const now = new Date();
      mocks.exportAuditLogs.mockResolvedValue([
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          actorId: null,
          action: 'auth.login',
          resourceType: 'session',
          resourceId: null,
          details: {},
          ipAddress: null,
          createdAt: now,
          prevHash: null,
        },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/audit-logs/export',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/x-ndjson');
      const lines = response.body.split('\n').filter(Boolean);
      expect(lines).toHaveLength(1);
      expect(() => JSON.parse(lines[0])).not.toThrow();
    });

    it('returns empty body when no logs', async () => {
      mocks.exportAuditLogs.mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/audit-logs/export',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
    });
  });
});
