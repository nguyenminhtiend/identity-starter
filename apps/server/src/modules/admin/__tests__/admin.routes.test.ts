import { NotFoundError } from '@identity-starter/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Container } from '../../../core/container-plugin.js';
import { errorHandlerPlugin } from '../../../core/plugins/error-handler.js';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import { makeSession } from '../../session/__tests__/session.factory.js';

const mocks = vi.hoisted(() => ({
  listUsers: vi.fn(),
  getUser: vi.fn(),
  updateUserStatus: vi.fn(),
  listSessions: vi.fn(),
  revokeSession: vi.fn(),
  bulkRevokeSessions: vi.fn(),
  createRole: vi.fn(),
  listRoles: vi.fn(),
  setRolePermissions: vi.fn(),
  assignRole: vi.fn(),
  removeRole: vi.fn(),
}));

vi.mock('../admin.service.js', () => ({
  listUsers: mocks.listUsers,
  getUser: mocks.getUser,
  updateUserStatus: mocks.updateUserStatus,
  listSessions: mocks.listSessions,
  revokeSession: mocks.revokeSession,
  bulkRevokeSessions: mocks.bulkRevokeSessions,
}));

vi.mock('../../rbac/rbac.service.js', () => ({
  createRole: mocks.createRole,
  listRoles: mocks.listRoles,
  setRolePermissions: mocks.setRolePermissions,
  assignRole: mocks.assignRole,
  removeRole: mocks.removeRole,
}));

import { adminRoutes } from '../admin.routes.js';

