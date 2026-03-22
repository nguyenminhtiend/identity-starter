import { ConflictError, UnauthorizedError } from '@identity-starter/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Container } from '../../../core/container-plugin.js';
import { errorHandlerPlugin } from '../../../core/plugins/error-handler.js';
import { InMemoryEventBus } from '../../../infra/event-bus.js';
import { makeSession } from '../../session/__tests__/session.factory.js';

const mockRegister = vi.fn();
const mockLogin = vi.fn();
const mockLogout = vi.fn();
const mockChangePassword = vi.fn();
const mockVerifyEmail = vi.fn();
const mockResendVerificationForEmail = vi.fn();

const { mockRequestPasswordReset, mockResetPassword } = vi.hoisted(() => ({
  mockRequestPasswordReset: vi.fn(),
  mockResetPassword: vi.fn(),
}));

vi.mock('../auth.service.js', () => ({
  createAuthService: vi.fn(() => ({
    register: mockRegister,
    login: mockLogin,
    logout: mockLogout,
    changePassword: mockChangePassword,
  })),
}));

vi.mock('../email-verification.service.js', () => ({
  createEmailVerificationService: vi.fn(() => ({
    verifyEmail: mockVerifyEmail,
    resendVerificationForEmail: mockResendVerificationForEmail,
  })),
}));

vi.mock('../password-reset.service.js', () => ({
  requestPasswordReset: mockRequestPasswordReset,
  resetPassword: mockResetPassword,
}));

import { authRoutes } from '../auth.routes.js';

