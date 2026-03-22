import { NotFoundError, ValidationError } from '@identity-starter/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Container } from '../../../core/container-plugin.js';
import { errorHandlerPlugin } from '../../../core/plugins/error-handler.js';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import { makeSession } from '../../session/__tests__/session.factory.js';
import { makeRenamePasskeyInput, makeUpdateProfileInput } from './account.factory.js';

const mocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  listSessions: vi.fn(),
  revokeOwnSession: vi.fn(),
  listPasskeys: vi.fn(),
  renamePasskey: vi.fn(),
  deletePasskey: vi.fn(),
}));

vi.mock('../account.service.js', () => ({
  getProfile: mocks.getProfile,
  updateProfile: mocks.updateProfile,
  listSessions: mocks.listSessions,
  revokeOwnSession: mocks.revokeOwnSession,
  listPasskeys: mocks.listPasskeys,
  renamePasskey: mocks.renamePasskey,
  deletePasskey: mocks.deletePasskey,
}));

import { accountRoutes } from '../account.routes.js';

describe('account routes', () => {
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
    await app.register(accountRoutes, { prefix: '/api/account' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mocks.getProfile.mockReset();
    mocks.updateProfile.mockReset();
    mocks.listSessions.mockReset();
    mocks.revokeOwnSession.mockReset();
    mocks.listPasskeys.mockReset();
    mocks.renamePasskey.mockReset();
    mocks.deletePasskey.mockReset();
  });

  const authHeaders = { authorization: 'Bearer test-token' };

  describe('GET /api/account/profile', () => {
    it('returns 200 with profile', async () => {
      const profile = {
        id: mockSession.userId,
        email: 'x@y.com',
        emailVerified: false,
        displayName: 'X',
        status: 'active' as const,
        metadata: {},
        createdAt: new Date().toISOString(),
      };
      mocks.getProfile.mockResolvedValue({
        ...profile,
        createdAt: new Date(profile.createdAt),
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/account/profile',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.getProfile).toHaveBeenCalledWith(expect.anything(), mockSession.userId);
    });

    it('returns 404 when profile missing', async () => {
      mocks.getProfile.mockRejectedValue(new NotFoundError('User', mockSession.userId));

      const response = await app.inject({
        method: 'GET',
        url: '/api/account/profile',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('PATCH /api/account/profile', () => {
    it('returns 200 with updated profile', async () => {
      const body = makeUpdateProfileInput({ displayName: 'New' });
      const updated = {
        id: mockSession.userId,
        email: 'x@y.com',
        emailVerified: true,
        displayName: 'New',
        status: 'active' as const,
        metadata: {},
        createdAt: new Date(),
      };
      mocks.updateProfile.mockResolvedValue(updated);

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/account/profile',
        headers: authHeaders,
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.updateProfile).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        mockSession.userId,
        expect.objectContaining({ displayName: 'New' }),
      );
    });

    it('returns 400 on invalid body', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/account/profile',
        headers: authHeaders,
        payload: { displayName: '' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/account/sessions', () => {
    it('returns 200 with session list', async () => {
      mocks.listSessions.mockResolvedValue([
        {
          id: mockSession.id,
          ipAddress: null,
          userAgent: null,
          lastActiveAt: new Date(),
          createdAt: new Date(),
          isCurrent: true,
        },
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/account/sessions',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.listSessions).toHaveBeenCalledWith(
        expect.anything(),
        mockSession.userId,
        mockSession.id,
      );
    });
  });

  describe('DELETE /api/account/sessions/:id', () => {
    const otherId = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

    it('returns 204 on success', async () => {
      mocks.revokeOwnSession.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/account/sessions/${otherId}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(204);
      expect(mocks.revokeOwnSession).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        mockSession.userId,
        otherId,
        mockSession.id,
      );
    });

    it('returns 400 when revoking current session', async () => {
      mocks.revokeOwnSession.mockRejectedValue(
        new ValidationError('Cannot revoke current session'),
      );

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/account/sessions/${mockSession.id}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/account/passkeys', () => {
    it('returns 200', async () => {
      mocks.listPasskeys.mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/api/account/passkeys',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.listPasskeys).toHaveBeenCalledWith(expect.anything(), mockSession.userId);
    });
  });

  describe('PATCH /api/account/passkeys/:id', () => {
    const pkId = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

    it('returns 200 with renamed passkey', async () => {
      const renamed = {
        id: pkId,
        credentialId: 'c',
        deviceType: 'singleDevice',
        backedUp: false,
        name: 'Work',
        aaguid: null,
        createdAt: new Date(),
      };
      mocks.renamePasskey.mockResolvedValue(renamed);

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/account/passkeys/${pkId}`,
        headers: authHeaders,
        payload: makeRenamePasskeyInput({ name: 'Work' }),
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.renamePasskey).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        mockSession.userId,
        pkId,
        'Work',
      );
    });
  });

  describe('DELETE /api/account/passkeys/:id', () => {
    const pkId = '6ba7b812-9dad-11d1-80b4-00c04fd430c8';

    it('returns 204', async () => {
      mocks.deletePasskey.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/account/passkeys/${pkId}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(204);
      expect(mocks.deletePasskey).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        mockSession.userId,
        pkId,
      );
    });
  });
});
