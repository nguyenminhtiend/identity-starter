import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  disableTotpSchema,
  enrollTotpResponseSchema,
  messageResponseSchema,
  regenerateRecoveryCodesResponseSchema,
  regenerateRecoveryCodesSchema,
  verifyTotpEnrollmentSchema,
} from './mfa.schemas.js';
import { createMfaService } from './mfa.service.js';

export const mfaRoutes: FastifyPluginAsyncZod = async (fastify) => {
  const { db, eventBus } = fastify.container;
  const mfaService = createMfaService({ db, eventBus });

  fastify.post(
    '/totp/enroll',
    {
      preHandler: fastify.requireSession,
      schema: {
        response: { 200: enrollTotpResponseSchema },
      },
    },
    async (request) => {
      return mfaService.enrollTotp(request.userId);
    },
  );

  fastify.post(
    '/totp/verify',
    {
      preHandler: fastify.requireSession,
      schema: {
        body: verifyTotpEnrollmentSchema,
        response: { 200: messageResponseSchema },
      },
    },
    async (request) => {
      await mfaService.verifyTotpEnrollment(request.userId, request.body.otp);
      return { message: 'TOTP enrollment verified successfully.' };
    },
  );

  fastify.delete(
    '/totp',
    {
      preHandler: fastify.requireSession,
      schema: {
        body: disableTotpSchema,
      },
    },
    async (request, reply) => {
      await mfaService.disableTotp(request.userId, request.body.password);
      return reply.status(204).send();
    },
  );

  fastify.post(
    '/recovery-codes/regenerate',
    {
      preHandler: fastify.requireSession,
      schema: {
        body: regenerateRecoveryCodesSchema,
        response: { 200: regenerateRecoveryCodesResponseSchema },
      },
    },
    async (request) => {
      const recoveryCodes = await mfaService.regenerateRecoveryCodes(
        request.userId,
        request.body.password,
      );
      return { recoveryCodes };
    },
  );
};