describe('auth routes', () => {
  let app: FastifyInstance;
  const mockSession = makeSession({ userId: '550e8400-e29b-41d4-a716-446655440001' });

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
    await app.register(authRoutes, { prefix: '/api/auth' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockRegister.mockReset();
    mockLogin.mockReset();
    mockLogout.mockReset();
    mockChangePassword.mockReset();
    mockVerifyEmail.mockReset();
    mockResendVerificationForEmail.mockReset();
    mockRequestPasswordReset.mockReset();
    mockResetPassword.mockReset();
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
          id: '550e8400-e29b-41d4-a716-446655440000',
          email: 'new@example.com',
          displayName: 'New User',
          status: 'pending_verification' as const,
        },
      };
      mockRegister.mockResolvedValue(authResponse);

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
      mockRegister.mockRejectedValue(new ConflictError('User', 'email', 'new@example.com'));

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

    it('calls authService.register with parsed input', async () => {
      const authResponse = {
        token: 'tok',
        user: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          email: 'new@example.com',
          displayName: 'New User',
          status: 'active' as const,
        },
      };
      mockRegister.mockResolvedValue(authResponse);

      await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: validBody,
      });

      expect(mockRegister).toHaveBeenCalledWith(
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
        user: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          email: 'user@example.com',
          displayName: 'User',
          status: 'active' as const,
        },
      };
      mockLogin.mockResolvedValue(authResponse);

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
      mockLogin.mockRejectedValue(new UnauthorizedError('Invalid email or password'));

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

    it('calls authService.login with input and meta', async () => {
      const authResponse = {
        token: 'tok',
        user: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          email: 'user@example.com',
          displayName: 'User',
          status: 'active' as const,
        },
      };
      mockLogin.mockResolvedValue(authResponse);

      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: validBody,
      });

      expect(mockLogin).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'user@example.com', password: 'securepass123' }),
        expect.objectContaining({ ipAddress: expect.any(String) }),
      );
    });
  });

  describe('POST /api/auth/logout', () => {
    it('returns 204 on success', async () => {
      mockLogout.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(response.statusCode).toBe(204);
    });

    it('calls authService.logout with sessionId and userId', async () => {
      mockLogout.mockResolvedValue(undefined);

      await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(mockLogout).toHaveBeenCalledWith(mockSession.id, mockSession.userId);
    });
  });

  describe('POST /api/auth/change-password', () => {
    const validBody = {
      currentPassword: 'oldpassword1',
      newPassword: 'newpassword1',
    };

    it('returns 204 on success', async () => {
      mockChangePassword.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/change-password',
        headers: { authorization: 'Bearer valid-token' },
        payload: validBody,
      });

      expect(response.statusCode).toBe(204);
    });

    it('returns 401 on wrong current password', async () => {
      mockChangePassword.mockRejectedValue(new UnauthorizedError('Current password is incorrect'));

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

    it('calls authService.changePassword with userId, sessionId, and input', async () => {
      mockChangePassword.mockResolvedValue(undefined);

      await app.inject({
        method: 'POST',
        url: '/api/auth/change-password',
        headers: { authorization: 'Bearer valid-token' },
        payload: validBody,
      });

      expect(mockChangePassword).toHaveBeenCalledWith(
        mockSession.userId,
        mockSession.id,
        expect.objectContaining({
          currentPassword: 'oldpassword1',
          newPassword: 'newpassword1',
        }),
      );
    });
  });

  describe('POST /api/auth/verify-email', () => {
    it('returns 200 with message on success', async () => {
      mockVerifyEmail.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/verify-email',
        payload: { token: 'verification-token' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ message: 'Email verified successfully.' });
    });

    it('returns 401 when verification fails', async () => {
      mockVerifyEmail.mockRejectedValue(
        new UnauthorizedError('Invalid or expired verification token'),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/verify-email',
        payload: { token: 'bad' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 on missing token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/verify-email',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('calls verifyEmail with token from body', async () => {
      mockVerifyEmail.mockResolvedValue(undefined);

      await app.inject({
        method: 'POST',
        url: '/api/auth/verify-email',
        payload: { token: 'my-token' },
      });

      expect(mockVerifyEmail).toHaveBeenCalledWith('my-token');
    });
  });

  describe('POST /api/auth/resend-verification', () => {
    it('returns 200 with message and optional token', async () => {
      mockResendVerificationForEmail.mockResolvedValue({
        message: 'Verification email has been sent.',
        verificationToken: 'new-token',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/resend-verification',
        payload: { email: 'user@example.com' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        message: 'Verification email has been sent.',
        verificationToken: 'new-token',
      });
    });

    it('returns 400 on invalid email', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/resend-verification',
        payload: { email: 'not-an-email' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('calls resendVerificationForEmail with email from body', async () => {
      mockResendVerificationForEmail.mockResolvedValue({
        message: 'If your account is eligible, a verification email has been sent.',
      });

      await app.inject({
        method: 'POST',
        url: '/api/auth/resend-verification',
        payload: { email: 'a@b.com' },
      });

      expect(mockResendVerificationForEmail).toHaveBeenCalledWith('a@b.com');
    });
  });

  describe('POST /api/auth/forgot-password', () => {
    it('returns 200 with message and optional resetToken', async () => {
      mockRequestPasswordReset.mockResolvedValue('reset-token-value');

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/forgot-password',
        payload: { email: 'user@example.com' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.message).toBeDefined();
      expect(body.resetToken).toBe('reset-token-value');
      expect(mockRequestPasswordReset.mock.calls[0][2]).toBe('user@example.com');
    });

    it('returns 200 without resetToken when service returns null', async () => {
      mockRequestPasswordReset.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/forgot-password',
        payload: { email: 'missing@example.com' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.resetToken).toBeUndefined();
    });

    it('returns 400 on invalid email', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/forgot-password',
        payload: { email: 'bad' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('POST /api/auth/reset-password', () => {
    it('returns 200 on success', async () => {
      mockResetPassword.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/reset-password',
        payload: { token: 'valid-reset-token', newPassword: 'newpassword1' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().message).toBe('Password reset successfully');
      expect(mockResetPassword).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          token: 'valid-reset-token',
          newPassword: 'newpassword1',
        }),
      );
    });

    it('returns 401 when token is invalid', async () => {
      mockResetPassword.mockRejectedValue(new UnauthorizedError('Invalid or expired reset token'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/reset-password',
        payload: { token: 'bad', newPassword: 'newpassword1' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 on short newPassword', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/reset-password',
        payload: { token: 't', newPassword: 'short' },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
