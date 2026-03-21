import { ConflictError, UnauthorizedError } from '@identity-starter/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Container } from '../../../core/container-plugin.js';
import { errorHandlerPlugin } from '../../../core/plugins/error-handler.js';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import { makeSession } from '../../session/__tests__/session.factory.js';

vi.mock('../auth.service.js', () => ({
  register: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  changePassword: vi.fn(),
}));

import { authRoutes } from '../auth.routes.js';
import { changePassword, login, logout, register } from '../auth.service.js';

describe('auth routes', () => {
  let app: FastifyInstance;
  const mockSession = makeSession({ userId: '550e8400-e29b-41d4-a716-446655440001' });

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    app.decorate('container', { db: {} as unknown as Container['db'] });
    app.decorate('eventBus', new InMemoryEventBus());

    app.decorate('requireSession', async (request: FastifyRequest) => {
      request.session = mockSession;
      request.userId = mockSession.userId;
    });
    app.decorateRequest('session', null as unknown as typeof mockSession);
    app.decorateRequest('userId', '');

    await app.register(errorHandlerPlugin);
    await app.register(authRoutes, { prefix: '/api/auth' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.mocked(register).mockReset();
    vi.mocked(login).mockReset();
    vi.mocked(logout).mockReset();
    vi.mocked(changePassword).mockReset();
  });

  describe('POST /api/auth/register', () => {
    const validBody = {
      email: 'new@example.com',
      password: 'securepass123',
      displayName: 'New User',
    };

    it('returns 201 with token and user on success', async () => {
      const authResponse = {
        token: 'session-token',
        user: {
          id: 'user-1',
          email: 'new@example.com',
          displayName: 'New User',
          status: 'pending_verification',
        },
      };
      vi.mocked(register).mockResolvedValue(authResponse);

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: validBody,
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.token).toBe('session-token');
      expect(body.user.email).toBe('new@example.com');
      expect(body.user).not.toHaveProperty('passwordHash');
    });

    it('returns 409 on duplicate email', async () => {
      vi.mocked(register).mockRejectedValue(new ConflictError('User', 'email', 'new@example.com'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: validBody,
      });

      expect(response.statusCode).toBe(409);
    });

    it('returns 400 on missing email', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { password: 'securepass123', displayName: 'Test' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 on invalid email format', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { ...validBody, email: 'bad' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 on short password', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { ...validBody, password: 'short' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 on missing displayName', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email: 'test@example.com', password: 'securepass123' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('calls register with db, eventBus, and parsed input', async () => {
      const authResponse = {
        token: 'tok',
        user: { id: '1', email: 'new@example.com', displayName: 'New User', status: 'active' },
      };
      vi.mocked(register).mockResolvedValue(authResponse);

      await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: validBody,
      });

      expect(register).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          email: 'new@example.com',
          password: 'securepass123',
          displayName: 'New User',
        }),
      );
    });
  });

  describe('POST /api/auth/login', () => {
    const validBody = {
      email: 'user@example.com',
      password: 'securepass123',
    };

    it('returns 200 with token and user on success', async () => {
      const authResponse = {
        token: 'login-token',
        user: { id: 'user-1', email: 'user@example.com', displayName: 'User', status: 'active' },
      };
      vi.mocked(login).mockResolvedValue(authResponse);

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: validBody,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.token).toBe('login-token');
      expect(body.user.email).toBe('user@example.com');
    });

    it('returns 401 on invalid credentials', async () => {
      vi.mocked(login).mockRejectedValue(new UnauthorizedError('Invalid email or password'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: validBody,
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 on missing email', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { password: 'securepass123' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 on missing password', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'user@example.com' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('calls login with db, eventBus, input, and meta', async () => {
      const authResponse = {
        token: 'tok',
        user: { id: '1', email: 'user@example.com', displayName: 'User', status: 'active' },
      };
      vi.mocked(login).mockResolvedValue(authResponse);

      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: validBody,
      });

      expect(login).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ email: 'user@example.com', password: 'securepass123' }),
        expect.objectContaining({ ipAddress: expect.any(String) }),
      );
    });
  });

  describe('POST /api/auth/logout', () => {
    it('returns 204 on success', async () => {
      vi.mocked(logout).mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(204);
    });

    it('calls logout with db, eventBus, sessionId, and userId', async () => {
      vi.mocked(logout).mockResolvedValue(undefined);

      await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(logout).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        mockSession.id,
        mockSession.userId,
      );
    });
  });

  describe('POST /api/auth/change-password', () => {
    const validBody = {
      currentPassword: 'oldpassword1',
      newPassword: 'newpassword1',
    };

    it('returns 204 on success', async () => {
      vi.mocked(changePassword).mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/change-password',
        headers: { authorization: 'Bearer valid-token' },
        payload: validBody,
      });

      expect(response.statusCode).toBe(204);
    });

    it('returns 401 on wrong current password', async () => {
      vi.mocked(changePassword).mockRejectedValue(
        new UnauthorizedError('Current password is incorrect'),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/change-password',
        headers: { authorization: 'Bearer valid-token' },
        payload: validBody,
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 on missing currentPassword', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/change-password',
        headers: { authorization: 'Bearer valid-token' },
        payload: { newPassword: 'newpassword1' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 400 on short newPassword', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/change-password',
        headers: { authorization: 'Bearer valid-token' },
        payload: { currentPassword: 'oldpassword1', newPassword: 'short' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('calls changePassword with db, eventBus, userId, and input', async () => {
      vi.mocked(changePassword).mockResolvedValue(undefined);

      await app.inject({
        method: 'POST',
        url: '/api/auth/change-password',
        headers: { authorization: 'Bearer valid-token' },
        payload: validBody,
      });

      expect(changePassword).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        mockSession.userId,
        expect.objectContaining({
          currentPassword: 'oldpassword1',
          newPassword: 'newpassword1',
        }),
      );
    });
  });
});
