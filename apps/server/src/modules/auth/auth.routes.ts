import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { env } from '../../core/env.js';
import { clearSessionCookie, setSessionCookie } from '../../core/plugins/auth.js';
import {
  authResponseSchema,
  changePasswordSchema,
  loginResponseSchema,
  loginSchema,
  registerSchema,
} from './auth.schemas.js';
import { createAuthService } from './auth.service.js';
import {
  resendVerificationResponseSchema,
  resendVerificationSchema,
  verifyEmailResponseSchema,
  verifyEmailSchema,
} from './email-verification.schemas.js';
import { createEmailVerificationService } from './email-verification.service.js';
import {
  forgotPasswordResponseSchema,
  forgotPasswordSchema,
  resetPasswordResponseSchema,
  resetPasswordSchema,
} from './password-reset.schemas.js';
import { requestPasswordReset, resetPassword } from './password-reset.service.js';

export const authRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const { db, eventBus } = fastify.container;
  const authService = createAuthService({ db, eventBus });
  const emailVerificationService = createEmailVerificationService({ db, eventBus });

  fastify.post(
    '/register',
    {
      schema: {
        body: registerSchema,
        response: { 201: authResponseSchema },
      },
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      const result = await authService.register(request.body);
      setSessionCookie(reply, result.token, env.SESSION_TTL_SECONDS);
      return reply.status(201).send(result);
    },
  );

  fastify.post(
    '/login',
    {
      schema: {
        body: loginSchema,
        response: { 200: loginResponseSchema },
      },
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      const result = await authService.login(request.body, {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });
      if ('token' in result && !('mfaRequired' in result)) {
        setSessionCookie(reply, result.token, env.SESSION_TTL_SECONDS);
      }
      return reply.status(200).send(result);
    },
  );

  fastify.post(
    '/verify-email',
    {
      schema: {
        body: verifyEmailSchema,
        response: { 200: verifyEmailResponseSchema },
      },
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      await emailVerificationService.verifyEmail(request.body.token);
      return reply.status(200).send({ message: 'Email verified successfully.' });
    },
  );

  fastify.post(
    '/resend-verification',
    {
      schema: {
        body: resendVerificationSchema,
        response: { 200: resendVerificationResponseSchema },
      },
      config: { rateLimit: { max: 3, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      const result = await emailVerificationService.resendVerificationForEmail(request.body.email);
      return reply.status(200).send(result);
    },
  );

  fastify.post('/logout', { preHandler: fastify.requireSession }, async (request, reply) => {
    await authService.logout(request.session.id, request.userId);
    clearSessionCookie(reply);
    return reply.status(204).send();
  });

  fastify.post(
    '/change-password',
    {
      preHandler: fastify.requireSession,
      schema: { body: changePasswordSchema },
    },
    async (request, reply) => {
      await authService.changePassword(request.userId, request.session.id, request.body);
      return reply.status(204).send();
    },
  );

  fastify.post(
    '/forgot-password',
    {
      schema: {
        body: forgotPasswordSchema,
        response: { 200: forgotPasswordResponseSchema },
      },
      config: { rateLimit: { max: 3, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      const token = await requestPasswordReset(db, eventBus, request.body.email);
      return reply.status(200).send({
        message:
          'If an account exists for this email, you will receive password reset instructions.',
        resetToken: token ?? undefined,
      });
    },
  );

  fastify.post(
    '/reset-password',
    {
      schema: {
        body: resetPasswordSchema,
        response: { 200: resetPasswordResponseSchema },
      },
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      await resetPassword(db, eventBus, request.body);
      return reply.status(200).send({ message: 'Password reset successfully' });
    },
  );
};