describe('admin routes', () => {
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

    app.decorate('requirePermission', (_resource: string, _action: string) => {
      return async (request: FastifyRequest) => {
        request.session = mockSession;
        request.userId = mockSession.userId;
      };
    });

    app.decorateRequest('session', null as unknown as typeof mockSession);
    app.decorateRequest('userId', '');

    await app.register(errorHandlerPlugin);
    await app.register(adminRoutes, { prefix: '/api/admin' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }
  });

  const authHeaders = { authorization: 'Bearer test-token' };
  const userId = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
  const roleId = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
  const sessionId = '6ba7b812-9dad-11d1-80b4-00c04fd430c8';

  // --- User Management ---

  describe('GET /api/admin/users', () => {
    it('returns 200 with paginated user list', async () => {
      mocks.listUsers.mockResolvedValue({
        data: [
          {
            id: userId,
            email: 'user@test.com',
            displayName: 'Test User',
            status: 'active',
            createdAt: new Date(),
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/users',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(1);
      expect(body.total).toBe(1);
    });

    it('passes query params to service', async () => {
      mocks.listUsers.mockResolvedValue({
        data: [],
        total: 0,
        page: 2,
        limit: 10,
      });

      await app.inject({
        method: 'GET',
        url: '/api/admin/users?page=2&limit=10&status=suspended&email=test',
        headers: authHeaders,
      });

      expect(mocks.listUsers).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ page: 2, limit: 10, status: 'suspended', email: 'test' }),
      );
    });
  });

  describe('GET /api/admin/users/:id', () => {
    it('returns 200 with user detail and roles', async () => {
      mocks.getUser.mockResolvedValue({
        id: userId,
        email: 'user@test.com',
        emailVerified: true,
        displayName: 'Test User',
        status: 'active',
        createdAt: new Date(),
        roles: [{ id: roleId, name: 'admin' }],
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/admin/users/${userId}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.roles).toHaveLength(1);
      expect(body.roles[0].name).toBe('admin');
    });

    it('returns 404 when not found', async () => {
      mocks.getUser.mockRejectedValue(new NotFoundError('User', userId));

      const response = await app.inject({
        method: 'GET',
        url: `/api/admin/users/${userId}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('PATCH /api/admin/users/:id/status', () => {
    it('returns 200 with updated user', async () => {
      mocks.updateUserStatus.mockResolvedValue({
        id: userId,
        email: 'user@test.com',
        emailVerified: true,
        displayName: 'Test User',
        status: 'suspended',
        createdAt: new Date(),
        roles: [],
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/admin/users/${userId}/status`,
        headers: authHeaders,
        payload: { status: 'suspended' },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.updateUserStatus).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        userId,
        { status: 'suspended' },
        mockSession.userId,
      );
    });

    it('returns 400 on invalid status', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/admin/users/${userId}/status`,
        headers: authHeaders,
        payload: { status: 'deleted' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 404 when user not found', async () => {
      mocks.updateUserStatus.mockRejectedValue(new NotFoundError('User', userId));

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/admin/users/${userId}/status`,
        headers: authHeaders,
        payload: { status: 'active' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // --- Role Management ---

  describe('POST /api/admin/roles', () => {
    it('returns 201 with created role', async () => {
      mocks.createRole.mockResolvedValue({
        id: roleId,
        name: 'editor',
        description: null,
        isSystem: false,
        createdAt: new Date(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/roles',
        headers: authHeaders,
        payload: { name: 'editor' },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.name).toBe('editor');
    });

    it('returns 400 on invalid body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/roles',
        headers: authHeaders,
        payload: { name: '' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/admin/roles', () => {
    it('returns 200 with role list and permission counts', async () => {
      mocks.listRoles.mockResolvedValue([
        {
          id: roleId,
          name: 'admin',
          description: 'System admin role',
          isSystem: true,
          createdAt: new Date(),
          permissionCount: 5,
        },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/roles',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveLength(1);
      expect(body[0].permissionCount).toBe(5);
    });
  });

  describe('PUT /api/admin/roles/:id/permissions', () => {
    it('returns 200 on success', async () => {
      mocks.setRolePermissions.mockResolvedValue(undefined);

      const permissionId = '6ba7b813-9dad-11d1-80b4-00c04fd430c8';
      const response = await app.inject({
        method: 'PUT',
        url: `/api/admin/roles/${roleId}/permissions`,
        headers: authHeaders,
        payload: { permissionIds: [permissionId] },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().message).toBe('Permissions updated');
      expect(mocks.setRolePermissions).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        roleId,
        [permissionId],
      );
    });
  });

  describe('POST /api/admin/users/:id/roles', () => {
    it('returns 201 on success', async () => {
      mocks.assignRole.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: `/api/admin/users/${userId}/roles`,
        headers: authHeaders,
        payload: { roleId },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().message).toBe('Role assigned');
      expect(mocks.assignRole).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        userId,
        roleId,
        mockSession.userId,
      );
    });
  });

  describe('DELETE /api/admin/users/:id/roles/:roleId', () => {
    it('returns 204 on success', async () => {
      mocks.removeRole.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/admin/users/${userId}/roles/${roleId}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(204);
      expect(mocks.removeRole).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        userId,
        roleId,
        mockSession.userId,
      );
    });
  });

  // --- Session Management ---

  describe('GET /api/admin/sessions', () => {
    it('returns 200 with paginated sessions', async () => {
      mocks.listSessions.mockResolvedValue({
        data: [
          {
            id: sessionId,
            userId,
            ipAddress: '127.0.0.1',
            userAgent: 'Mozilla/5.0',
            lastActiveAt: new Date(),
            createdAt: new Date(),
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/sessions',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(1);
      expect(body.total).toBe(1);
    });
  });

  describe('DELETE /api/admin/sessions/:id', () => {
    it('returns 204 on success', async () => {
      mocks.revokeSession.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/admin/sessions/${sessionId}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(204);
      expect(mocks.revokeSession).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        sessionId,
        mockSession.userId,
      );
    });
  });

  describe('DELETE /api/admin/users/:id/sessions', () => {
    it('returns 200 with revoked count', async () => {
      mocks.bulkRevokeSessions.mockResolvedValue({ revoked: 3 });

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/admin/users/${userId}/sessions`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().message).toBe('Revoked 3 sessions');
      expect(mocks.bulkRevokeSessions).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        userId,
        mockSession.userId,
      );
    });
  });
});
