import { ForbiddenError, NotFoundError, UnauthorizedError } from '@identity-starter/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Container } from '../../../core/container-plugin.js';
import { errorHandlerPlugin } from '../../../core/plugins/error-handler.js';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import { makeSession } from '../../session/__tests__/session.factory.js';
import { buildCreateClientInput } from './client.factory.js';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  listClients: vi.fn(),
  getClient: vi.fn(),
  updateClient: vi.fn(),
  deleteClient: vi.fn(),
  rotateSecret: vi.fn(),
}));

vi.mock('../client.service.js', () => ({
  createClient: mocks.createClient,
  listClients: mocks.listClients,
  getClient: mocks.getClient,
  updateClient: mocks.updateClient,
  deleteClient: mocks.deleteClient,
  rotateSecret: mocks.rotateSecret,
}));

import { clientRoutes } from '../client.routes.js';

function sampleClient(overrides: Record<string, unknown> = {}) {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    clientId: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d',
    clientName: 'Test App',
    description: null,
    redirectUris: ['https://example.com/callback'],
    grantTypes: ['authorization_code'] as const,
    responseTypes: ['code'] as const,
    scope: 'openid profile',
    tokenEndpointAuthMethod: 'client_secret_basic' as const,
    isConfidential: true,
    isFirstParty: false,
    logoUri: null,
    tosUri: null,
    policyUri: null,
    applicationType: 'web' as const,
    status: 'active' as const,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

describe('client routes', () => {
  let app: FastifyInstance;
  const mockSession = makeSession();
  const hookState = { mode: 'ok' as 'ok' | '401' | '403' };

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    app.decorate('container', {
      db: {} as unknown as Container['db'],
      eventBus: new InMemoryEventBus(),
    });

    app.decorateRequest('session', null as unknown as typeof mockSession);
    app.decorateRequest('userId', '');

    app.decorate('requireAdmin', async (request: FastifyRequest) => {
      if (hookState.mode === '401') {
        throw new UnauthorizedError('Missing session');
      }
      if (hookState.mode === '403') {
        throw new ForbiddenError('Admin access required');
      }
      request.session = mockSession;
      request.userId = mockSession.userId;
    });

    await app.register(errorHandlerPlugin);
    await app.register(clientRoutes, { prefix: '/api/admin/clients' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    hookState.mode = 'ok';
    mocks.createClient.mockReset();
    mocks.listClients.mockReset();
    mocks.getClient.mockReset();
    mocks.updateClient.mockReset();
    mocks.deleteClient.mockReset();
    mocks.rotateSecret.mockReset();
  });

  const authHeaders = { authorization: 'Bearer test-token' };

  describe('POST /api/admin/clients', () => {
    it('returns 201 with client and secret', async () => {
      const body = buildCreateClientInput();
      const created = {
        ...sampleClient({ clientName: body.clientName }),
        clientSecret: 'plain-secret',
      };
      mocks.createClient.mockResolvedValue(created);

      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/clients',
        headers: authHeaders,
        payload: body,
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.clientSecret).toBe('plain-secret');
      expect(json.clientName).toBe(body.clientName);
      expect(mocks.createClient).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ clientName: body.clientName }),
      );
    });

    it('returns 401 when requireAdmin rejects', async () => {
      hookState.mode = '401';
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/clients',
        headers: authHeaders,
        payload: buildCreateClientInput(),
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 403 when not admin', async () => {
      hookState.mode = '403';
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/clients',
        headers: authHeaders,
        payload: buildCreateClientInput(),
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('GET /api/admin/clients', () => {
    it('returns 200 with client array', async () => {
      const list = [sampleClient()];
      mocks.listClients.mockResolvedValue(list);

      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/clients',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveLength(1);
      expect(mocks.listClients).toHaveBeenCalledWith(expect.anything());
    });

    it('returns 401 without admin', async () => {
      hookState.mode = '401';
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/clients',
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 403 without admin flag', async () => {
      hookState.mode = '403';
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/clients',
        headers: authHeaders,
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('GET /api/admin/clients/:id', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';

    it('returns 200 with client', async () => {
      const client = sampleClient({ id });
      mocks.getClient.mockResolvedValue(client);

      const response = await app.inject({
        method: 'GET',
        url: `/api/admin/clients/${id}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe(id);
      expect(mocks.getClient).toHaveBeenCalledWith(expect.anything(), id);
    });

    it('returns 404 when missing', async () => {
      mocks.getClient.mockRejectedValue(new NotFoundError('Client', id));

      const response = await app.inject({
        method: 'GET',
        url: `/api/admin/clients/${id}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 401 without session', async () => {
      hookState.mode = '401';
      const response = await app.inject({
        method: 'GET',
        url: `/api/admin/clients/${id}`,
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 403 without admin', async () => {
      hookState.mode = '403';
      const response = await app.inject({
        method: 'GET',
        url: `/api/admin/clients/${id}`,
        headers: authHeaders,
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('PATCH /api/admin/clients/:id', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';

    it('returns 200 with updated client', async () => {
      const updated = sampleClient({ id, clientName: 'Patched' });
      mocks.updateClient.mockResolvedValue(updated);

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/admin/clients/${id}`,
        headers: authHeaders,
        payload: { clientName: 'Patched' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().clientName).toBe('Patched');
      expect(mocks.updateClient).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        id,
        expect.objectContaining({ clientName: 'Patched' }),
      );
    });

    it('returns 401 without session', async () => {
      hookState.mode = '401';
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/admin/clients/${id}`,
        payload: { clientName: 'X' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 403 without admin', async () => {
      hookState.mode = '403';
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/admin/clients/${id}`,
        headers: authHeaders,
        payload: { clientName: 'X' },
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('DELETE /api/admin/clients/:id', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';

    it('returns 204', async () => {
      mocks.deleteClient.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/admin/clients/${id}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(204);
      expect(mocks.deleteClient).toHaveBeenCalledWith(expect.anything(), expect.anything(), id);
    });

    it('returns 401 without session', async () => {
      hookState.mode = '401';
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/admin/clients/${id}`,
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 403 without admin', async () => {
      hookState.mode = '403';
      const response = await app.inject({
        method: 'DELETE',
        url: `/api/admin/clients/${id}`,
        headers: authHeaders,
      });
      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /api/admin/clients/:id/rotate-secret', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000';

    it('returns 200 with new secret', async () => {
      mocks.rotateSecret.mockResolvedValue({ clientSecret: 'new-secret' });

      const response = await app.inject({
        method: 'POST',
        url: `/api/admin/clients/${id}/rotate-secret`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().clientSecret).toBe('new-secret');
      expect(mocks.rotateSecret).toHaveBeenCalledWith(expect.anything(), expect.anything(), id);
    });

    it('returns 401 without session', async () => {
      hookState.mode = '401';
      const response = await app.inject({
        method: 'POST',
        url: `/api/admin/clients/${id}/rotate-secret`,
      });
      expect(response.statusCode).toBe(401);
    });

    it('returns 403 without admin', async () => {
      hookState.mode = '403';
      const response = await app.inject({
        method: 'POST',
        url: `/api/admin/clients/${id}/rotate-secret`,
        headers: authHeaders,
      });
      expect(response.statusCode).toBe(403);
    });
  });
});
